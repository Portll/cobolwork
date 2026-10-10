// An optional sign and a number token, as a signed string (lib/db2/stmt/table.mjs readNumber).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNumber } from '../lib/db2/stmt/table.mjs';
import './pin-machine.mjs';

class MockCursor {
  constructor(tokens, ops = {}) {
    this.tokens = tokens;
    this.index = 0;
    this.pos = 0;
    this.ops = ops;
  }
  op(ch) {
    return !!this.ops[ch];
  }
  next() {
    this.pos++;
    if (this.index < this.tokens.length) {
      return this.tokens[this.index++];
    }
    this.index++;
    return undefined;
  }
  fail(msg) {
    throw new Error(msg);
  }
}

test('readNumber returns a negative signed string when "-" operator is present', () => {
  const c = new MockCursor([{ t: 'num', v: '123' }], { '-': true });
  const result = readNumber(c);
  assert.strictEqual(result, '-123');
});

test('readNumber returns an unsigned string when "-" absent and "+" present', () => {
  const c = new MockCursor([{ t: 'num', v: '123' }], { '+': true });
  const result = readNumber(c);
  assert.strictEqual(result, '123');
});

test('readNumber returns an unsigned string when no sign operators are present', () => {
  const c = new MockCursor([{ t: 'num', v: '456' }]);
  const result = readNumber(c);
  assert.strictEqual(result, '456');
});

test('readNumber throws and restores cursor position when next token is not a number', () => {
  const c = new MockCursor([{ t: 'id', v: 'X' }]);
  assert.throws(() => readNumber(c), { message: 'a number' });
  assert.strictEqual(c.pos, 0);
});

test('readNumber throws and leaves cursor position incremented when no token is available', () => {
  const c = new MockCursor([]);
  assert.throws(() => readNumber(c), { message: 'a number' });
  assert.strictEqual(c.pos, 1);
});
