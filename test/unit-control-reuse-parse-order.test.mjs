// breadth-first traversal of reachable objects from a root (lib/control-reuse.mjs parseOrder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrder } from '../lib/control-reuse.mjs';
import './pin-machine.mjs';

test('returns only the root object when it has only primitive properties', () => {
  const root = { a: 1, b: 'x' };
  const order = parseOrder(root);
  assert.deepStrictEqual(order, [root]);
});

test('traverses into arrays and objects found in properties (breadth-first)', () => {
  const inner = { c: 2 };
  const arr = [1, inner];
  const root = { arr };
  const order = parseOrder(root);
  assert.deepStrictEqual(order, [root, arr, inner]);
});

test('includes Map entries but does not descend into primitive keys', () => {
  const valueObj = { v: 3 };
  const map = new Map([['k', valueObj]]);
  const root = { map };
  const order = parseOrder(root);
  assert.deepStrictEqual(order, [root, map, valueObj]);
});

test('includes Set elements and traverses object members of a Set', () => {
  const obj = { x: 4 };
  const set = new Set([obj, 5]);
  const root = { set };
  const order = parseOrder(root);
  assert.deepStrictEqual(order, [root, set, obj]);
});

test('skips the contents of typed arrays (ArrayBuffer views)', () => {
  const typed = new Uint8Array([1, 2]);
  const root = { typed };
  const order = parseOrder(root);
  assert.deepStrictEqual(order, [root, typed]);
});

test('handles cyclic references without infinite loops', () => {
  const a = {};
  const b = { a };
  a.b = b;
  const order = parseOrder(a);
  assert.deepStrictEqual(order, [a, b]);
});

test('processes a root that is itself an array', () => {
  const obj = { a: 1 };
  const innerArr = [2, 3];
  const root = [obj, innerArr];
  const order = parseOrder(root);
  assert.deepStrictEqual(order, [root, obj, innerArr]);
});
