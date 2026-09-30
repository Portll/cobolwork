// The walk every rule set reads the tree through, on a drive that fails a listing: the directory is
// tried again, and one that stays unlistable is recorded rather than read as absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFileIndex } from '../lib/parser.mjs';
import './pin-machine.mjs';

function tree(fn) {
  const root = mkdtempSync(join(tmpdir(), 'cw-file-index-'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'copy'));
  writeFileSync(join(root, 'src', 'MAIN.cbl'), '');
  writeFileSync(join(root, 'copy', 'REC.cpy'), '');
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

// A readdir that fails `times` times with `code` on directories whose path ends with `failing`.
const flaky = (failing, code, times = Infinity) => {
  let failed = 0;
  return (d, o) => {
    if (d.endsWith(failing) && failed < times) { failed++; throw Object.assign(new Error(code), { code }); }
    return readdirSync(d, o);
  };
};
const files = (idx) => [...idx.index.values()].map((p) => p.split(/[\\/]/).slice(-2).join('/')).sort();

test('a listing that fails for a moment is tried again and read whole', () => tree((root) => {
  const pauses = [];
  const idx = buildFileIndex(root, { readdir: flaky('copy', 'ENOENT', 2), wait: (ms) => pauses.push(ms) });
  assert.deepEqual(files(idx), ['copy/REC.cpy', 'src/MAIN.cbl']);
  assert.deepEqual(idx.unreadableDirs, []);
  assert.equal(pauses.length, 2);
}));

test('a directory its parent listed and that stays unlistable is recorded, not read as absent', () => tree((root) => {
  for (const code of ['ENOENT', 'EIO', 'ETIMEDOUT', 'ENOTDIR', 'EACCES']) {
    const idx = buildFileIndex(root, { readdir: flaky('copy', code), wait: () => {} });
    assert.deepEqual(files(idx), ['src/MAIN.cbl'], code);
    assert.deepEqual(idx.unreadableDirs, [join(root, 'copy')], code);
    assert.deepEqual(idx.copyDirs, [join(root, 'src')], code);
  }
}));

test('only transient failures are retried', () => tree((root) => {
  const pauses = [];
  buildFileIndex(root, { readdir: flaky('copy', 'EACCES'), wait: (ms) => pauses.push(ms) });
  assert.equal(pauses.length, 0, 'a permission refusal does not change on its own');
  buildFileIndex(root, { readdir: flaky('copy', 'EIO'), wait: (ms) => pauses.push(ms) });
  assert.equal(pauses.length, 3);
}));

test('a root that does not exist is an empty tree', () => {
  const idx = buildFileIndex(join(tmpdir(), 'cw-file-index-absent-root'));
  assert.equal(idx.index.size, 0);
  assert.deepEqual(idx.unreadableDirs, []);
});
