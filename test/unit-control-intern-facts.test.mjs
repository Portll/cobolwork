// internFacts deduplicates fact sets and stores them as compact Uint16Arrays (lib/control.mjs internFacts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internFacts } from '../lib/control.mjs';
import './pin-machine.mjs';

test('single fact with small bitset becomes a Uint16Array of set bit indices', () => {
  const facts = new Map([[1, [1, 0]]]);
  const result = internFacts(facts);
  assert.deepStrictEqual(result.get(1), new Uint16Array([0]));
});

test('duplicate fact sets at different points share the same Uint16Array instance', () => {
  const bits = [1, 0];
  const facts = new Map([[1, bits], [2, bits]]);
  const result = internFacts(facts);
  assert.strictEqual(result.get(1), result.get(2));
  assert.deepStrictEqual(result.get(1), new Uint16Array([0]));
});

test('large bitset that exceeds 65536 bits is returned unchanged and not pooled', () => {
  const largeBits = new Uint32Array(2049);
  largeBits[0] = 1;
  const facts = new Map([[1, largeBits]]);
  const result = internFacts(facts);
  assert.strictEqual(result.get(1), largeBits);
});

test('empty bitset produces an empty Uint16Array', () => {
  const facts = new Map([[1, []]]);
  const result = internFacts(facts);
  assert.deepStrictEqual(result.get(1), new Uint16Array(0));
});

test('multiple set bits are stored in ascending order of bit index', () => {
  const bits = [5, 0];
  const facts = new Map([[1, bits]]);
  const result = internFacts(facts);
  assert.deepStrictEqual(result.get(1), new Uint16Array([0, 2]));
});

test('bits spanning multiple words are stored with correct global indices', () => {
  const bits = [1, 2];
  const facts = new Map([[1, bits]]);
  const result = internFacts(facts);
  assert.deepStrictEqual(result.get(1), new Uint16Array([0, 33]));
});

test('distinct bitsets with same hash are kept as separate entries', () => {
  const bitsA = [1, 0];
  const bitsB = [2, 0];
  const facts = new Map([[1, bitsA], [2, bitsB]]);
  const result = internFacts(facts);
  assert.notStrictEqual(result.get(1), result.get(2));
  assert.deepStrictEqual(result.get(1), new Uint16Array([0]));
  assert.deepStrictEqual(result.get(2), new Uint16Array([1]));
});

test('bitsets of different lengths are not considered equal', () => {
  const bitsA = [1];
  const bitsB = [1, 0];
  const facts = new Map([[1, bitsA], [2, bitsB]]);
  const result = internFacts(facts);
  assert.notStrictEqual(result.get(1), result.get(2));
  assert.deepStrictEqual(result.get(1), new Uint16Array([0]));
  assert.deepStrictEqual(result.get(2), new Uint16Array([0]));
});
