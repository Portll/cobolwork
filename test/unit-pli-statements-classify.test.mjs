// Classifies a tokenised PL/I statement into a high-level category (lib/pli/statements.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

test('classify returns NULL for an empty token list', () => {
  const stmt = { toks: [] };
  assert.equal(classify(stmt), 'NULL');
});

test('classify returns PREPROCESSOR when the first token is the % operator', () => {
  const stmt = { toks: [{ t: 'op', v: '%' }] };
  assert.equal(classify(stmt), 'PREPROCESSOR');
});

test('classify returns IF when the statement starts with IF and a top-level THEN follows', () => {
  const stmt = {
    toks: [
      { t: 'word', u: 'IF' },
      { t: 'op', v: '(' },
      { t: 'word', u: 'X' },
      { t: 'op', v: ')' },
      { t: 'word', u: 'THEN' },
    ],
  };
  assert.equal(classify(stmt), 'IF');
});

test('classify returns IF via keyword map when IF has no top-level THEN', () => {
  const stmt = {
    toks: [
      { t: 'word', u: 'IF' },
      { t: 'word', u: 'X' },
    ],
  };
  assert.equal(classify(stmt), 'IF');
});

test('classify returns ASSIGNMENT when an assignment operator is present', () => {
  const stmt = {
    toks: [
      { t: 'word', u: 'TOTAL' },
      { t: 'op', v: '=' },
      { t: 'num', v: '0' },
    ],
  };
  assert.equal(classify(stmt), 'ASSIGNMENT');
});

test('classify returns CALL when the first word is a keyword and no assignment is detected', () => {
  const stmt = {
    toks: [
      { t: 'word', u: 'CALL' },
      { t: 'word', u: 'PROC' },
    ],
  };
  assert.equal(classify(stmt), 'CALL');
});

test('classify returns DECLARE_FRAGMENT for a level number followed by a word', () => {
  const stmt = {
    toks: [
      { t: 'num', v: '01' },
      { t: 'word', u: 'NAME' },
    ],
  };
  assert.equal(classify(stmt), 'DECLARE_FRAGMENT');
});

test('classify returns UNKNOWN when a numeric token is not all digits', () => {
  const stmt = {
    toks: [
      { t: 'num', v: '01A' },
      { t: 'word', u: 'NAME' },
    ],
  };
  assert.equal(classify(stmt), 'UNKNOWN');
});

test('classify returns UNKNOWN for a word that is not a known keyword', () => {
  const stmt = {
    toks: [
      { t: 'word', u: 'FOO' },
    ],
  };
  assert.equal(classify(stmt), 'UNKNOWN');
});
