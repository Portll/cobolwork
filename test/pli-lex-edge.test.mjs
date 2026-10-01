// SPDX-License-Identifier: AGPL-3.0-or-later
// Edge-case tests for the PL/I lexer and classifier: literal suffixes, numbers, operators,
// prefixes, margins, and classification of keyword-like names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, readPli, marginsOf } from '../lib/pli/lex.mjs';
import { classify, parseStatement } from '../lib/pli/statements.mjs';

const ops = (s) => tokenize(s, { margins: { left: 1, right: Infinity } }).tokens.filter((t) => t.t === 'op').map((t) => t.v);
const lits = (s) => tokenize(s, { margins: { left: 1, right: Infinity } }).tokens.filter((t) => t.t === 'lit').map((t) => [t.v, t.suffix]);
const nums = (s) => tokenize(s, { margins: { left: 1, right: Infinity } }).tokens.filter((t) => t.t === 'num').map((t) => t.v);
const kinds = (s) => readPli(s).statements.map(classify);

test('literal suffixes are read as part of the literal', () => {
  assert.deepEqual(lits(" A = 'C1'X;"), [['C1', 'X']]);
  assert.deepEqual(lits(" A = '0101'B;"), [['0101', 'B']]);
  assert.deepEqual(lits(" A = 'F'B4;"), [['F', 'B4']]);
  assert.deepEqual(lits(" A = 'abc'A;"), [['abc', 'A']]);
  assert.deepEqual(lits(" A = 'xx'XN;"), [['xx', 'XN']]);
  assert.deepEqual(lits(" A = 'xx'GX;"), [['xx', 'GX']]);
});

test('numbers: 1E5, 1.5E-3, 101B, .5, 12_345 (UNVERIFIED: 12_345)', () => {
  assert.deepEqual(nums(' A = 1E5;'), ['1E5']);
  assert.deepEqual(nums(' A = 1.5E-3;'), ['1.5E-3']);
  assert.deepEqual(nums(' A = 101B;'), ['101B']);
  assert.deepEqual(nums(' A = .5;'), ['.5']);
  assert.deepEqual(nums(' A = 12_345;'), ['12_345']);
});

test('a comment containing ; and quotes does not split the statement', () => {
  const { statements } = readPli(" A = 1; /* a ; 'b' */ B = 2;");
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0].toks.map((t) => t.v), ['A', '=', '1']);
  assert.deepEqual(statements[1].toks.map((t) => t.v), ['B', '=', '2']);
});

test('a string containing /* is not a comment', () => {
  const { statements } = readPli(" A = '/*'; B = 2;");
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0].toks.map((t) => t.v), ['A', '=', '/*']);
});

test('operators: ^=, ¬=, ~=, <>, ¬<, ->, =>, ||, !!', () => {
  assert.deepEqual(ops(' A ^= B;'), ['¬=']);
  assert.deepEqual(ops(' A ¬= B;'), ['¬=']);
  assert.deepEqual(ops(' A ~= B;'), ['¬=']);
  assert.deepEqual(ops(' A <> B;'), ['<>']);
  assert.deepEqual(ops(' A ¬< B;'), ['¬<']);
  assert.deepEqual(ops(' A -> B;'), ['->']);
  assert.deepEqual(ops(' A => B;'), ['=>']);
  assert.deepEqual(ops(' A || B;'), ['||']);
  assert.deepEqual(ops(' A !! B;'), ['||']);
});

test('compound assignments are single operators', () => {
  assert.deepEqual(ops(' A += B;'), ['+=']);
  assert.deepEqual(ops(' A -= B;'), ['-=']);
  assert.deepEqual(ops(' A *= B;'), ['*=']);
  assert.deepEqual(ops(' A /= B;'), ['/=']);
  assert.deepEqual(ops(' A |= B;'), ['|=']);
  assert.deepEqual(ops(' A &= B;'), ['&=']);
  assert.deepEqual(ops(' A ||= B;'), ['||=']);
  assert.deepEqual(ops(' A **= B;'), ['**=']);
});

