// Serialises a value to a deterministic JSON string with object keys sorted at every level (lib/policy.mjs canonical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../lib/policy.mjs';
import './pin-machine.mjs';

test('returns JSON string for primitives', () => {
  assert.equal(canonical(42), '42');
  assert.equal(canonical('hello'), '"hello"');
  assert.equal(canonical(true), 'true');
  assert.equal(canonical(null), 'null');
  assert.equal(canonical(undefined), undefined);
});

test('returns bracketed comma-joined canonical elements for arrays', () => {
  assert.equal(canonical([1, 2, 3]), '[1,2,3]');
  assert.equal(canonical(['a', 'b']), '["a","b"]');
  assert.equal(canonical([]), '[]');
  assert.equal(canonical([1, [2, 3]]), '[1,[2,3]]');
});

test('returns brace-enclosed sorted key-value pairs for objects', () => {
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonical({}), '{}');
  assert.equal(canonical({ a: 1 }), '{"a":1}');
});

test('sorts object keys lexicographically at every level', () => {
  const obj = { z: 1, a: 2, m: 3 };
  assert.equal(canonical(obj), '{"a":2,"m":3,"z":1}');
});

test('recursively canonicalizes nested objects with sorted keys', () => {
  const obj = { b: { d: 1, c: 2 }, a: 3 };
  assert.equal(canonical(obj), '{"a":3,"b":{"c":2,"d":1}}');
});

test('recursively canonicalizes nested arrays', () => {
  const arr = [1, [2, 3], 4];
  assert.equal(canonical(arr), '[1,[2,3],4]');
});

test('handles mixed nested structures with sorted object keys', () => {
  const obj = { list: [3, 1, 2], name: 'test' };
  assert.equal(canonical(obj), '{"list":[3,1,2],"name":"test"}');
});

test('treats arrays as non-objects so they are not key-sorted', () => {
  const arr = [1, 2, 3];
  assert.equal(canonical(arr), '[1,2,3]');
  assert.notEqual(canonical(arr), '{"0":1,"1":2,"2":3}');
});

test('handles empty arrays and empty objects', () => {
  assert.equal(canonical([]), '[]');
  assert.equal(canonical({}), '{}');
});

test('handles null values in objects and arrays', () => {
  assert.equal(canonical({ a: null, b: 1 }), '{"a":null,"b":1}');
  assert.equal(canonical([null, 1]), '[null,1]');
});
