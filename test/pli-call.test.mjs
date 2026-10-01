// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for PL/I CALL, FETCH and RELEASE statement parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('CALL with no arguments', () => {
  const r = parse(' CALL init_processing;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'INIT_PROCESSING');
  assert.equal(r.node.args.length, 0);
  assert.equal(r.node.options.length, 0);
});

test('CALL with arguments', () => {
  const r = parse(' CALL PLITDLI (PARM_CT_3, GU, PCB1, IO_AREA);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'PLITDLI');
  assert.equal(r.node.args.length, 4);
  assert.equal(r.node.args[0].tree.name, 'PARM_CT_3');
  assert.equal(r.node.args[1].tree.name, 'GU');
  assert.equal(r.node.args[2].tree.name, 'PCB1');
  assert.equal(r.node.args[3].tree.name, 'IO_AREA');
});

test('CALL with TASK option', () => {
  const r = parse(' CALL P() TASK(T1);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'P');
  assert.equal(r.node.args.length, 0);
  assert.equal(r.node.options.length, 1);
  assert.equal(r.node.options[0].name, 'TASK');
  assert.equal(r.node.options[0].args[0].tree.name, 'T1');
});

test('CALL with EVENT option', () => {
  const r = parse(' CALL P() EVENT(E1);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'P');
  assert.equal(r.node.args.length, 0);
  assert.equal(r.node.options.length, 1);
  assert.equal(r.node.options[0].name, 'EVENT');
  assert.equal(r.node.options[0].args[0].tree.name, 'E1');
});

test('CALL with PRIORITY option', () => {
  const r = parse(' CALL P() PRIORITY(5);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'P');
  assert.equal(r.node.args.length, 0);
  assert.equal(r.node.options.length, 1);
  assert.equal(r.node.options[0].name, 'PRIORITY');
  assert.equal(r.node.options[0].args[0].tree.t, 'num');
});

test('CALL with multiple options', () => {
  const r = parse(' CALL P() TASK(T1) EVENT(E1) PRIORITY(5);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'P');
  assert.equal(r.node.args.length, 0);
  assert.equal(r.node.options.length, 3);
  assert.equal(r.node.options[0].name, 'TASK');
  assert.equal(r.node.options[1].name, 'EVENT');
  assert.equal(r.node.options[2].name, 'PRIORITY');
});

test('FETCH with single entry', () => {
  const r = parse(' FETCH P1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FETCH');
  assert.equal(r.node.entries.length, 1);
  assert.equal(r.node.entries[0].name, 'P1');
  assert.equal(r.node.entries[0].set, null);
  assert.equal(r.node.entries[0].title, null);
});

test('FETCH with SET option', () => {
  const r = parse(' FETCH P1 SET(PTR1);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FETCH');
  assert.equal(r.node.entries.length, 1);
  assert.equal(r.node.entries[0].name, 'P1');
  assert.equal(r.node.entries[0].set.name, 'PTR1');
  assert.equal(r.node.entries[0].title, null);
});

test('FETCH with TITLE option', () => {
  const r = parse(' FETCH P1 TITLE("My Title");');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FETCH');
  assert.equal(r.node.entries.length, 1);
  assert.equal(r.node.entries[0].name, 'P1');
  assert.equal(r.node.entries[0].set, null);
  assert.equal(r.node.entries[0].title.tree.t, 'lit');
});

test('FETCH with multiple entries', () => {
  const r = parse(' FETCH P1, P2, P3;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FETCH');
  assert.equal(r.node.entries.length, 3);
  assert.equal(r.node.entries[0].name, 'P1');
  assert.equal(r.node.entries[1].name, 'P2');
  assert.equal(r.node.entries[2].name, 'P3');
});

test('RELEASE with single entry', () => {
  const r = parse(' RELEASE P1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'RELEASE');
  assert.deepEqual(r.node.entries, ['P1']);
});

test('RELEASE with multiple entries', () => {
  const r = parse(' RELEASE P1, P2, P3;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'RELEASE');
  assert.deepEqual(r.node.entries, ['P1', 'P2', 'P3']);
});

test('RELEASE with star', () => {
  const r = parse(' RELEASE *;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'RELEASE');
  assert.deepEqual(r.node.entries, ['*']);
});

test('CALL with complex arguments', () => {
  const r = parse(' CALL CEEDAYS(DATE_STR, PIC_STR, LILIAN, FC);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'CEEDAYS');
  assert.equal(r.node.args.length, 4);
  assert.equal(r.node.args[0].tree.name, 'DATE_STR');
  assert.equal(r.node.args[1].tree.name, 'PIC_STR');
  assert.equal(r.node.args[2].tree.name, 'LILIAN');
  assert.equal(r.node.args[3].tree.name, 'FC');
});

test('CALL with expression arguments', () => {
  const r = parse(' CALL P(A + B, C * 2);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CALL');
  assert.equal(r.node.name, 'P');
  assert.equal(r.node.args.length, 2);
  assert.equal(r.node.args[0].tree.op, '+');
  assert.equal(r.node.args[1].tree.op, '*');
});

test('a kind with no parser yet is unbuilt, and text no kind fits is unknown', () => {
  const r1 = parse(' ASSERT;');
  assert.equal(r1.kind, 'ASSERT');
  assert.equal(r1.status, 'unbuilt');

  const r2 = parse(' 12345;');
  assert.equal(r2.kind, 'UNKNOWN');
  assert.equal(r2.status, 'unknown');
});
