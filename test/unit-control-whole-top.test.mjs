// Return the top of a numeric range (lib/control.mjs wholeTop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wholeTop } from '../lib/control.mjs';
import './pin-machine.mjs';

test('returns floor of hi when hiInc is true', () => {
  const r = wholeTop({ hi: 5.7, hiInc: true });
  assert.strictEqual(r, 5);
});

test('returns ceil(hi)-1 when hiInc is false', () => {
  const r = wholeTop({ hi: 5.7, hiInc: false });
  assert.strictEqual(r, 5);
});

test('returns null when hi is null', () => {
  const r = wholeTop({ hi: null });
  assert.strictEqual(r, null);
});

test('computes range from numeric set and returns floor of hi', () => {
  const r = wholeTop({ set: new Set(['1', '2', '3']) });
  assert.strictEqual(r, 3);
});

test('handles negative and decimal numbers in set, returns floor of hi', () => {
  const r = wholeTop({ set: new Set(['-1.5', '2.5']) });
  assert.strictEqual(r, 2);
});

test('returns integer hi when hiInc is true and hi is integer', () => {
  const r = wholeTop({ hi: 5, hiInc: true });
  assert.strictEqual(r, 5);
});

test('returns ceil(hi)-1 when hiInc is false and hi is integer', () => {
  const r = wholeTop({ hi: 5, hiInc: false });
  assert.strictEqual(r, 4);
});
