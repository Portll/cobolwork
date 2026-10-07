// Runs a parse, giving null where the tokens are not something the model reads (lib/arith.mjs attempt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attempt, parser } from '../lib/arith.mjs';
import './pin-machine.mjs';

test('returns the value when the function succeeds', () => {
  assert.equal(attempt(() => 42), 42);
});

test('returns null when the function throws the parser symbol', () => {
  assert.equal(attempt(() => { throw parser; }), null);
});

test('rethrows when the function throws a different error', () => {
  const err = new Error('boom');
  assert.throws(() => attempt(() => { throw err; }), err);
});

test('returns null when a nested throw of the parser symbol is caught', () => {
  assert.equal(attempt(() => {
    try {
      throw parser;
    } catch (e) {
      throw e;
    }
  }), null);
});

test('returns the value when the function returns a complex object', () => {
  const obj = { k: 'const', v: 1n };
  assert.deepEqual(attempt(() => obj), obj);
});

test('returns null when the function throws the parser symbol after some work', () => {
  let sideEffect = 0;
  assert.equal(attempt(() => {
    sideEffect = 1;
    throw parser;
  }), null);
});

test('rethrows when the function throws a non-parser error after some work', () => {
  let sideEffect = 0;
  const err = new TypeError('bad');
  assert.throws(() => attempt(() => {
    sideEffect = 1;
    throw err;
  }), err);
});

test('returns null when the function throws the parser symbol from a deeply nested call', () => {
  function deep() {
    throw parser;
  }
  function mid() {
    deep();
  }
  assert.equal(attempt(() => {
    mid();
  }), null);
});
