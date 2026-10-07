// Checks if a constraint's upper bound is within a limit, optionally requiring a lower bound of at least one (lib/control.mjs within).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { within } from '../lib/control.mjs';
import './pin-machine.mjs';

test('returns false when said is null', () => {
  assert.equal(within(null, 10), false);
});

test('returns false when said is undefined', () => {
  assert.equal(within(undefined, 10), false);
});

test('returns false when hi is null and fromOne is true', () => {
  const said = { lo: 1, loInc: true, hi: null };
  assert.equal(within(said, 10), false);
});

test('returns true when hi is within limit and fromOne is false', () => {
  const said = { lo: 0, loInc: true, hi: 5, hiInc: true };
  assert.equal(within(said, 10, false), true);
});

test('returns false when hi exceeds limit and fromOne is false', () => {
  const said = { lo: 0, loInc: true, hi: 11, hiInc: true };
  assert.equal(within(said, 10, false), false);
});

test('returns true when hi equals limit with hiInc true', () => {
  const said = { lo: 1, loInc: true, hi: 10, hiInc: true };
  assert.equal(within(said, 10), true);
});

test('returns false when hi exceeds limit by one with hiInc true', () => {
  const said = { lo: 1, loInc: true, hi: 11, hiInc: true };
  assert.equal(within(said, 10), false);
});

test('returns true when hi equals limit plus one with hiInc false', () => {
  const said = { lo: 1, loInc: true, hi: 11, hiInc: false };
  assert.equal(within(said, 10), true);
});

test('returns false when hi exceeds limit plus one with hiInc false', () => {
  const said = { lo: 1, loInc: true, hi: 12, hiInc: false };
  assert.equal(within(said, 10), false);
});

test('returns false when lo is zero with loInc true and fromOne is true', () => {
  const said = { lo: 0, loInc: true, hi: 5, hiInc: true };
  assert.equal(within(said, 10), false);
});
