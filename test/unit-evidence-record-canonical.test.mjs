// deterministic canonical JSON string with sorted keys (lib/evidence/record.mjs canonical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical } from '../lib/evidence/record.mjs';
import './pin-machine.mjs';

test('returns JSON string for null', () => {
  assert.equal(canonical(null), 'null');
});

test('returns JSON string for boolean true', () => {
  assert.equal(canonical(true), 'true');
});

test('returns JSON string for boolean false', () => {
  assert.equal(canonical(false), 'false');
});

test('returns JSON string for empty string', () => {
  assert.equal(canonical(''), '""');
});

test('returns JSON string for non-empty string', () => {
  assert.equal(canonical('hello'), '"hello"');
});

test('returns string representation for safe integer zero', () => {
  assert.equal(canonical(0), '0');
});

test('returns string representation for positive safe integer', () => {
  assert.equal(canonical(42), '42');
});

test('returns string representation for negative safe integer', () => {
  assert.equal(canonical(-7), '-7');
});

test('throws for non-integer number', () => {
  assert.throws(() => canonical(3.14), TypeError);
});

test('throws for unsafe integer', () => {
  assert.throws(() => canonical(2 ** 53), TypeError);
});

test('returns empty array for empty array', () => {
  assert.equal(canonical([]), '[]');
});

test('returns canonical array with mixed values', () => {
  assert.equal(canonical([1, 'a', null, true, [2, 3]]), '[1,"a",null,true,[2,3]]');
});

test('returns empty object for empty object', () => {
  assert.equal(canonical({}), '{}');
});

test('returns canonical object with sorted keys', () => {
  assert.equal(canonical({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('returns canonical object with nested values', () => {
  assert.equal(canonical({ z: [1, 2], a: { c: true, b: null } }), '{"a":{"b":null,"c":true},"z":[1,2]}');
});

test('throws for undefined value in object', () => {
  assert.throws(() => canonical({ a: undefined }), TypeError);
});

test('throws for function type', () => {
  assert.throws(() => canonical(() => {}), TypeError);
});

test('throws for symbol type', () => {
  assert.throws(() => canonical(Symbol('test')), TypeError);
});
