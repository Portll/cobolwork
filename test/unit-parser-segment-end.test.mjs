// Computes the index of the token that ends a COBOL segment (lib/parser.mjs segmentEnd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentEnd } from '../lib/parser.mjs';
import './pin-machine.mjs';

test('returns the index of a period token when no parentheses are open', () => {
  const tokens = [
    { t: 'word', u: 'MOVE' },
    { t: 'word', u: 'TO' },
    { t: 'word', u: 'X' },
    { t: 'period' },
    { t: 'word', u: 'DISPLAY' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 3);
});

test('returns the index of an exec token when it appears before any verb', () => {
  const tokens = [
    { t: 'word', u: 'CALL' },
    { t: 'word', u: 'PROCEDURE' },
    { t: 'exec' },
    { t: 'word', u: 'DISPLAY' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 2);
});

test('skips tokens inside parentheses and returns the index of the closing period', () => {
  const tokens = [
    { t: 'word', u: 'IF' },
    { t: 'sep', v: '(' },
    { t: 'word', u: 'X' },
    { t: 'sep', v: ')' },
    { t: 'period' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 4);
});

test('returns the index of a verb token when it is not preceded by EXIT PERFORM, USAGE, UPON, UNTIL, or IS', () => {
  const tokens = [
    { t: 'word', u: 'MOVE' },
    { t: 'word', u: 'TO' },
    { t: 'word', u: 'Y' },
    { t: 'word', u: 'DISPLAY' },
    { t: 'word', u: 'X' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 3);
});

test('does not return EXIT when preceded by EXIT PERFORM', () => {
  const tokens = [
    { t: 'word', u: 'EXIT' },
    { t: 'word', u: 'PERFORM' },
    { t: 'word', u: 'DISPLAY' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 2);
});

test('does not return EXIT when preceded by UNTIL', () => {
  const tokens = [
    { t: 'word', u: 'UNTIL' },
    { t: 'word', u: 'EXIT' },
    { t: 'word', u: 'DISPLAY' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 2);
});

test('does not return DISPLAY when preceded by IS', () => {
  const tokens = [
    { t: 'word', u: 'IS' },
    { t: 'word', u: 'DISPLAY' },
    { t: 'word', u: 'X' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 3);
});

test('returns the index of a scope terminator token when it appears', () => {
  const tokens = [
    { t: 'word', u: 'END-IF' },
    { t: 'word', u: 'DISPLAY' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 1);
});

test('returns the final index when no terminating token is found', () => {
  const tokens = [
    { t: 'word', u: 'MOVE' },
    { t: 'word', u: 'TO' },
    { t: 'word', u: 'X' }
  ];
  const result = segmentEnd(tokens, 0, tokens.length);
  assert.strictEqual(result, 3);
});
