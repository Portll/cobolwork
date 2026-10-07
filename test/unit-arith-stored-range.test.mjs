// Computes the integer range a COBOL field stores for a rational interval, widening inexact bounds and applying floor/ceil or truncation (lib/arith.mjs storedRange).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedRange, q } from '../lib/arith.mjs';
import './pin-machine.mjs';

test('truncates exact integer bounds toward zero', () => {
  const r = { lo: q(5n), hi: q(10n), inexact: false };
  assert.deepEqual(storedRange(r, false), { lo: 5n, hi: 10n });
});

test('truncates exact fractional bounds toward zero', () => {
  const r = { lo: q(7n, 2n), hi: q(11n, 4n), inexact: false };
  assert.deepEqual(storedRange(r, false), { lo: 3n, hi: 2n });
});

test('truncates exact negative fractional bounds toward zero', () => {
  const r = { lo: q(-7n, 2n), hi: q(-11n, 4n), inexact: false };
  assert.deepEqual(storedRange(r, false), { lo: -3n, hi: -2n });
});

test('widens inexact bounds then truncates toward zero', () => {
  const r = { lo: q(1n, 2n), hi: q(3n, 2n), inexact: true };
  assert.deepEqual(storedRange(r, false), { lo: 0n, hi: 1n });
});

test('widens inexact negative bounds then truncates toward zero', () => {
  const r = { lo: q(-3n, 2n), hi: q(-1n, 2n), inexact: true };
  assert.deepEqual(storedRange(r, false), { lo: -1n, hi: 0n });
});

test('floors and ceils exact integer bounds', () => {
  const r = { lo: q(5n), hi: q(10n), inexact: false };
  assert.deepEqual(storedRange(r, true), { lo: 5n, hi: 10n });
});

test('floors and ceils exact fractional bounds', () => {
  const r = { lo: q(7n, 2n), hi: q(11n, 4n), inexact: false };
  assert.deepEqual(storedRange(r, true), { lo: 3n, hi: 3n });
});

test('floors and ceils exact negative fractional bounds', () => {
  const r = { lo: q(-7n, 2n), hi: q(-11n, 4n), inexact: false };
  assert.deepEqual(storedRange(r, true), { lo: -4n, hi: -2n });
});

test('widens inexact bounds then floors and ceils', () => {
  const r = { lo: q(1n, 2n), hi: q(3n, 2n), inexact: true };
  assert.deepEqual(storedRange(r, true), { lo: 0n, hi: 2n });
});

test('widens inexact negative bounds then floors and ceils', () => {
  const r = { lo: q(-3n, 2n), hi: q(-1n, 2n), inexact: true };
  assert.deepEqual(storedRange(r, true), { lo: -2n, hi: 0n });
});
