import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('IF parses a simple condition code', () => {
  const r = parse('         IF (CC=8)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'IF');
  assert.deepEqual(r.node.conditions, ['(CC=8)']);
  assert.deepEqual(r.node.joins, []);
});

test('IF parses a compare instruction condition', () => {
  const r = parse("         IF (CLI,0(R1),EQ,C'A')");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'IF');
  assert.equal(r.node.conditions[0], "(CLI,0(R1),EQ,C'A')");
});

test('IF parses multiple conditions with AND', () => {
  const r = parse('         IF (10),OR,(AR,R2,R3,NZ)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'IF');
  assert.equal(r.node.conditions.length, 2);
  assert.deepEqual(r.node.joins, ['OR']);
});

test('IF refuses an unknown mnemonic', () => {
  const r = parse('         IF (FOO)');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unrecognised condition/);
});

test('ELSEIF parses a condition', () => {
  const r = parse('         ELSEIF (Z)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ELSEIF');
  assert.deepEqual(r.node.conditions, ['(Z)']);
});

test('ELSEIF refuses an empty predicate', () => {
  const r = parse('         ELSEIF');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /requires a predicate/);
});

test('ELSE parses with no operand', () => {
  const r = parse('         ELSE');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ELSE');
});

test('ELSE refuses an operand', () => {
  const r = parse('         ELSE FOO');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /does not accept positional operands/);
});

test('ENDIF parses with no operand', () => {
  const r = parse('         ENDIF');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ENDIF');
});

test('DO parses ONCE form', () => {
  const r = parse('         DO ONCE');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'ONCE');
});

test('DO parses INF form', () => {
  const r = parse('         DO INF');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'INF');
});

test('DO parses WHILE keyword', () => {
  const r = parse('         DO WHILE=2');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'WHILE');
  assert.equal(r.node.keywords.WHILE, '2');
});

test('DO parses UNTIL keyword', () => {
  const r = parse('         DO UNTIL=(LTR,R1,Z,R1)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'UNTIL');
});

test('DO parses FROM keyword', () => {
  const r = parse('         DO FROM=2');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'FROM');
});

test('DO parses simple form (no operands)', () => {
  const r = parse('         DO');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'SIMPLE');
});

test('DO refuses an unknown positional operand', () => {
  const r = parse('         DO FOO');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unknown DO positional operand/);
});

test('ENDDO parses with no operand', () => {
  const r = parse('         ENDDO');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ENDDO');
});

test('DOEXIT parses a condition', () => {
  const r = parse('         DOEXIT (2)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DOEXIT');
  assert.deepEqual(r.node.operands, ['(2)']);
});

test('DOEXIT parses with no operand', () => {
  const r = parse('         DOEXIT');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DOEXIT');
  assert.deepEqual(r.node.operands, ['']);
});

test('ITERATE parses a label', () => {
  const r = parse('         ITERATE OUTER');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ITERATE');
  assert.deepEqual(r.node.operands, ['OUTER']);
});

test('ITERATE parses with no operand', () => {
  const r = parse('         ITERATE');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ITERATE');
  assert.deepEqual(r.node.operands, ['']);
});

test('ASMLEAVE parses a label', () => {
  const r = parse('         ASMLEAVE LOOP');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ASMLEAVE');
  assert.deepEqual(r.node.operands, ['LOOP']);
});

test('ASMLEAVE parses with no operand', () => {
  const r = parse('         ASMLEAVE');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ASMLEAVE');
  assert.deepEqual(r.node.operands, ['']);
});

test('SELECT parses a CLI comparison', () => {
  const r = parse('         SELECT CLI,0(R6),EQ');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'SELECT');
  assert.equal(r.node.operands[0], 'CLI,0(R6),EQ');
});

test('SELECT parses with no operand', () => {
  const r = parse('         SELECT');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'SELECT');
  assert.deepEqual(r.node.operands, []);
});

test('WHEN parses a condition', () => {
  const r = parse("         WHEN (X'20')");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WHEN');
  assert.equal(r.node.operands[0], "(X'20')");
});

test('WHEN parses a list of values', () => {
  const r = parse('         WHEN (1,5,13)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WHEN');
  assert.equal(r.node.operands[0], '(1,5,13)');
});

test('OTHRWISE parses with no operand', () => {
  const r = parse('         OTHRWISE');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'OTHRWISE');
});

test('ENDSEL parses with no operand', () => {
  const r = parse('         ENDSEL');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ENDSEL');
});
