// Index of the closing parenthesis for the one at `open` (lib/pli/lex.mjs closing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closing } from '../lib/pli/lex.mjs';
import './pin-machine.mjs';

test('returns the index of the matching closing parenthesis when one pair is present', () => {
  const toks = [
    { t: 'op', v: '(' },
    { t: 'op', v: ')' }
  ];
  assert.strictEqual(closing(toks, 0), 1);
});

test('returns -1 when the opening parenthesis is not closed', () => {
  const toks = [
    { t: 'op', v: '(' },
    { t: 'op', v: '(' },
    { t: 'op', v: ')' }
  ];
  assert.strictEqual(closing(toks, 0), -1);
});

test('handles nested parentheses correctly', () => {
  const toks = [
    { t: 'op', v: '(' },
    { t: 'op', v: '(' },
    { t: 'op', v: ')' },
    { t: 'op', v: ')' }
  ];
  assert.strictEqual(closing(toks, 0), 3);
});

test('returns -1 when a closing parenthesis comes before any opening one', () => {
  const toks = [
    { t: 'op', v: '[' },
    { t: 'op', v: ')' }
  ];
  assert.strictEqual(closing(toks, 0), -1);
});

test('finds the closing parenthesis even if there are other tokens between', () => {
  const toks = [
    { t: 'op', v: '(' },
    { t: 'id', v: 'x' },
    { t: 'op', v: ')' },
    { t: 'op', v: '(' },
    { t: 'op', v: ')' }
  ];
  assert.strictEqual(closing(toks, 0), 2);
});
