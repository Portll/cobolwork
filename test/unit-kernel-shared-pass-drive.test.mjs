// Executes a sequence of steps, running each step's work items within memory limits. (lib/kernel/shared-pass.mjs drive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drive } from '../lib/kernel/shared-pass.mjs';
import './pin-machine.mjs';

test('returns the final value of a generator that yields no work steps', () => {
  function* gen() {
    yield { items: [], work: () => {}, opts: { guarded: false, label: 'scan' } };
    return 'done';
  }
  const result = drive(gen());
  assert.equal(result, 'done');
});

test('runs work on each item when guarded is false', () => {
  const seen = [];
  function* gen() {
    yield { items: [1, 2, 3], work: (v) => seen.push(v), opts: { guarded: false, label: 'test' } };
    return 'ok';
  }
  const result = drive(gen());
  assert.equal(result, 'ok');
  assert.deepEqual(seen, [1, 2, 3]);
});

test('returns the generator return value when it yields nothing', () => {
  function* gen() {
    return 'final';
  }
  const result = drive(gen());
  assert.equal(result, 'final');
});

test('handles multiple steps in sequence', () => {
  const calls = [];
  function* gen() {
    yield { items: ['a'], work: (v) => calls.push(['first', v]), opts: { guarded: false, label: 'l1' } };
    yield { items: ['b'], work: (v) => calls.push(['second', v]), opts: { guarded: false, label: 'l2' } };
    return 'end';
  }
  const result = drive(gen());
  assert.equal(result, 'end');
  assert.deepEqual(calls, [['first', 'a'], ['second', 'b']]);
});

test('processes empty items array without calling work', () => {
  let workCalled = false;
  function* gen() {
    yield { items: [], work: () => { workCalled = true; }, opts: { guarded: false, label: 'empty' } };
    return 'done';
  }
  const result = drive(gen());
  assert.equal(result, 'done');
  assert.equal(workCalled, false);
});

test('uses default label when not specified in opts', () => {
  const items = Array.from({ length: 5 }, (_, i) => i);
  function* gen() {
    yield { items, work: () => {}, opts: { guarded: false } };
    return 'ok';
  }
  const result = drive(gen());
  assert.equal(result, 'ok');
});

test('handles single item array', () => {
  const seen = [];
  function* gen() {
    yield { items: [42], work: (v) => seen.push(v), opts: { guarded: false, label: 'single' } };
    return 'done';
  }
  const result = drive(gen());
  assert.equal(result, 'done');
  assert.deepEqual(seen, [42]);
});

test('preserves order of items in work calls', () => {
  const seen = [];
  const items = Array.from({ length: 10 }, (_, i) => i * 10);
  function* gen() {
    yield { items, work: (v) => seen.push(v), opts: { guarded: false, label: 'ordered' } };
    return 'ok';
  }
  const result = drive(gen());
  assert.equal(result, 'ok');
  assert.deepEqual(seen, items);
});
