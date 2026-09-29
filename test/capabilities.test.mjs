import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { capabilities, COMMANDS, GLOBAL_OPTIONS } from '../lib/capabilities.mjs';
import { commitAt, revisionOf } from '../lib/revision.mjs';
import { EVIDENCE } from '../lib/kernel/findings.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CLI = join(ROOT, 'bin', 'cobolwork.mjs');
const skip = spawnSync('git', ['--version']).status !== 0 && 'git is not installed';
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-rev-'));
  git(root, ['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(root, ['config', k, v]);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}

test('a clean checkout is not dirty, and names its commit', { skip }, () => {
  const root = repo({ 'P.cbl': 'x\n', '.gitignore': 'ignored.txt\n' });
  writeFileSync(join(root, 'ignored.txt'), 'y');
  assert.deepEqual(revisionOf(root), { commit: git(root, ['rev-parse', 'HEAD']), dirty: false });
});

test('an edited, removed or untracked file makes the checkout dirty', { skip }, () => {
  const edited = repo({ 'P.cbl': 'x\n' });
  writeFileSync(join(edited, 'P.cbl'), 'changed\n');
  assert.equal(revisionOf(edited).dirty, true);
  const untracked = repo({ 'P.cbl': 'x\n' });
  writeFileSync(join(untracked, 'Q.cbl'), 'new\n');
  assert.equal(revisionOf(untracked).dirty, true);
});

test('outside a repository there is no revision', () => {
  assert.equal(revisionOf(mkdtempSync(join(tmpdir(), 'cw-norepo-'))), null);
});

test('reading the revision runs nothing the scanned repository configures', { skip }, () => {
  const root = repo({ 'P.cbl': 'x\n', '.gitattributes': '* filter=mark\n' });
  const marker = join(mkdtempSync(join(tmpdir(), 'cw-marker-')), 'ran');
  git(root, ['config', 'filter.mark.clean', `sh -c 'touch ${marker}; cat'`]);
  git(root, ['config', 'core.fsmonitor', `sh -c 'touch ${marker}'`]);
  writeFileSync(join(root, 'P.cbl'), 'changed\n');
  assert.equal(revisionOf(root).dirty, true);
  assert.equal(existsSync(marker), false, 'neither the clean filter nor fsmonitor ran');
});

test('a named revision resolves to its commit, and nothing else is guessed', { skip }, () => {
  const root = repo({ 'P.cbl': 'x\n' });
  assert.deepEqual(commitAt(root, 'HEAD'), { commit: git(root, ['rev-parse', 'HEAD']), dirty: false });
  assert.equal(commitAt(root, 'no-such-ref'), null);
  assert.equal(commitAt(root, '--output=x'), null);
});

test('a scan report says which cobolwork wrote it and which commit it read', { skip }, () => {
  const root = repo({ 'P.cbl': '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       PROCEDURE DIVISION.\n           GOBACK.\n' });
  const r = spawnSync(process.execPath, [CLI, 'scan', root, '--quiet'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(r.stdout).summary;
  assert.deepEqual(s.revision, { commit: git(root, ['rev-parse', 'HEAD']), dirty: false });
  assert.match(s.toolRevision.commit, /^[0-9a-f]{40}$/);
  const sarif = JSON.parse(spawnSync(process.execPath, [CLI, 'scan', root, '--format', 'sarif'], { encoding: 'utf8' }).stdout);
  assert.deepEqual(sarif.runs[0].invocations[0].properties['cobolwork/revision'], s.revision);
});

test('capabilities --json is one document, with a version for every document cobolwork writes', () => {
  const r = spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.tool, 'cobolwork-capabilities');
  assert.equal(doc.toolVersion, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  const sources = [...readdirSync(join(ROOT, 'lib')).map((f) => join(ROOT, 'lib', f)), ...readdirSync(join(ROOT, 'lib', 'sets')).map((f) => join(ROOT, 'lib', 'sets', f)), CLI]
    .filter((f) => f.endsWith('.mjs')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const written = new Set([...sources.matchAll(/tool: '(cobolwork[a-z-]*)'/g)].map((m) => m[1]));
  for (const t of written) assert.ok(Object.hasOwn(doc.documents, t), `${t} is written and listed`);
  assert.deepEqual(doc.evidenceKinds.slice().sort(), Object.keys(EVIDENCE).sort());
  assert.deepEqual(doc.documents, capabilities().documents);
});

test('capabilities names every command and option the command line takes, and no other', () => {
  const cli = readFileSync(CLI, 'utf8');
  const parsed = new Set([...cli.matchAll(/a === '(--[a-z-]+)'/g)].map((m) => m[1]));
  const listed = new Set([...Object.values(COMMANDS).flatMap((c) => c.options), ...GLOBAL_OPTIONS]);
  assert.deepEqual([...parsed].filter((o) => !listed.has(o)).sort(), [], 'every option parsed is listed');
  assert.deepEqual([...listed].filter((o) => !parsed.has(o)).sort(), [], 'every option listed is parsed');
  const commands = new Set([...cli.matchAll(/command === '([a-z]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...commands].sort(), Object.keys(COMMANDS).sort());
});
