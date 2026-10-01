import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marginsOf, tokenize, readPli } from '../lib/pli/lex.mjs';
import { classify, parseStatement } from '../lib/pli/statements.mjs';

const seq = (s, n) => s.padEnd(72) + String(n).padStart(8, '0');

test('a sequence area in columns 73-80 is outside the statement', () => {
  const text = [seq(' X = 1;', 10), seq(' Y = 2;', 20)].join('\n');
  assert.deepEqual(marginsOf(text), { left: 2, right: 72, carriage: 0, reason: 'sequence-area' });
  assert.deepEqual(readPli(text).statements.map((s) => s.toks.map((t) => t.v).join(' ')), ['X = 1', 'Y = 2']);
});

test('source in column 1 or beyond column 72 widens the margins', () => {
  assert.equal(marginsOf('/* c */\nX = 1;').left, 1);
  assert.equal(marginsOf(' X = ' + '1'.repeat(80) + ';').right, Infinity);
});

test('*PROCESS MARGINS overrides what the text suggests', () => {
  const m = marginsOf('*PROCESS MARGINS(1,100) NOT(\'^\');\nX = 1;');
  assert.deepEqual(m, { left: 1, right: 100, carriage: 0, reason: 'process-option' });
});

test('a comment and a literal may run across lines; a doubled quote is one quote', () => {
  const { tokens } = tokenize(" A = 'IT''S /* not */\n A';  /* a\n comment */ B = '0101'B;", { margins: { left: 1, right: Infinity } });
  const lits = tokens.filter((t) => t.t === 'lit');
  assert.equal(lits[0].v, "IT'S /* not */ A");
  assert.deepEqual([lits[1].v, lits[1].suffix], ['0101', 'B']);
  assert.equal(tokens.filter((t) => t.t === 'semi').length, 2);
});

test('not and or symbols are read as one operator whichever character the source uses', () => {
  const ops = (s) => tokenize(s, { margins: { left: 1, right: Infinity } }).tokens.filter((t) => t.t === 'op').map((t) => t.v);
  assert.deepEqual(ops('A ^= B | C ¬= D ~= E !! F'), ['¬=', '|', '¬=', '¬=', '||']);
});

test('labels and condition prefixes come off the statement', () => {
  const [st] = readPli(' (SIZE, NOFOFL): L1: L2(3): X = 1;').statements;
  assert.deepEqual(st.conditions, ['SIZE', 'NOFOFL']);
  assert.deepEqual(st.labels.map((l) => l.name), ['L1', 'L2']);
  assert.equal(st.labels[1].subscript, '3');
  assert.equal(classify(st), 'ASSIGNMENT');
});

test('no reserved words: a statement reading as references then = is an assignment', () => {
  const kinds = readPli(' IF = 1; IF A = B THEN X = 1; DO I = 1 TO 10; A, B.C(2)->D = 0; SUBSTR(S,1,2) = \'AB\'; CALL P;').statements.map(classify);
  assert.deepEqual(kinds, ['ASSIGNMENT', 'IF', 'DO', 'ASSIGNMENT', 'ASSIGNMENT', 'CALL']);
});

test('a kind with no parser yet is unbuilt, and text no kind fits is unknown', () => {
  const [a, b] = readPli(' CALL P; FROB X;').statements.map(parseStatement);
  assert.equal(a.status, 'unbuilt');
  assert.equal(b.status, 'unknown');
});
