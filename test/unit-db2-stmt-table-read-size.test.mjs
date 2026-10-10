// Reads an integer and an optional size unit suffix (lib/db2/stmt/table.mjs readSize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSize } from '../lib/db2/stmt/table.mjs';
import './pin-machine.mjs';

const cursor = (tokens) => ({
  pos: 0,
  next() { return tokens[this.pos++] || null; },
  word(units) {
    const t = tokens[this.pos];
    if (t && t.t === 'word' && units.includes(t.v)) { this.pos++; return { u: t.v }; }
    return null;
  },
  fail(msg) { throw new Error(msg); },
});

test('returns a number when no unit suffix follows the integer', () => {
  assert.equal(readSize(cursor([{ t: 'num', v: '42' }, { t: 'word', v: 'OTHER' }])), 42);
});

test('returns a string with K suffix when K follows the integer', () => {
  assert.equal(readSize(cursor([{ t: 'num', v: '10' }, { t: 'word', v: 'K' }])), '10K');
});

test('returns a string with M suffix when M follows the integer', () => {
  assert.equal(readSize(cursor([{ t: 'num', v: '5' }, { t: 'word', v: 'M' }])), '5M');
});

test('returns a string with G suffix when G follows the integer', () => {
  assert.equal(readSize(cursor([{ t: 'num', v: '2' }, { t: 'word', v: 'G' }])), '2G');
});

test('returns a number when a non-unit word follows the integer', () => {
  assert.equal(readSize(cursor([{ t: 'num', v: '100' }, { t: 'word', v: 'BYTES' }])), 100);
});

test('returns a number when no token follows the integer', () => {
  assert.equal(readSize(cursor([{ t: 'num', v: '7' }])), 7);
});

test('throws an error when the first token is not a numeric token', () => {
  assert.throws(() => readSize(cursor([{ t: 'word', v: 'ABC' }])), /an integer/);
});

test('throws an error when the numeric token contains non-digit characters', () => {
  assert.throws(() => readSize(cursor([{ t: 'num', v: '12a' }])), /an integer/);
});
