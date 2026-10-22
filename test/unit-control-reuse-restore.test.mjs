// Restores a complex data structure from a serialized form (lib/control-reuse.mjs restore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restore } from '../lib/control-reuse.mjs';
import './pin-machine.mjs';

test('returns a primitive when the table entry has a t property', () => {
  const kept = {
    table: [{ t: 42 }],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  assert.equal(result, 42);
});

test('creates an array from an a property and resolves its elements', () => {
  const kept = {
    table: [
      { a: [{ r: 1 }] },
      { t: 'x' }
    ],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  assert.deepEqual(result, ['x']);
});

test('creates a map from an m property and resolves keys and values', () => {
  const kept = {
    table: [
      { m: [[{ r: 1 }, { r: 2 }]] },
      { t: 'a' },
      { t: 'b' }
    ],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  const expected = new Map([['a', 'b']]);
  assert.deepEqual(result, expected);
});

test('creates a set from an s property and resolves its elements', () => {
  const kept = {
    table: [
      { s: [{ r: 1 }, { r: 2 }] },
      { t: 1 },
      { t: 2 }
    ],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  const expected = new Set([1, 2]);
  assert.deepEqual(result, expected);
});

test('creates an object from an o property and resolves its values', () => {
  const kept = {
    table: [
      { o: [['foo', { r: 1 }]] },
      { t: 'bar' }
    ],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  assert.deepEqual(result, { foo: 'bar' });
});

test('resolves a reference to the order array via the p key', () => {
  const kept = {
    table: [
      { a: [{ p: 0 }] }
    ],
    root: { r: 0 }
  };
  const order = ['hello'];
  const result = restore(kept, order, []);
  assert.deepEqual(result, ['hello']);
});

test('resolves a reference to the files array via the f key', () => {
  const kept = {
    table: [
      { a: [{ f: 0 }] }
    ],
    root: { r: 0 }
  };
  const files = ['file.txt'];
  const result = restore(kept, [], files);
  assert.deepEqual(result, ['file.txt']);
});

test('returns null for a null reference', () => {
  const kept = {
    table: [
      { a: [null] }
    ],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  assert.deepEqual(result, [null]);
});

test('returns a primitive directly for a non-object reference', () => {
  const kept = {
    table: [
      { a: [123] }
    ],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  assert.deepEqual(result, [123]);
});

test('creates an empty object for a table entry with no type flags', () => {
  const kept = {
    table: [
      {}
    ],
    root: { r: 0 }
  };
  const result = restore(kept, [], []);
  assert.deepEqual(result, {});
});
