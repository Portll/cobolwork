// The set of upper-cased program names supplied by loaded packs (lib/packs.mjs programsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programsOf } from '../lib/packs.mjs';
import './pin-machine.mjs';

test('returns an empty set when given an empty array', () => {
  const result = programsOf([]);
  assert.ok(result instanceof Set);
  assert.equal(result.size, 0);
});

test('returns an empty set when a pack has no programs property', () => {
  const result = programsOf([{}]);
  assert.ok(result instanceof Set);
  assert.equal(result.size, 0);
});

test('returns an empty set when a pack has an empty programs array', () => {
  const result = programsOf([{ programs: [] }]);
  assert.ok(result instanceof Set);
  assert.equal(result.size, 0);
});

test('uppercases a single program name from one pack', () => {
  const result = programsOf([{ programs: ['hello'] }]);
  assert.deepEqual([...result], ['HELLO']);
});

test('collects program names from multiple packs', () => {
  const result = programsOf([
    { programs: ['a'] },
    { programs: ['b'] },
  ]);
  assert.deepEqual([...result].sort(), ['A', 'B']);
});

test('deduplicates program names that differ only by case', () => {
  const result = programsOf([{ programs: ['HELLO', 'hello', 'HeLLo'] }]);
  assert.deepEqual([...result], ['HELLO']);
});

test('deduplicates identical program names across multiple packs', () => {
  const result = programsOf([
    { programs: ['X'] },
    { programs: ['x'] },
  ]);
  assert.deepEqual([...result], ['X']);
});

test('handles multiple programs within a single pack', () => {
  const result = programsOf([{ programs: ['one', 'two', 'three'] }]);
  assert.deepEqual([...result], ['ONE', 'TWO', 'THREE']);
});
