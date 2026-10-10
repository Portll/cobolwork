// encodes values into a reference table (lib/control-reuse.mjs keep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keep } from '../lib/control-reuse.mjs';
import './pin-machine.mjs';

test('keeps a primitive number unchanged', () => {
  const result = keep(42, [], []);
  assert.deepStrictEqual(result, { root: 42, table: [] });
});

test('encodes a file name as a file reference', () => {
  const files = ['file.cob'];
  const result = keep('file.cob', [], files);
  assert.deepStrictEqual(result, { root: { f: 0 }, table: [] });
});

test('returns null when a string contains a file name substring', () => {
  const files = ['file.cob'];
  const result = keep('path/to/file.cob', [], files);
  assert.strictEqual(result, null);
});

test('encodes a plain object with a null prototype', () => {
  const obj = Object.create(null);
  obj.x = 10;
  const result = keep(obj, [], []);
  assert.deepStrictEqual(result, {
    root: { r: 0 },
    table: [{ o: [['x', 10]], n: true }],
  });
});

test('encodes a plain array into the table', () => {
  const arr = [1, 2];
  const result = keep(arr, [], []);
  assert.deepStrictEqual(result, {
    root: { r: 0 },
    table: [{ a: [1, 2] }],
  });
});

test('encodes a Map into the table', () => {
  const m = new Map([['k', 1]]);
  const result = keep(m, [], []);
  assert.deepStrictEqual(result, {
    root: { r: 0 },
    table: [{ m: [['k', 1]] }],
  });
});

test('encodes a Set into the table', () => {
  const s = new Set([1, 2]);
  const result = keep(s, [], []);
  assert.deepStrictEqual(result, {
    root: { r: 0 },
    table: [{ s: [1, 2] }],
  });
});

test('handles a circular reference by using a table reference', () => {
  const a = {};
  a.self = a;
  const result = keep(a, [], []);
  assert.deepStrictEqual(result, {
    root: { r: 0 },
    table: [{ o: [['self', { r: 0 }]] }],
  });
});
