// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for PL/I DECLARE and DECLARE_FRAGMENT parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

test('parses simple DECLARE with CHARACTER', () => {
  const text = ' DECLARE STRING CHARACTER (*) VARYING;';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'DECLARE');
  assert.equal(res.node.items.length, 1);
  assert.equal(res.node.items[0].name, 'STRING');
  assert.equal(res.node.items[0].attributes[0].name, 'CHARACTER');
  assert.equal(res.node.items[0].attributes[1].name, 'VARYING');
});

test('parses DECLARE with FIXED BINARY', () => {
  const text = ' DECLARE LEN FIXED BINARY;';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items[0].name, 'LEN');
  assert.equal(res.node.items[0].attributes[0].name, 'FIXED');
  assert.equal(res.node.items[0].attributes[1].name, 'BINARY');
});

test('parses DECLARE with factored list', () => {
  const text = ' DECLARE (K, L) FIXED BINARY;';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items.length, 2);
  assert.equal(res.node.items[0].name, 'K');
  assert.equal(res.node.items[1].name, 'L');
  assert.equal(res.node.items[0].attributes[0].name, 'FIXED');
});

test('parses DECLARE with dimensions', () => {
  const text = ' DECLARE A(10) FIXED BINARY;';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items[0].name, 'A');
  assert.equal(res.node.items[0].dims.length, 1);
});

test('parses DECLARE_FRAGMENT with levels', () => {
  const text = ' 05 CD01_DATA, 10 CD01I_DATA, 15 CD01I_PERSON_PID CHAR(5);';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'DECLARE_FRAGMENT');
  assert.equal(res.node.items.length, 3);
  assert.equal(res.node.items[0].level, 5);
  assert.equal(res.node.items[0].name, 'CD01_DATA');
  assert.equal(res.node.items[1].level, 10);
  assert.equal(res.node.items[2].level, 15);
  assert.equal(res.node.items[2].attributes[0].name, 'CHARACTER');
});

test('parses DECLARE with GENERIC and WHEN', () => {
  const text = ' DECLARE CENTERLEFT GENERIC (CENTER_LEFT_2 WHEN (*, *), CENTER_LEFT_3 WHEN (*, *, *));';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items[0].name, 'CENTERLEFT');
  assert.equal(res.node.items[0].attributes[0].name, 'GENERIC');
});

test('parses DECLARE with BIT and ALIGNED', () => {
  const text = ' DECLARE (WCKSFLAG, WCQSFLAG) BIT(1) ALIGNED;';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items.length, 2);
  assert.equal(res.node.items[0].attributes[0].name, 'BIT');
  assert.equal(res.node.items[0].attributes[1].name, 'ALIGNED');
});

test('parses DECLARE with VALUE attribute', () => {
  const text = ' DECLARE (MAXLEVEL VALUE (5)) FIXED BINARY;';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items[0].name, 'MAXLEVEL');
  assert.equal(res.node.items[0].attributes[0].name, 'VALUE');
});

test('parses DECLARE with PICTURE', () => {
  const text = " DECLARE X PICTURE '999.99';";
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items[0].attributes[0].name, 'PICTURE');
  assert.equal(res.node.items[0].attributes[0].picture, '999.99');
});

test('parses DECLARE with unknown attribute', () => {
  const text = ' DECLARE X MYUNKNOWN(1);';
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items[0].attributes[0].name, 'MYUNKNOWN');
  assert.ok(res.node.unknownAttributes.includes('MYUNKNOWN'));
});

test('parses DECLARE with INITIAL', () => {
  const text = " DECLARE X BIT(1) INIT('0'B);";
  const stmts = readPli(text);
  const res = parseStatement(stmts.statements[0]);
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.items[0].attributes[1].name, 'INITIAL');
});

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('every token after DECLARE is consumed, the last attribute argument included', () => {
  const r = parse(' DCL X CHAR(8);');
  assert.equal(r.status, 'parsed');
  assert.deepEqual(r.node.items[0].attributes[0].args.map((t) => t.v), ['8']);
});

test('a factored list gives one item per member, with its own and the shared attributes', () => {
  const r = parse(' DCL (A, (B, C) FIXED) BIN, (ADDR, SUBSTR) BUILTIN;');
  assert.deepEqual(r.node.items.map((i) => [i.name, i.attributes.map((a) => a.name)]), [
    ['A', ['BINARY']], ['B', ['FIXED', 'BINARY']], ['C', ['FIXED', 'BINARY']], ['ADDR', ['BUILTIN']], ['SUBSTR', ['BUILTIN']],
  ]);
});

test('PICTURE takes the literal after it, and a dimension list gives one entry per bound', () => {
  const r = parse(" DCL A(0:9, -5:5) PIC '(4)9V99';");
  assert.equal(r.node.items[0].attributes[0].picture, '(4)9V99');
  assert.equal(r.node.items[0].dims.length, 2);
});

test('a %INCLUDE where an item belongs records the member that supplies the rest, read unexpanded', () => {
  const [r] = readPli(' DCL 01 BNKACC_REC, %INCLUDE CBANKVAC;').statements.map((s) => parseStatement(s));
  assert.deepEqual([r.kind, r.status, r.node.items.map((i) => i.name), r.node.includes], ['DECLARE', 'parsed', ['BNKACC_REC'], ['CBANKVAC']]);
});

test('a member holding the middle of a structure may end at the comma its includer continues from', () => {
  const [r] = readPli(' 05 CD51_DATA,\n   10 CD51I_DATA,\n     15 CD51I_PID CHAR(5),').statements.map((s) => parseStatement(s));
  assert.deepEqual([r.kind, r.status, r.node.items.length], ['DECLARE_FRAGMENT', 'parsed', 3]);
  const [d] = readPli(' DCL 1 A CHAR(5),;').statements.map((s) => parseStatement(s));
  assert.equal(d.status, 'unparsed');
});
