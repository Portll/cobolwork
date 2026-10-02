// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I procedure statement parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('parses PROCEDURE with OPTIONS(MAIN)', () => {
  const res = parse(' PROCEDURE OPTIONS(MAIN);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.name, null);
  assert.equal(res.node.params.length, 0);
  assert.equal(res.node.options.length, 1);
  assert.equal(res.node.options[0].name, 'MAIN');
  assert.equal(res.node.options[0].args, null);
});

test('parses PROC with no options', () => {
  const res = parse(' PROC;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.name, null);
  assert.equal(res.node.params.length, 0);
  assert.equal(res.node.options.length, 0);
});

test('parses PROC with params and OPTIONS(MAIN,REENTRANT) REORDER', () => {
  const res = parse(' EPSBDP1: PROC (CA_PTR) OPTIONS(MAIN,REENTRANT) REORDER;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.name, 'EPSBDP1');
  assert.deepEqual(res.node.params, ['CA_PTR']);
  assert.equal(res.node.options.length, 2);
  assert.equal(res.node.options[0].name, 'MAIN');
  assert.equal(res.node.options[1].name, 'REENTRANT');
  assert.equal(res.node.order, 'REORDER');
});

test('parses PROCEDURE with RETURNS', () => {
  const res = parse(' CENTER_LEFT_2: PROCEDURE (STRING, LEN) RETURNS (CHARACTER(1000) VARYING);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.name, 'CENTER_LEFT_2');
  assert.deepEqual(res.node.params, ['STRING', 'LEN']);
  assert.ok(res.node.returns);
  assert.equal(res.node.returns.length, 5);
  assert.equal(res.node.returns[0].u, 'CHARACTER');
  assert.equal(res.node.returns[1].v, '(');
  assert.equal(res.node.returns[2].v, '1000');
  assert.equal(res.node.returns[3].v, ')');
  assert.equal(res.node.returns[4].u, 'VARYING');
});

test('parses ENTRY with params and RETURNS', () => {
  const res = parse(' MY_ENTRY: ENTRY (A, B) RETURNS (INTEGER);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'ENTRY');
  assert.equal(res.node.name, 'MY_ENTRY');
  assert.deepEqual(res.node.params, ['A', 'B']);
  assert.ok(res.node.returns);
  assert.equal(res.node.returns[0].u, 'INTEGER');
});

test('parses PACKAGE with EXPORTS and RESERVES', () => {
  const res = parse(' MY_PKG: PACKAGE EXPORTS(A, B) RESERVES(C, D);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PACKAGE');
  assert.equal(res.node.name, 'MY_PKG');
  assert.deepEqual(res.node.exports, ['A', 'B']);
  assert.deepEqual(res.node.reserves, ['C', 'D']);
});

test('parses PACKAGE with EXPORTS(*)', () => {
  const res = parse(' MY_PKG: PACKAGE EXPORTS(*);');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PACKAGE');
  assert.deepEqual(res.node.exports, ['*']);
});

test('parses BEGIN with no options', () => {
  const res = parse(' BEGIN;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'BEGIN');
  assert.equal(res.node.options.length, 0);
});

test('parses BEGIN with OPTIONS and ORDER', () => {
  const res = parse(' BEGIN OPTIONS(MAIN) ORDER;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'BEGIN');
  assert.equal(res.node.options.length, 2);
  assert.equal(res.node.options[0].name, 'MAIN');
  assert.equal(res.node.options[1].name, 'ORDER');
});

test('parses END with label', () => {
  const res = parse(' END CENTER_LEFT_2;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'END');
  assert.equal(res.node.label, 'CENTER_LEFT_2');
});

test('parses END without label', () => {
  const res = parse(' END;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'END');
  assert.equal(res.node.label, null);
});

test('parses PROCEDURE with EXTERNAL', () => {
  const res = parse(' MY_PROC: PROCEDURE EXTERNAL;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.external, true);
});

test('parses PROCEDURE with EXTERNAL(name)', () => {
  const res = parse(' MY_PROC: PROCEDURE EXTERNAL("myproc");');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.external, 'myproc');
});

test('parses PROCEDURE with RECURSIVE', () => {
  const res = parse(' MY_PROC: PROCEDURE RECURSIVE;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.recursive, true);
});

test('parses PROCEDURE with NONRECURSIVE', () => {
  const res = parse(' MY_PROC: PROCEDURE NONRECURSIVE;');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'PROCEDURE');
  assert.equal(res.node.recursive, false);
});

test('fails on unknown PROCEDURE option', () => {
  const res = parse(' MY_PROC: PROCEDURE FOO;');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /expected a PROCEDURE option/);
});

test('fails on unknown ENTRY option', () => {
  const res = parse(' MY_ENTRY: ENTRY FOO;');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /expected an ENTRY option/);
});

test('fails on unknown PACKAGE option', () => {
  const res = parse(' MY_PKG: PACKAGE FOO;');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /expected a PACKAGE option/);
});

test('fails on unknown BEGIN option', () => {
  const res = parse(' BEGIN FOO;');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /expected a BEGIN option/);
});
