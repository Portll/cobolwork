// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for ON, SIGNAL, REVERT and RESIGNAL statement parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('ON ERROR with BEGIN unit parses', () => {
  const result = parse(' ON ERROR BEGIN;');
  assert.equal(result.kind, 'ON');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.conditions.length, 1);
  assert.equal(result.node.conditions[0].name, 'ERROR');
  assert.equal(result.node.conditions[0].arg, null);
  assert.equal(result.node.snap, false);
  assert.equal(result.node.system, false);
  assert.equal(result.node.units.length, 1);
});

test('ON ERROR SNAP BEGIN parses', () => {
  const result = parse(' ON ERROR SNAP BEGIN;');
  assert.equal(result.kind, 'ON');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.snap, true);
  assert.equal(result.node.system, false);
});

test('ON ERROR SYSTEM parses', () => {
  const result = parse(' ON ERROR SYSTEM;');
  assert.equal(result.kind, 'ON');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.system, true);
  assert.equal(result.node.units.length, 0);
});

test('ON ENDFILE(INFILE) with assignment unit parses', () => {
  const result = parse(" ON ENDFILE(INFILE) EOF = '1'B;");
  assert.equal(result.kind, 'ON');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.conditions.length, 1);
  assert.equal(result.node.conditions[0].name, 'ENDFILE');
  assert.ok(Array.isArray(result.node.conditions[0].arg));
  assert.equal(result.node.conditions[0].arg.length, 1);
  assert.equal(result.node.conditions[0].arg[0].u, 'INFILE');
  assert.equal(result.node.units.length, 1);
});

test('ON UNDEFINEDFILE(SOURCE) BEGIN parses', () => {
  const result = parse(' ON UNDEFINEDFILE(SOURCE) BEGIN;');
  assert.equal(result.kind, 'ON');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.conditions[0].name, 'UNDEFINEDFILE');
  assert.equal(result.node.conditions[0].arg[0].u, 'SOURCE');
});

test('ON with multiple conditions parses', () => {
  const result = parse(' ON ERROR, ENDFILE(F) BEGIN;');
  assert.equal(result.kind, 'ON');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.conditions.length, 2);
  assert.equal(result.node.conditions[0].name, 'ERROR');
  assert.equal(result.node.conditions[1].name, 'ENDFILE');
});

test('SIGNAL STRINGRANGE parses', () => {
  const result = parse(' SIGNAL STRINGRANGE;');
  assert.equal(result.kind, 'SIGNAL');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.condition.name, 'STRINGRANGE');
  assert.equal(result.node.condition.arg, null);
});

test('SIGNAL ENDPAGE(CUSTRPT) parses', () => {
  const result = parse(' SIGNAL ENDPAGE(CUSTRPT);');
  assert.equal(result.kind, 'SIGNAL');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.condition.name, 'ENDPAGE');
  assert.ok(Array.isArray(result.node.condition.arg));
  assert.equal(result.node.condition.arg[0].u, 'CUSTRPT');
});

test('SIGNAL ERROR parses', () => {
  const result = parse(' SIGNAL ERROR;');
  assert.equal(result.kind, 'SIGNAL');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.condition.name, 'ERROR');
});

test('REVERT CONVERSION parses', () => {
  const result = parse(' REVERT CONVERSION;');
  assert.equal(result.kind, 'REVERT');
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.condition.name, 'CONVERSION');
  assert.equal(result.node.condition.arg, null);
});

test('RESIGNAL parses', () => {
  const result = parse(' RESIGNAL;');
  assert.equal(result.kind, 'RESIGNAL');
  assert.equal(result.status, 'parsed');
});

test('ON with invalid condition fails', () => {
  const result = parse(' ON FOO BEGIN;');
  assert.equal(result.kind, 'ON');
  assert.equal(result.status, 'unparsed');
});

test('SIGNAL with invalid condition fails', () => {
  const result = parse(' SIGNAL FOO;');
  assert.equal(result.kind, 'SIGNAL');
  assert.equal(result.status, 'unparsed');
});
