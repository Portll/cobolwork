// Integer and decimal places of a numeric PICTURE, with P scaling (lib/sets/semantics.mjs placesOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placesOf } from '../lib/sets/semantics.mjs';
import './pin-machine.mjs';

test('returns null for empty string', () => {
  assert.deepEqual(placesOf(''), null);
});

test('returns null for non-numeric picture', () => {
  assert.deepEqual(placesOf('A9'), null);
});

test('returns null for picture with only P and V', () => {
  assert.deepEqual(placesOf('PV'), null);
});

test('returns zero places for simple integer 9', () => {
  assert.deepEqual(placesOf('9'), { int: 1, dec: 0 });
});

test('returns decimal places for 9V9', () => {
  assert.deepEqual(placesOf('9V9'), { int: 1, dec: 1 });
});

test('returns all decimal for P9V9', () => {
  assert.deepEqual(placesOf('P9V9'), { int: 0, dec: 3 });
});

test('returns all decimal for 9VP', () => {
  assert.deepEqual(placesOf('9VP'), { int: 0, dec: 2 });
});

test('returns integer and decimal for 99V99', () => {
  assert.deepEqual(placesOf('99V99'), { int: 2, dec: 2 });
});

test('returns integer places for S999', () => {
  assert.deepEqual(placesOf('S999'), { int: 3, dec: 0 });
});

test('expands repeated digits in picture', () => {
  assert.deepEqual(placesOf('9(3)'), { int: 3, dec: 0 });
});
