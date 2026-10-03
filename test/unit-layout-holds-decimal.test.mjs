// Whether an item's bytes are read as decimal digits, zoned or packed (lib/layout.mjs holdsDecimal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holdsDecimal } from '../lib/layout.mjs';
import './pin-machine.mjs';

test('returns false for an item with non-88 children', () => {
  const it = { children: [{ level: 1 }], effectiveUsage: 'DISPLAY', picture: '9(3)V99' };
  assert.equal(holdsDecimal(it), false);
});

test('returns true for COMP-3 usage', () => {
  const it = { effectiveUsage: 'COMP-3' };
  assert.equal(holdsDecimal(it), true);
});

test('returns true for PACKED-DECIMAL usage', () => {
  const it = { effectiveUsage: 'PACKED-DECIMAL' };
  assert.equal(holdsDecimal(it), true);
});

test('returns true for COMP-6 usage', () => {
  const it = { effectiveUsage: 'COMP-6' };
  assert.equal(holdsDecimal(it), true);
});

test('returns true for DISPLAY usage with valid numeric picture', () => {
  const it = { effectiveUsage: 'DISPLAY', picture: '9(3)V99' };
  assert.equal(holdsDecimal(it), true);
});

test('returns false for DISPLAY usage without picture', () => {
  const it = { effectiveUsage: 'DISPLAY' };
  assert.equal(holdsDecimal(it), false);
});

test('returns true for DISPLAY usage with picture containing 9 and valid chars', () => {
  const it = { effectiveUsage: 'DISPLAY', picture: 'S(3)V99' };
  assert.equal(holdsDecimal(it), true);
});

test('returns false for DISPLAY usage with invalid picture characters', () => {
  const it = { effectiveUsage: 'DISPLAY', picture: '9A' };
  assert.equal(holdsDecimal(it), false);
});

test('returns false for COMPUTATIONAL usage', () => {
  const it = { effectiveUsage: 'COMPUTATIONAL' };
  assert.equal(holdsDecimal(it), false);
});

test('returns false for BINARY usage', () => {
  const it = { effectiveUsage: 'BINARY' };
  assert.equal(holdsDecimal(it), false);
});
