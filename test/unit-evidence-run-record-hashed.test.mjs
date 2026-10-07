// Records input file hashes into the journal (lib/evidence/run.mjs recordHashed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordHashed } from '../lib/evidence/run.mjs';
import './pin-machine.mjs';

test('returns undefined when journal is null', () => {
  const result = recordHashed(null, 0, [{ path: 'a.cob', sha256: 'abc' }]);
  assert.strictEqual(result, undefined);
});

test('returns undefined when journal is undefined', () => {
  const result = recordHashed(undefined, 0, [{ path: 'a.cob', sha256: 'abc' }]);
  assert.strictEqual(result, undefined);
});

test('does not append when hashes is null', () => {
  const calls = [];
  const journal = { append: (type, data) => calls.push([type, data]) };
  recordHashed(journal, 1, null);
  assert.deepStrictEqual(calls, []);
});

test('does not append when hashes is undefined', () => {
  const calls = [];
  const journal = { append: (type, data) => calls.push([type, data]) };
  recordHashed(journal, 1, undefined);
  assert.deepStrictEqual(calls, []);
});

test('does not append when hashes is an empty array', () => {
  const calls = [];
  const journal = { append: (type, data) => calls.push([type, data]) };
  recordHashed(journal, 1, []);
  assert.deepStrictEqual(calls, []);
});

test('appends one entry for a single hash', () => {
  const calls = [];
  const journal = { append: (type, data) => calls.push([type, data]) };
  recordHashed(journal, 2, [{ path: 'src/a.cob', sha256: 'deadbeef' }]);
  assert.deepStrictEqual(calls, [
    ['input', { root: 2, path: 'src/a.cob', sha256: 'deadbeef' }]
  ]);
});

test('appends entries for multiple hashes in order', () => {
  const calls = [];
  const journal = { append: (type, data) => calls.push([type, data]) };
  recordHashed(journal, 3, [
    { path: 'a.cob', sha256: '1111' },
    { path: 'b.cob', sha256: '2222' },
    { path: 'c.cob', sha256: '3333' }
  ]);
  assert.deepStrictEqual(calls, [
    ['input', { root: 3, path: 'a.cob', sha256: '1111' }],
    ['input', { root: 3, path: 'b.cob', sha256: '2222' }],
    ['input', { root: 3, path: 'c.cob', sha256: '3333' }]
  ]);
});

test('uses the provided rootIndex value in each appended entry', () => {
  const calls = [];
  const journal = { append: (type, data) => calls.push([type, data]) };
  recordHashed(journal, 42, [{ path: 'x.cob', sha256: 'ffff' }]);
  assert.strictEqual(calls[0][1].root, 42);
});
