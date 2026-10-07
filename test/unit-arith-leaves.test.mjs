// Collects all field nodes from an arithmetic expression tree (lib/arith.mjs leaves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaves } from '../lib/arith.mjs';
import './pin-machine.mjs';

test('returns empty array for a tree with no field and no a', () => {
  const tree = { k: 'num', v: 1 };
  assert.deepEqual(leaves(tree), []);
});

test('returns the field node itself when tree is a field', () => {
  const f = { k: 'field', name: 'A' };
  assert.deepEqual(leaves(f), [f]);
});

test('collects field from a single child a', () => {
  const f = { k: 'field', name: 'A' };
  const tree = { k: 'neg', a: f };
  assert.deepEqual(leaves(tree), [f]);
});

test('collects fields from both children a and b', () => {
  const fa = { k: 'field', name: 'A' };
  const fb = { k: 'field', name: 'B' };
  const tree = { k: 'add', a: fa, b: fb };
  assert.deepEqual(leaves(tree), [fa, fb]);
});

test('collects fields from nested children', () => {
  const fa = { k: 'field', name: 'A' };
  const fb = { k: 'field', name: 'B' };
  const fc = { k: 'field', name: 'C' };
  const inner = { k: 'add', a: fa, b: fb };
  const tree = { k: 'add', a: inner, b: fc };
  assert.deepEqual(leaves(tree), [fa, fb, fc]);
});

test('ignores non-field nodes in children', () => {
  const f = { k: 'field', name: 'A' };
  const num = { k: 'num', v: 5 };
  const tree = { k: 'add', a: num, b: f };
  assert.deepEqual(leaves(tree), [f]);
});

test('uses provided out array instead of creating new one', () => {
  const f = { k: 'field', name: 'A' };
  const out = [f];
  const tree = { k: 'field', name: 'B' };
  const result = leaves(tree, out);
  assert.deepEqual(result, [f, tree]);
  assert.equal(result, out);
});

test('handles tree with a but no b', () => {
  const f = { k: 'field', name: 'A' };
  const tree = { k: 'neg', a: f };
  assert.deepEqual(leaves(tree), [f]);
});
