import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasFact, sparseFacts } from '../lib/control.mjs';
import './pin-machine.mjs';

test('a fact set kept as its numbers answers every fact as the bitset does', () => {
  let seed = 7;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
  for (const words of [1, 3, 64, 2048]) {
    const bits = new Uint32Array(words);
    for (let i = 0; i < words; i++) bits[i] = next() & next();
    bits[words - 1] |= 0x80000000;
    bits[0] |= 1;
    const held = sparseFacts(bits);
    assert.ok(held instanceof Uint16Array);
    for (let x = 0; x < words * 32; x++) assert.equal(hasFact(held, x), hasFact(bits, x), `fact ${x} of ${words * 32}`);
    assert.equal(hasFact(held, words * 32), false);
  }
});

test('a set past 65,536 facts is kept as a bitset', () => {
  const bits = new Uint32Array(2049);
  bits[2048] = 1;
  assert.equal(sparseFacts(bits), bits);
  assert.equal(hasFact(sparseFacts(bits), 65536), true);
});
