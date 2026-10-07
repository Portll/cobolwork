// Splits an operand string on top-level commas, ignoring commas inside parentheses or single-quoted strings (lib/cards.mjs splitOperands).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitOperands } from '../lib/cards.mjs';
import './pin-machine.mjs';

test('splits a simple list of operands on commas', () => {
  assert.deepEqual(splitOperands('A,B,C'), ['A', 'B', 'C']);
});

test('keeps commas inside parentheses as part of the operand', () => {
  assert.deepEqual(splitOperands('DISP=(NEW,CATLG,DELETE)'), ['DISP=(NEW,CATLG,DELETE)']);
});

test('splits on top-level commas while preserving nested parentheses', () => {
  assert.deepEqual(splitOperands('A=(1,2),B=(3,4)'), ['A=(1,2)', 'B=(3,4)']);
});

test('keeps commas inside single-quoted strings as part of the operand', () => {
  assert.deepEqual(splitOperands("A='X,Y',B"), ["A='X,Y'", 'B']);
});

test('handles escaped single quotes inside quoted strings', () => {
  assert.deepEqual(splitOperands("A='It''s,ok',B"), ["A='It''s,ok'", 'B']);
});

test('returns a single element for input with no commas', () => {
  assert.deepEqual(splitOperands('HELLO'), ['HELLO']);
});

test('returns an empty array for empty input', () => {
  assert.deepEqual(splitOperands(''), []);
});

test('filters out trailing empty strings from trailing commas', () => {
  assert.deepEqual(splitOperands('A,B,'), ['A', 'B']);
});

test('keeps leading empty strings from leading commas', () => {
  assert.deepEqual(splitOperands(',A,B'), ['', 'A', 'B']);
});

test('handles mixed parentheses and quotes correctly', () => {
  assert.deepEqual(splitOperands("A=(1,'2,3'),B"), ["A=(1,'2,3')", 'B']);
});
