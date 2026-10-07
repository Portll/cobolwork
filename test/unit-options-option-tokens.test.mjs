// Splits COBOL option text into upper-cased tokens, keeping parenthesised groups intact (lib/options.mjs optionTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionTokens } from '../lib/options.mjs';
import './pin-machine.mjs';

test('returns an empty array for an empty string', () => {
  assert.deepEqual(optionTokens(''), []);
});

test('returns a single upper-cased token for a simple word', () => {
  assert.deepEqual(optionTokens('debug'), ['DEBUG']);
});

test('splits on spaces into multiple upper-cased tokens', () => {
  assert.deepEqual(optionTokens('debug trace'), ['DEBUG', 'TRACE']);
});

test('splits on commas into multiple upper-cased tokens', () => {
  assert.deepEqual(optionTokens('debug,trace'), ['DEBUG', 'TRACE']);
});

test('splits on mixed spaces and commas', () => {
  assert.deepEqual(optionTokens('debug, trace'), ['DEBUG', 'TRACE']);
});

test('keeps parenthesised groups with commas as a single token', () => {
  assert.deepEqual(optionTokens('SSRANGE(NOZLEN,ABD)'), ['SSRANGE(NOZLEN,ABD)']);
});

test('splits on spaces around a parenthesised group', () => {
  assert.deepEqual(optionTokens('SSRANGE(NOZLEN,ABD) debug'), ['SSRANGE(NOZLEN,ABD)', 'DEBUG']);
});

test('handles nested parentheses as a single token', () => {
  assert.deepEqual(optionTokens('OPT(A(B,C))'), ['OPT(A(B,C))']);
});

test('ignores leading and trailing whitespace', () => {
  assert.deepEqual(optionTokens('  debug  '), ['DEBUG']);
});

test('ignores consecutive delimiters', () => {
  assert.deepEqual(optionTokens('debug,,trace'), ['DEBUG', 'TRACE']);
});
