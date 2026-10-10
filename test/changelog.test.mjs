import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';
import { backfill, check, checkFiles, entryOf, renderBody, writeCut } from '../diag/changelog.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}
const commit = (dir, subject) => git(dir, 'commit', '--allow-empty', '-q', '-m', subject);
const tag = (dir, name) => git(dir, 'tag', '-a', name, '-m', name);

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-'));
  git(dir, 'init', '-q');
  for (const s of ['feat(gate): add a thing', 'fix: repair a thing', 'chore: release cobolwork 0.1.0']) commit(dir, s);
  tag(dir, 'v0.1.0');
  for (const s of ['feat(flow)!: drop the old flag', 'feat(flow): read more', 'fix(diag): mend one', 'perf(scan): go faster', 'docs: explain it', 'chore: tidy', 'test: cover it', 'plain subject']) commit(dir, s);
  return dir;
}

test('entryOf drops the type, keeps the scope and leaves out chores', () => {
  assert.deepEqual(entryOf('feat(gate): add x'), { group: 'Features', line: '- **gate:** add x' });
  assert.deepEqual(entryOf('fix: y'), { group: 'Fixes', line: '- y' });
  assert.equal(entryOf('chore: z'), null);
  assert.equal(entryOf('test(a): z'), null);
  assert.deepEqual(entryOf('no type here'), { group: 'Other', line: '- no type here' });
});

test('renderBody groups by type in a fixed order', () => {
  const body = renderBody(['docs: d', 'fix: f', 'feat: g', 'feat(x)!: b', 'chore: c']);
  assert.equal(body, '### Breaking changes\n\n- **x:** b\n\n### Features\n\n- g\n\n### Fixes\n\n- f\n\n### Documentation\n\n- d\n');
});

test('a cut writes the section from the range and keeps older sections byte for byte', () => {
  const dir = fixture();
  try {
    backfill(dir);
    const before = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.match(before, /## 0\.1\.0 - \d{4}-\d\d-\d\d\n\n### Features\n\n- \*\*gate:\*\* add a thing/);
    const r = writeCut(dir, '0.2.0', '2026-01-02');
    assert.equal(r.previous, '0.1.0');
    assert.equal(r.commits, 8);
    assert.equal(r.listed, 6);
    const after = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
    assert.ok(after.endsWith(before.slice(before.indexOf('## 0.1.0'))));
    const top = after.slice(after.indexOf('## 0.2.0'), after.indexOf('## 0.1.0'));
    assert.equal(top, '## 0.2.0 - 2026-01-02\n\n### Breaking changes\n\n- **flow:** drop the old flag\n\n### Features\n\n- **flow:** read more\n\n### Fixes\n\n- **diag:** mend one\n\n### Performance\n\n- **scan:** go faster\n\n### Documentation\n\n- explain it\n\n### Other\n\n- plain subject\n\n');
    const notes = readFileSync(join(dir, 'docs', 'releases', '0.2.0.md'), 'utf8');
    assert.ok(notes.startsWith('## Changes since 0.1.0\n'));
    writeCut(dir, '0.2.0', '2026-01-02');
    assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), after);
    assert.throws(() => writeCut(dir, '0.1.0'), /already tagged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the check fails a release commit whose changelog lacks its section', () => {
  const dir = fixture();
  try {
    backfill(dir);
    mkdirSync(join(dir, 'docs', 'releases'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'releases', '0.2.0.md'), '## Summary\n\nA release.\n');
    const missing = checkFiles(dir, '0.2.0');
    assert.ok(missing.some((p) => /has no 0\.2\.0 section/.test(p)));
    writeFileSync(join(dir, 'package.json'), '{"version":"0.3.0"}');
    assert.ok(checkFiles(dir, '0.3.0').some((p) => /has no 0\.3\.0 section/.test(p)));
    writeCut(dir, '0.2.0');
    assert.deepEqual(check(dir, '0.2.0'), []);
    commit(dir, 'fix: after the cut');
    assert.ok(check(dir, '0.2.0').some((p) => /not in the section/.test(p)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('this checkout carries the changelog section of its version', () => {
  const { version } = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  assert.deepEqual(checkFiles(REPO, version), []);
});
