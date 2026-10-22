// Parses an HLA address expression into a displacement and optional parenthesised parts (lib/hlasm/expr.mjs parseAddress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress } from '../lib/hlasm/expr.mjs';
import './pin-machine.mjs';

test('returns a single number as the displacement with no parts', () => {
  assert.deepEqual(parseAddress('10'), { disp: { t: 'num', v: 10 }, parts: null });
});

test('returns a named symbol as the displacement with no parts', () => {
  assert.deepEqual(parseAddress('X'), { disp: { t: 'sym', name: 'X' }, parts: null });
});

test('returns a binary expression as the displacement with no parts', () => {
  assert.deepEqual(parseAddress('1+2'), { disp: { t: 'bin', op: '+', l: { t: 'num', v: 1 }, r: { t: 'num', v: 2 } }, parts: null });
});

test('returns a displacement with one parenthesised part', () => {
  assert.deepEqual(parseAddress('10(B)'), { disp: { t: 'num', v: 10 }, parts: [{ t: 'sym', name: 'B' }] });
});

test('returns a displacement with two parenthesised parts', () => {
  assert.deepEqual(parseAddress('10(B,C)'), { disp: { t: 'num', v: 10 }, parts: [{ t: 'sym', name: 'B' }, { t: 'sym', name: 'C' }] });
});

test('returns a displacement with a trailing comma producing a null part', () => {
  assert.deepEqual(parseAddress('10(B,)'), { disp: { t: 'num', v: 10 }, parts: [{ t: 'sym', name: 'B' }, null] });
});

test('returns a displacement with a leading comma producing a null part', () => {
  assert.deepEqual(parseAddress('10(,B)'), { disp: { t: 'num', v: 10 }, parts: [null, { t: 'sym', name: 'B' }] });
});

test('returns a displacement with an empty parenthesised part as null', () => {
  assert.deepEqual(parseAddress('10()'), { disp: { t: 'num', v: 10 }, parts: [null] });
});

test('throws when the text after the expression is not a valid parenthesised part', () => {
  assert.throws(() => parseAddress('10(B'), /unexpected/);
});

test('throws when the text after the expression is not a parenthesis', () => {
  assert.throws(() => parseAddress('10 B'), /unexpected/);
});
