// Parses a token and returns its integer value (lib/db2/stmt/table.mjs readInteger).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInteger } from '../lib/db2/stmt/table.mjs';
import './pin-machine.mjs';

class MockCursor {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  next() {
    return this.tokens[this.pos++];
  }
  fail(msg) {
    throw new Error(msg);
  }
}

test('returns a number when the token is a numeric string', () => {
  const c = new MockCursor([{ t: 'num', v: '123' }]);
  const result = readInteger(c);
  assert.strictEqual(result, 123);
  assert.strictEqual(c.pos, 1);
});

test('throws an error when the token is not a number token', () => {
  const c = new MockCursor([{ t: 'id', v: 'abc' }]);
  assert.throws(() => readInteger(c), /an integer/);
  assert.strictEqual(c.pos, 0);
});

test('throws an error when the token is a number token but not an integer string', () => {
  const c = new MockCursor([{ t: 'num', v: '12.3' }]);
  assert.throws(() => readInteger(c), /an integer/);
  assert.strictEqual(c.pos, 0);
});

test('does not decrement position when there is no token', () => {
  const c = new MockCursor([]);
  assert.throws(() => readInteger(c), /an integer/);
  assert.strictEqual(c.pos, 1);
});

test('parses a numeric string with leading zeros correctly', () => {
  const c = new MockCursor([{ t: 'num', v: '001' }]);
  const result = readInteger(c);
  assert.strictEqual(result, 1);
  assert.strictEqual(c.pos, 1);
});

test('parses the integer zero correctly', () => {
  const c = new MockCursor([{ t: 'num', v: '0' }]);
  const result = readInteger(c);
  assert.strictEqual(result, 0);
  assert.strictEqual(c.pos, 1);
});

test('throws an error when the token is a number token with non-digit characters', () => {
  const c = new MockCursor([{ t: 'num', v: '123a' }]);
  assert.throws(() => readInteger(c), /an integer/);
  assert.strictEqual(c.pos, 0);
});
