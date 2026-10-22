// Computes a Map of upper-case member names to sorted file paths (lib/pli/include.mjs membersOf).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membersOf } from '../lib/pli/include.mjs';
import './pin-machine.mjs';

test('returns an empty Map when given no paths', () => {
  const result = membersOf([]);
  assert.deepStrictEqual(result, new Map());
});

test('groups a single path under its upper-case basename', () => {
  const result = membersOf(['foo.cob']);
  const expected = new Map([['FOO', ['foo.cob']]]);
  assert.deepStrictEqual(result, expected);
});

test('sorts paths and groups by name, preserving sorted order', () => {
  const result = membersOf(['b.cob', 'a.pli', 'a.cob']);
  const expected = new Map([
    ['A', ['a.cob', 'a.pli']],
    ['B', ['b.cob']]
  ]);
  assert.deepStrictEqual(result, expected);
});

test('is case-insensitive on the basename when grouping', () => {
  const result = membersOf(['X.cob', 'x.pli', 'Y.cob']);
  const expected = new Map([
    ['X', ['X.cob', 'x.pli']],
    ['Y', ['Y.cob']]
  ]);
  assert.deepStrictEqual(result, expected);
});

test('handles paths that differ only by case and extension in sort order', () => {
  const result = membersOf(['a.cob', 'A.PLI']);
  const expected = new Map([
    ['A', ['A.PLI', 'a.cob']]
  ]);
  assert.deepStrictEqual(result, expected);
});
