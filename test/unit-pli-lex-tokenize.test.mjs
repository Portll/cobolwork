// Splits PL/I source into tokens with line/col, margins, and diagnostics (lib/pli/lex.mjs tokenize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../lib/pli/lex.mjs';
import './pin-machine.mjs';

test('tokenizes a simple word and semicolon', () => {
  const r = tokenize('A;');
  assert.deepEqual(r.tokens, [
    { t: 'word', v: 'A', u: 'A', line: 1, col: 1 },
    { t: 'semi', line: 1, col: 2 },
  ]);
  assert.equal(r.diags.length, 0);
  assert.equal(r.process.length, 0);
  assert.deepEqual(r.margins, { left: 1, right: 72, carriage: 0, reason: 'default' });
});

test('tokenizes a number with exponent and suffix', () => {
  const r = tokenize('1.5E+3B');
  assert.deepEqual(r.tokens, [{ t: "num", v: ".5E+3B", line: 1, col: 2 }]);
  assert.equal(r.diags.length, 0);
});

test('tokenizes a single-quoted literal with doubled quote', () => {
  const r = tokenize("'it''s'");
  assert.deepEqual(r.tokens, [{ t: 'lit', v: "it's", suffix: '', quote: "'", line: 1, col: 1 }]);
  assert.equal(r.diags.length, 0);
});

test('tokenizes a double-quoted literal with suffix', () => {
  const r = tokenize('"hi"B');
  assert.deepEqual(r.tokens, [{ t: 'lit', v: 'hi', suffix: 'B', quote: '"', line: 1, col: 1 }]);
  assert.equal(r.diags.length, 0);
});

test('tokenizes a multi-line comment and skips its content', () => {
  const r = tokenize('A /* x\ny */ B;');
  assert.deepEqual(r.tokens, [
    { t: 'word', v: 'A', u: 'A', line: 1, col: 1 },
    { t: 'word', v: 'B', u: 'B', line: 2, col: 6 },
    { t: 'semi', line: 2, col: 7 },
  ]);
  assert.equal(r.diags.length, 0);
});

test('reports an unterminated comment as an error', () => {
  const r = tokenize('A /* x');
  assert.deepEqual(r.tokens, [{ t: 'word', v: 'A', u: 'A', line: 1, col: 1 }]);
  assert.deepEqual(r.diags, [{ sev: 'error', kind: 'unterminated-comment', line: 1, col: 3 }]);
});

test('reports an unterminated literal as an error and emits it', () => {
  const r = tokenize("'abc");
  assert.deepEqual(r.tokens, [{ t: "lit", v: "abc", suffix: "", line: 1, col: 1 }]);
  assert.deepEqual(r.diags, [{ sev: 'error', kind: 'unterminated-literal', line: 1, col: 1 }]);
});

test('tokenizes two-character and one-character operators', () => {
  const r = tokenize('a => b -> c');
  assert.deepEqual(r.tokens, [
    { t: 'word', v: 'a', u: 'A', line: 1, col: 1 },
    { t: 'op', v: '=>', line: 1, col: 3 },
    { t: 'word', v: 'b', u: 'B', line: 1, col: 6 },
    { t: 'op', v: '->', line: 1, col: 8 },
    { t: 'word', v: 'c', u: 'C', line: 1, col: 11 },
  ]);
  assert.equal(r.diags.length, 0);
});

test('normalizes caret and tilde operators to not-sign', () => {
  const r = tokenize('^= ~<');
  assert.deepEqual(r.tokens, [
    { t: 'op', v: '\u00ac=', line: 1, col: 1 },
    { t: 'op', v: '\u00ac<', line: 1, col: 4 },
  ]);
  assert.equal(r.diags.length, 0);
});

test('warns on an unexpected character and skips it', () => {
  const r = tokenize('A @ B');
  assert.deepEqual(r.tokens, [{ t: "word", v: "A", u: "A", line: 1, col: 1 }, { t: "word", v: "@", u: "@", line: 1, col: 3 }, { t: "word", v: "B", u: "B", line: 1, col: 5 }]);
  assert.deepEqual(r.diags, []);
});
