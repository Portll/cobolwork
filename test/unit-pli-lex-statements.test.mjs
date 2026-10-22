// Splits a token stream into statements at semicolons, stripping label and condition prefixes. (lib/pli/lex.mjs statements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statements } from '../lib/pli/lex.mjs';
import './pin-machine.mjs';

const w = (v, line = 1, file) => ({ t: 'word', v, u: v, line, ...(file ? { file } : {}) });
const o = (v, line = 1, file) => ({ t: 'op', v, line, ...(file ? { file } : {}) });
const n = (v, line = 1, file) => ({ t: 'num', v, line, ...(file ? { file } : {}) });
const s = (line = 1, file) => ({ t: 'semi', line, ...(file ? { file } : {}) });

test('returns an empty array for an empty token stream', () => {
  assert.deepEqual(statements([]), []);
});

test('keeps a trailing run without a semicolon and flags it unterminated', () => {
  const toks = [w('MOVE'), w('A'), w('TO'), w('B')];
  const out = statements(toks);
  assert.equal(out.length, 1);
  assert.equal(out[0].unterminated, true);
  assert.equal(out[0].line, 1);
  assert.equal(out[0].endLine, 1);
  assert.deepEqual(out[0].toks, toks);
  assert.deepEqual(out[0].labels, []);
  assert.deepEqual(out[0].conditions, []);
});

test('splits statements at semicolons and records the semicolon line as endLine', () => {
  const toks = [w('MOVE', 1), w('A', 1), s(2), w('ADD', 3), w('B', 3), s(4)];
  const out = statements(toks);
  assert.equal(out.length, 2);
  assert.equal(out[0].line, 1);
  assert.equal(out[0].endLine, 2);
  assert.equal(out[1].line, 3);
  assert.equal(out[1].endLine, 4);
  assert.equal(out[0].unterminated, undefined);
  assert.equal(out[1].unterminated, undefined);
  assert.deepEqual(out[0].toks, [w('MOVE', 1), w('A', 1)]);
  assert.deepEqual(out[1].toks, [w('ADD', 3), w('B', 3)]);
});

test('strips a simple label prefix before classifying the statement', () => {
  const toks = [w('PARA'), o(':'), w('MOVE'), w('A')];
  const out = statements(toks);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].labels, [{ name: 'PARA', line: 1 }]);
  assert.deepEqual(out[0].conditions, []);
  assert.deepEqual(out[0].toks, [w('MOVE'), w('A')]);
  assert.equal(out[0].line, 1);
});

test('strips a subscripted label prefix with a numeric subscript', () => {
  const toks = [w('PARA'), o('('), n('3'), o(')'), o(':'), w('MOVE'), w('A')];
  const out = statements(toks);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].labels, [{ name: 'PARA', line: 1, subscript: '3' }]);
  assert.deepEqual(out[0].conditions, []);
  assert.deepEqual(out[0].toks, [w('MOVE'), w('A')]);
});

test('strips a condition prefix with a single word', () => {
  const toks = [o('('), w('SIZE'), o(')'), o(':'), w('MOVE'), w('A')];
  const out = statements(toks);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].labels, []);
  assert.deepEqual(out[0].conditions, ['SIZE']);
  assert.deepEqual(out[0].toks, [w('MOVE'), w('A')]);
});

test('strips a condition prefix with multiple comma-separated words', () => {
  const toks = [o('('), w('SIZE'), o(','), w('NOFOFL'), o(')'), o(':'), w('MOVE'), w('A')];
  const out = statements(toks);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].labels, []);
  assert.deepEqual(out[0].conditions, ['SIZE', 'NOFOFL']);
  assert.deepEqual(out[0].toks, [w('MOVE'), w('A')]);
});

test('strips multiple mixed prefixes in sequence', () => {
  const toks = [w('PARA'), o(':'), o('('), w('SIZE'), o(')'), o(':'), w('MOVE'), w('A')];
  const out = statements(toks);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].labels, [{ name: 'PARA', line: 1 }]);
  assert.deepEqual(out[0].conditions, ['SIZE']);
  assert.deepEqual(out[0].toks, [w('MOVE'), w('A')]);
});

test('propagates the file property from the first token of each statement', () => {
  const toks = [w('MOVE', 1, 'a.cob'), w('A', 1, 'a.cob'), s(2, 'a.cob'), w('ADD', 3, 'b.cob'), w('B', 3, 'b.cob'), s(4, 'b.cob')];
  const out = statements(toks);
  assert.equal(out[0].file, 'a.cob');
  assert.equal(out[1].file, 'b.cob');
});

test('does not treat a word followed by a non-colon operator as a label prefix', () => {
  const toks = [w('PARA'), o('('), w('MOVE'), w('A')];
  const out = statements(toks);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].labels, []);
  assert.deepEqual(out[0].conditions, []);
  assert.deepEqual(out[0].toks, toks);
});
