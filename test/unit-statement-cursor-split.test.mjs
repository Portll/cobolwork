// Splits a token array at depth-0 separator operators (lib/statement-cursor.mjs split).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { split } from '../lib/statement-cursor.mjs';
import './pin-machine.mjs';

test('returns an empty array when given no tokens', () => {
  assert.deepEqual(split([], ','), []);
});

test('returns the single token when no separator is present', () => {
  const toks = [{ t: 'id', v: 'x' }];
  assert.deepEqual(split(toks, ','), [toks]);
});

test('splits at a depth-0 separator into two parts', () => {
  const toks = [
    { t: 'id', v: 'a' },
    { t: 'op', v: ',' },
    { t: 'id', v: 'b' }
  ];
  assert.deepEqual(split(toks, ','), [[{ t: 'id', v: 'a' }], [{ t: 'id', v: 'b' }]]);
});

test('does not split when the separator is inside parentheses', () => {
  const toks = [
    { t: 'op', v: '(' },
    { t: 'id', v: 'a' },
    { t: 'op', v: ',' },
    { t: 'id', v: 'b' },
    { t: 'op', v: ')' }
  ];
  assert.deepEqual(split(toks, ','), [toks]);
});

test('splits multiple depth-0 separators into three parts', () => {
  const toks = [
    { t: 'id', v: 'a' },
    { t: 'op', v: ',' },
    { t: 'id', v: 'b' },
    { t: 'op', v: ',' },
    { t: 'id', v: 'c' }
  ];
  assert.deepEqual(split(toks, ','), [
    [{ t: 'id', v: 'a' }],
    [{ t: 'id', v: 'b' }],
    [{ t: 'id', v: 'c' }]
  ]);
});

test('handles a leading separator producing an initial empty part', () => {
  const toks = [
    { t: 'op', v: ',' },
    { t: 'id', v: 'a' }
  ];
  assert.deepEqual(split(toks, ','), [[], [{ t: 'id', v: 'a' }]]);
});

test('returns all empty parts when only separators are present', () => {
  const toks = [
    { t: 'op', v: ',' },
    { t: 'op', v: ',' }
  ];
  assert.deepEqual(split(toks, ','), [[], [], []]);
});
