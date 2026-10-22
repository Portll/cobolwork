// Splits a field into comma-separated operands, respecting quotes and parentheses (lib/hlasm/operands.mjs splitOperands).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitOperands } from '../lib/hlasm/operands.mjs';
import './pin-machine.mjs';

test('returns an empty array for an empty string', () => {
  assert.deepEqual(splitOperands(''), []);
});

test('returns a single operand for a string without commas', () => {
  assert.deepEqual(splitOperands('ABC'), ['ABC']);
});

test('splits on commas at depth zero', () => {
  assert.deepEqual(splitOperands('A,B,C'), ['A', 'B', 'C']);
});

test('does not split on commas inside parentheses', () => {
  assert.deepEqual(splitOperands('A(B,C),D'), ['A(B,C)', 'D']);
});

test('does not split on commas inside single quotes', () => {
  assert.deepEqual(splitOperands("A'B,C',D"), ["A'B,C'", 'D']);
});

test('handles escaped quotes inside quoted strings', () => {
  assert.deepEqual(splitOperands("A'B''C',D"), ["A'B''C'", 'D']);
});

test('throws an error for an unclosed quote', () => {
  assert.throws(() => splitOperands("A'B"), { name: 'HlasmSyntax', message: 'a quoted string in the operands is not closed' });
});

test('throws an error for an unclosed parenthesis', () => {
  assert.throws(() => splitOperands('A(B'), { name: 'HlasmSyntax', message: 'a parenthesis in the operands is not closed' });
});

test('throws an error for a closing parenthesis without an opening one', () => {
  assert.throws(() => splitOperands('A)B'), { name: 'HlasmSyntax', message: 'a closing parenthesis has no opening one at column 2 of the operands' });
});

test('treats a quote after an attribute letter as an attribute reference, not a string start', () => {
  assert.deepEqual(splitOperands("L'FIELD"), ["L'FIELD"]);
});
