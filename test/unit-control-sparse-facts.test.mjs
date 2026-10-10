// Sorted list of set bit positions as 16-bit numbers (lib/control.mjs sparseFacts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparseFacts } from '../lib/control.mjs';
import './pin-machine.mjs';

test('returns empty Uint16Array for empty input', () => {
  const out = sparseFacts(new Uint32Array([]));
  assert.ok(out instanceof Uint16Array);
  assert.strictEqual(out.length, 0);
});

test('returns original bits when total bits exceed limit', () => {
  const bits = new Uint32Array(2049);
  const out = sparseFacts(bits);
  assert.strictEqual(out, bits);
});

test('computes indices when total bits exactly at limit', () => {
  const bits = new Uint32Array(2048);
  bits[2047] = 0x80000000;
  const out = sparseFacts(bits);
  assert.ok(out instanceof Uint16Array);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0], 65535);
});

test('computes sorted indices for multiple bits in a single word', () => {
  const bits = new Uint32Array([0b10101]);
  const out = sparseFacts(bits);
  assert.deepStrictEqual(Array.from(out), [0, 2, 4]);
});

test('computes sorted indices across two words', () => {
  const bits = new Uint32Array([0b10, 0b1000]);
  const out = sparseFacts(bits);
  assert.deepStrictEqual(Array.from(out), [1, 35]);
});

test('computes correct order for mixed bits in multiple words', () => {
  const bits = new Uint32Array([0b1100, 0b0011]);
  const out = sparseFacts(bits);
  assert.deepStrictEqual(Array.from(out), [2, 3, 32, 33]);
});
