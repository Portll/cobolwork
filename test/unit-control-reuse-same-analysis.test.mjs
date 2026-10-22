// Whether two analyses are the same, objects of the parse compared as themselves. (lib/control-reuse.mjs sameAnalysis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameAnalysis } from '../lib/control-reuse.mjs';
import './pin-machine.mjs';

test('returns true for identical primitive values', () => {
  assert.equal(sameAnalysis(1, 1, new Set()), true);
  assert.equal(sameAnalysis('a', 'a', new Set()), true);
  assert.equal(sameAnalysis(true, true, new Set()), true);
  assert.equal(sameAnalysis(undefined, undefined, new Set()), true);
});

test('returns false for different primitive values', () => {
  assert.equal(sameAnalysis(1, 2, new Set()), false);
  assert.equal(sameAnalysis('a', 'b', new Set()), false);
  assert.equal(sameAnalysis(true, false, new Set()), false);
});

test('returns true for identical null values', () => {
  assert.equal(sameAnalysis(null, null, new Set()), true);
});

test('returns false when one is null and the other is not', () => {
  assert.equal(sameAnalysis(null, 0, new Set()), false);
  assert.equal(sameAnalysis(0, null, new Set()), false);
});

test('returns true for NaN compared with itself', () => {
  assert.equal(sameAnalysis(NaN, NaN, new Set()), true);
});

test('returns true for identical objects with same keys and values', () => {
  const a = { x: 1, y: 'two' };
  const b = { x: 1, y: 'two' };
  assert.equal(sameAnalysis(a, b, new Set()), true);
});

test('returns false for objects with different keys', () => {
  const a = { x: 1 };
  const b = { y: 1 };
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('returns false for objects with different values', () => {
  const a = { x: 1 };
  const b = { x: 2 };
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('returns false when object is in parse set', () => {
  const a = { x: 1 };
  const b = { x: 1 };
  const parse = new Set([a]);
  assert.equal(sameAnalysis(a, b, parse), false);
});

test('returns true for identical Maps with same entries', () => {
  const a = new Map([['k1', 1], ['k2', 2]]);
  const b = new Map([['k1', 1], ['k2', 2]]);
  assert.equal(sameAnalysis(a, b, new Set()), true);
});

test('returns false for Maps with different sizes', () => {
  const a = new Map([['k1', 1]]);
  const b = new Map([['k1', 1], ['k2', 2]]);
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('returns true for identical Sets with same elements', () => {
  const a = new Set([1, 2, 3]);
  const b = new Set([1, 2, 3]);
  assert.equal(sameAnalysis(a, b, new Set()), true);
});

test('returns false for Sets with different sizes', () => {
  const a = new Set([1, 2]);
  const b = new Set([1, 2, 3]);
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('returns true for identical typed arrays', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 3]);
  assert.equal(sameAnalysis(a, b, new Set()), true);
});

test('returns false for typed arrays with different lengths', () => {
  const a = new Uint8Array([1, 2]);
  const b = new Uint8Array([1, 2, 3]);
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('returns false for typed arrays with different values', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 4]);
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('handles nested objects correctly', () => {
  const a = { x: { y: 1 }, z: [1, 2] };
  const b = { x: { y: 1 }, z: [1, 2] };
  assert.equal(sameAnalysis(a, b, new Set()), true);
});

test('returns false for nested objects with different inner values', () => {
  const a = { x: { y: 1 } };
  const b = { x: { y: 2 } };
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('returns false for objects with different prototypes', () => {
  class A { constructor() { this.x = 1; } }
  class B { constructor() { this.x = 1; } }
  const a = new A();
  const b = new B();
  assert.equal(sameAnalysis(a, b, new Set()), false);
});

test('handles circular references in objects', () => {
  const a = { x: 1 };
  a.self = a;
  const b = { x: 1 };
  b.self = b;
  assert.equal(sameAnalysis(a, b, new Set()), true);
});

test('returns false for circular references with different structure', () => {
  const a = { x: 1 };
  a.self = a;
  const b = { x: 2 };
  b.self = b;
  assert.equal(sameAnalysis(a, b, new Set()), false);
});