test('labels with subscripts are taken off the statement', () => {
  const [st] = readPli(' L1(3): X = 1;').statements;
  assert.deepEqual(st.labels.map((l) => l.name), ['L1']);
  assert.equal(st.labels[0].subscript, '3');
  assert.equal(classify(st), 'ASSIGNMENT');
});

test('a condition prefix list followed by labels is taken off the statement', () => {
  const [st] = readPli(' (SIZE, NOFOFL): L1: L2(3): X = 1;').statements;
  assert.deepEqual(st.conditions, ['SIZE', 'NOFOFL']);
  assert.deepEqual(st.labels.map((l) => l.name), ['L1', 'L2']);
  assert.equal(st.labels[1].subscript, '3');
  assert.equal(classify(st), 'ASSIGNMENT');
});

test('multiple statements on one line are split at semicolons', () => {
  const { statements } = readPli(' A = 1; B = 2; C = 3;');
  assert.equal(statements.length, 3);
  assert.deepEqual(statements.map((s) => s.toks.map((t) => t.v).join(' ')), ['A = 1', 'B = 2', 'C = 3']);
});

test('a statement spanning lines is one statement', () => {
  const { statements } = readPli(' A = 1 +\n 2;');
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0].toks.map((t) => t.v), ['A', '=', '1', '+', '2']);
});

test('*PROCESS lines are collected and not tokenized', () => {
  const { process, statements } = readPli('*PROCESS MARGINS(1,100);\nX = 1;');
  assert.equal(process.length, 1);
  assert.equal(process[0].options, 'MARGINS(1,100)');
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0].toks.map((t) => t.v), ['X', '=', '1']);
});

test('column-1 carriage control with MARGINS(2,72) is ignored', () => {
  const text = '0X = 1;\n1Y = 2;';
  const m = marginsOf(text);
  assert.deepEqual(m, { left: 2, right: 72, carriage: 1, reason: 'default' });
  const { statements } = readPli(text);
  assert.equal(statements.length, 2);
  assert.deepEqual(statements.map((s) => s.toks.map((t) => t.v).join(' ')), ['X = 1', 'Y = 2']);
});

test('a sequence area in columns 73-80 is outside the statement', () => {
  const seq = (s, n) => s.padEnd(72) + String(n).padStart(8, '0');
  const text = [seq(' X = 1;', 10), seq(' Y = 2;', 20)].join('\n');
  const m = marginsOf(text);
  assert.deepEqual(m, { left: 2, right: 72, carriage: 0, reason: 'sequence-area' });
  const { statements } = readPli(text);
  assert.deepEqual(statements.map((s) => s.toks.map((t) => t.v).join(' ')), ['X = 1', 'Y = 2']);
});

test('classify: assignments to names that are keywords', () => {
  assert.deepEqual(kinds(' IF = 1;'), ['ASSIGNMENT']);
  assert.deepEqual(kinds(' DO = 1;'), ['ASSIGNMENT']);
  assert.deepEqual(kinds(' CALL = 1;'), ['ASSIGNMENT']);
  assert.deepEqual(kinds(' END = 1;'), ['ASSIGNMENT']);
  assert.deepEqual(kinds(' ON = 1;'), ['ASSIGNMENT']);
});

test('classify: IF A THEN DO; is IF', () => {
  assert.deepEqual(kinds(' IF A THEN DO;'), ['IF']);
});

test('classify: ELSE IF X THEN Y = 1; is ELSE', () => {
  assert.deepEqual(kinds(' ELSE IF X THEN Y = 1;'), ['ELSE']);
});

test('classify: DO I = 1 TO N; is DO', () => {
  assert.deepEqual(kinds(' DO I = 1 TO N;'), ['DO']);
});

test('classify: GO TO L; is GOTO', () => {
  assert.deepEqual(kinds(' GO TO L;'), ['GOTO']);
});

test('classify: DECLARE fragments', () => {
  assert.deepEqual(kinds(' DCL X CHAR(8);'), ['DECLARE']);
  assert.deepEqual(kinds(' DECLARE X FIXED;'), ['DECLARE']);
});
