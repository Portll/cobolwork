// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I assignment statement parser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('parses a simple assignment', () => {
  const r = parse(' L = 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ASSIGNMENT');
  assert.equal(r.node.op, '=');
  assert.equal(r.node.targets.length, 1);
  assert.equal(r.node.targets[0].name, 'L');
  assert.equal(r.node.byName, false);
});

test('parses a compound assignment', () => {
  const r = parse(' L += 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.op, '+=');
});

test('parses an assignment to a subscripted reference', () => {
  const r = parse(' A(I) = 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.targets[0].name, 'A');
  assert.equal(r.node.targets[0].path.length, 1);
  assert.equal(r.node.targets[0].args.length, 1);
});

test('parses an assignment to a qualified reference', () => {
  const r = parse(' A.B = 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.targets[0].name, 'B');
  assert.deepEqual(r.node.targets[0].path, ['A', 'B']);
});

test('parses an assignment to a located reference', () => {
  const r = parse(' P->X = 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.targets[0].name, 'X');
  assert.deepEqual(r.node.targets[0].path, ['P', 'X']);
});

test('parses an assignment to a pseudovariable', () => {
  const r = parse(' SUBSTR(S,1,2) = 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.targets[0].name, 'SUBSTR');
  assert.equal(r.node.targets[0].args.length, 1);
  assert.equal(r.node.targets[0].args[0].length, 3);
});

test('parses an assignment with BY NAME', () => {
  const r = parse(' L = 1, BY NAME;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.byName, true);
});

test('parses multiple targets in one assignment', () => {
  const r = parse(' A, B = 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.targets.length, 2);
  assert.equal(r.node.targets[0].name, 'A');
  assert.equal(r.node.targets[1].name, 'B');
});

test('parses an assignment with a complex expression', () => {
  const r = parse(' K = (LEN - L + 2)/2;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.op, '=');
  assert.equal(r.node.value.t, 'expr');
});

test('parses an assignment with a string literal', () => {
  const r = parse(" WORK = '';");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.value.t, 'expr');
});

test('parses an assignment with a function call', () => {
  const r = parse(' L = LENGTH (STRING);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.value.t, 'expr');
});

test('parses an assignment with a bitwise OR expression', () => {
  const r = parse(' WORK = STRING || REPEAT (FILL, LEN-L-1);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.value.t, 'expr');
});

test('fails when no assignment operator is present', () => {
  const r = parse(' L = 1 2;');
  assert.equal(r.status, 'unparsed');
});

test('fails when BY is not followed by NAME', () => {
  const r = parse(' L = 1, BY;');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /'NAME'/);
});

test('a comparison on the right of an assignment is part of the value', () => {
  const r = parseStatement(readPli(' FLAG = A = B;').statements[0]);
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.value.tree.op, '=');
});
