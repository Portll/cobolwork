import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { diffRefs } from '../lib/diff.mjs';
import './pin-machine.mjs';

// The repository diff reads may be someone else's, .git/config included.
const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = !hasGit && 'git is not installed';
const git = (cwd, args, input) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', input });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const PROGRAM = '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       PROCEDURE DIVISION.\n           GOBACK.\n';
const repo = (files = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-diffsafe-'));
  const r = join(root, 'repo');
  git(root, ['init', '-q', 'repo']);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(r, ['config', k, v]);
  for (const [name, text] of Object.entries({ 'P.cbl': PROGRAM, ...files })) writeFileSync(join(r, name), text);
  git(r, ['add', '.']);
  git(r, ['commit', '-qm', 'init']);
  return { root, r };
};
const posix = (p) => p.split('\\').join('/');

test('diff runs no command the repository it reads configures', { skip }, () => {
  const { root, r } = repo({ '.gitattributes': '*.cbl filter=poc\n' });
  git(r, ['config', 'filter.poc.smudge', `sh -c 'touch "${posix(join(root, 'smudge-ran'))}"; cat'`]);
  git(r, ['config', 'filter.poc.clean', 'cat']);
  git(r, ['config', 'core.fsmonitor', `sh -c 'touch "${posix(join(root, 'fsmonitor-ran'))}"'`]);
  const res = diffRefs(r, 'HEAD');
  assert.equal(existsSync(join(root, 'smudge-ran')), false, 'a filter the repository names ran on checkout');
  assert.equal(existsSync(join(root, 'fsmonitor-ran')), false, 'core.fsmonitor ran when the files were listed');
  assert.equal(res.summary.nosrc, false, 'and the revision was still read');
});

test('a revision that starts with "-" is refused, never read as an option', { skip }, () => {
  const { root, r } = repo();
  assert.throws(() => diffRefs(r, `--index-output=${join(root, 'written')}`), (e) => e.code === 'EDIFFREF');
  assert.deepEqual(readdirSync(root).filter((f) => f.startsWith('written')), []);
  assert.throws(() => diffRefs(r, 'HEAD', '-p'), (e) => e.code === 'EDIFFREF');
});

// git mktree accepts entry names git's own checkout would refuse: '..', a drive-and-stream colon, a
// backslash, '.git'. A revision holding them must not write outside the directory it is read into.
test('a tree entry that climbs out, names a stream or reaches into .git is not written', { skip }, () => {
  const { r } = repo();
  const name = `escaped-${randomBytes(6).toString('hex')}.txt`;
  const blob = git(r, ['hash-object', '-w', '--stdin'], 'escaped\n');
  const program = git(r, ['hash-object', '-w', '--stdin'], PROGRAM);
  const sub = git(r, ['mktree'], `100644 blob ${blob}\t${name}\n`);
  const top = git(r, ['mktree'], [`040000 tree ${sub}\t..`, `040000 tree ${sub}\t.git`, `100644 blob ${blob}\ta:${name}`, `100644 blob ${program}\tP.cbl`].join('\n') + '\n');
  const commit = git(r, ['commit-tree', top, '-m', 'hostile']);
  const res = diffRefs(r, commit);
  assert.equal(existsSync(join(tmpdir(), name)), false, 'a file was written beside the directory the revision was read into');
  assert.equal(res.summary.nosrc, false, 'the rest of the revision was read');
});
