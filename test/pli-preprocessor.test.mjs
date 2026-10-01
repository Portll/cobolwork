// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I preprocessor statement parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('parses %INCLUDE with a single member', () => {
  const res = parse(' %INCLUDE PLCU2CUS;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'INCLUDE');
  assert.equal(res.node.members.length, 1);
  assert.equal(res.node.members[0].name, 'PLCU2CUS');
  assert.equal(res.node.members[0].library, null);
});

test('parses %INCLUDE with a library', () => {
  const res = parse(' %INCLUDE SYSLIB(member);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'INCLUDE');
  assert.equal(res.node.members.length, 1);
  assert.equal(res.node.members[0].name, 'MEMBER');
  assert.equal(res.node.members[0].library, 'SYSLIB');
});

test('parses %INCLUDE with a quoted member', () => {
  const res = parse(" %INCLUDE 'member';");
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'INCLUDE');
  assert.equal(res.node.members.length, 1);
  assert.equal(res.node.members[0].name, 'member');
});

test('parses %INCLUDE with multiple members', () => {
  const res = parse(' %INCLUDE a, b;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'INCLUDE');
  assert.equal(res.node.members.length, 2);
  assert.equal(res.node.members[0].name, 'A');
  assert.equal(res.node.members[1].name, 'B');
});

test('parses %XINCLUDE', () => {
  const res = parse(' %XINCLUDE member;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'XINCLUDE');
  assert.equal(res.node.members.length, 1);
  assert.equal(res.node.members[0].name, 'MEMBER');
});

test('parses %DCL with attributes', () => {
  const res = parse(' %DCL X CHAR(8);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'DCL');
  assert.equal(res.node.names.length, 1);
  assert.equal(res.node.names[0], 'X');
});

test('parses %DECLARE with multiple names', () => {
  const res = parse(' %DECLARE A, B FIXED;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'DECLARE');
  assert.equal(res.node.names.length, 2);
  assert.equal(res.node.names[0], 'A');
  assert.equal(res.node.names[1], 'B');
});

test('a preprocessor assignment is ASSIGN, naming the variable and its value', () => {
  const res = parse(' %X = 1;');
  assert.equal(res.status, 'parsed');
  assert.deepEqual([res.node.directive, res.node.names, res.node.value.toks.map((t) => t.v)], ['ASSIGN', ['X'], ['1']]);
});

test('parses %IF with %THEN and a unit', () => {
  const res = parse(' %IF A = 1 %THEN %DO;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'IF');
  assert.ok(res.node.value);
  assert.equal(res.node.units.length, 1);
  assert.equal(res.node.units[0].kind, 'PREPROCESSOR');
  assert.equal(res.node.units[0].node.directive, 'DO');
});

test('parses %ELSE with a unit', () => {
  const res = parse(' %ELSE %DO;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'ELSE');
  assert.equal(res.node.units.length, 1);
  assert.equal(res.node.units[0].kind, 'PREPROCESSOR');
  assert.equal(res.node.units[0].node.directive, 'DO');
});

test('parses %DO', () => {
  const res = parse(' %DO;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'DO');
});

test('parses %END', () => {
  const res = parse(' %END;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'END');
});

test('parses %ACTIVATE with names and RESCAN', () => {
  const res = parse(' %ACTIVATE A, B RESCAN;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'ACTIVATE');
  assert.deepEqual(res.node.names, ['A', 'B']);
  assert.equal(res.node.rescan, true);
});

test('parses %DEACTIVATE with names', () => {
  const res = parse(' %DEACTIVATE A, B;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'DEACTIVATE');
  assert.deepEqual(res.node.names, ['A', 'B']);
});

test('parses %GO TO label', () => {
  const res = parse(' %GO TO label;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'GO');
  assert.equal(res.node.label, 'LABEL');
});

test('parses %GOTO label', () => {
  const res = parse(' %GOTO label;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'GOTO');
  assert.equal(res.node.label, 'LABEL');
});

test('parses %PAGE', () => {
  const res = parse(' %PAGE;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'PAGE');
});

test('parses %SKIP', () => {
  const res = parse(' %SKIP;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'SKIP');
});

test('parses %SKIP(n)', () => {
  const res = parse(' %SKIP(3);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'SKIP');
});

test('parses %PRINT', () => {
  const res = parse(' %PRINT;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'PRINT');
});

test('parses %NOPRINT', () => {
  const res = parse(' %NOPRINT;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'NOPRINT');
});

test('parses %PUSH', () => {
  const res = parse(' %PUSH;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'PUSH');
});

test('parses %POP', () => {
  const res = parse(' %POP;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'POP');
});

test('parses %NOTE(message, code)', () => {
  const res = parse(' %NOTE(message, code);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'NOTE');
});

test('parses %PROC with params and RETURNS', () => {
  const res = parse(' %PROC(X) RETURNS(CHAR);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'PROC');
  assert.equal(res.node.params.length, 1);
  assert.equal(res.node.params[0].name, 'X');
  assert.equal(res.node.returns, 'CHAR');
});

test('parses %PROC with label after %', () => {
  const res = parse(' %P: PROC(X) RETURNS(CHAR);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.label, 'P');
  assert.equal(res.node.directive, 'PROC');
});

test('parses %RETURN(expr)', () => {
  const res = parse(' %RETURN(1);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'RETURN');
  assert.ok(res.node.value);
});

test('parses %REPLACE name BY value', () => {
  const res = parse(' %REPLACE A BY 1;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'REPLACE');
  assert.deepEqual(res.node.names, ['A']);
  assert.ok(res.node.value);
});

test('parses %SELECT', () => {
  const res = parse(' %SELECT;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'SELECT');
});

test('parses %WHEN(expr) unit', () => {
  const res = parse(' %WHEN(A=1) %DO;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'WHEN');
  assert.ok(res.node.value);
  assert.equal(res.node.units.length, 1);
  assert.equal(res.node.units[0].kind, 'PREPROCESSOR');
});

test('parses %OTHERWISE unit', () => {
  const res = parse(' %OTHERWISE %DO;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'OTHERWISE');
  assert.equal(res.node.units.length, 1);
  assert.equal(res.node.units[0].kind, 'PREPROCESSOR');
});

test('parses %ITERATE', () => {
  const res = parse(' %ITERATE;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'ITERATE');
});

test('parses %LEAVE', () => {
  const res = parse(' %LEAVE;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'LEAVE');
});

test('parses %INSCAN', () => {
  const res = parse(' %INSCAN;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'INSCAN');
});

test('parses %XINSCAN', () => {
  const res = parse(' %XINSCAN;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'XINSCAN');
});

test('parses %PROCESS with options', () => {
  const res = parse(' %PROCESS OPT1 OPT2;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'PROCESS');
});

test('parses %; null statement', () => {
  const res = parse(' %;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PREPROCESSOR');
});

test('keeps tokens for unknown directives', () => {
  const res = parse(' %FOO BAR BAZ;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'FOO');
  assert.ok(res.node.toks);
  assert.equal(res.node.toks.length, 2);
});

test('parses %INCLUDE with trailing comment tokens', () => {
  const res = parse(' %INCLUDE DFHAIDP;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.directive, 'INCLUDE');
  assert.equal(res.node.members.length, 1);
  assert.equal(res.node.members[0].name, 'DFHAIDP');
});
