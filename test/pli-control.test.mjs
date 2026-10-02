// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I control flow statement parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('DO group parses', () => {
  const r = parse(' DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'group');
});

test('DO FOREVER parses', () => {
  const r = parse(' DO FOREVER;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'loop');
});

test('DO LOOP parses', () => {
  const r = parse(' DO LOOP;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'loop');
});

test('DO WHILE parses', () => {
  const r = parse(' DO WHILE (A);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'while');
  assert.ok(r.node.while);
});

test('DO UNTIL parses', () => {
  const r = parse(' DO UNTIL (A);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'while');
  assert.ok(r.node.until);
});

test('DO iterative with TO parses', () => {
  const r = parse(' DO B = 0 TO 7;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'iterative');
  assert.equal(r.node.control.name, 'B');
  assert.equal(r.node.specs.length, 1);
  assert.equal(r.node.specs[0].from.tree.t, 'num');
  assert.equal(r.node.specs[0].to.tree.t, 'num');
});

test('DO iterative with TO BY parses', () => {
  const r = parse(' DO I = 0 TO NDX BY 1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'iterative');
  assert.equal(r.node.control.name, 'I');
  assert.equal(r.node.specs[0].by.tree.t, 'num');
});

test('DO iterative with BY TO parses', () => {
  const r = parse(' DO B = 7 BY -1 TO 0;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'iterative');
  assert.equal(r.node.control.name, 'B');
  assert.equal(r.node.specs[0].by.tree.op, 'prefix-');
  assert.equal(r.node.specs[0].to.tree.t, 'num');
});

test('DO iterative with REPEAT parses', () => {
  const r = parse(' DO I = 1 REPEAT 2 * I;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'iterative');
  assert.equal(r.node.control.name, 'I');
  assert.equal(r.node.specs[0].repeat.tree.op, '*');
});

test('DO iterative with a variable named WHILE parses', () => {
  const r = parse(' DO WHILE = 100 TO 0 BY -1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'iterative');
  assert.equal(r.node.control.name, 'WHILE');
  assert.equal(r.node.specs[0].by.tree.op, 'prefix-');
});

test('IF with DO unit parses', () => {
  const r = parse(' IF A THEN DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'IF');
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'DO');
});

test('IF with RETURN unit parses', () => {
  const r = parse(' IF L >= LEN THEN RETURN (STRING);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'IF');
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'RETURN');
});

test('IF with ITERATE unit parses', () => {
  const r = parse(' IF BOARD(B, A) >= 0 THEN ITERATE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'IF');
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'ITERATE');
});

test('ELSE with DO unit parses', () => {
  const r = parse(' ELSE DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ELSE');
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'DO');
});

test('ELSE with RETURN unit parses', () => {
  const r = parse(' ELSE RETURN (INDEX(STRING, \'0\'B));');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ELSE');
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'RETURN');
});

test('ELSE carries its unit as a nested statement', () => {
  const r = parse(' ELSE DENOMINATOR = 1;');
  assert.equal(r.node.kind, 'ELSE');
  assert.equal(r.node.units[0].kind, 'ASSIGNMENT');
});

test('SELECT with subject parses', () => {
  const r = parse(' SELECT (PIECE);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'SELECT');
  assert.ok(r.node.subject);
});

test('SELECT without subject parses', () => {
  const r = parse(' SELECT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'SELECT');
  assert.equal(r.node.subject, null);
});

test('WHEN with a single value parses', () => {
  const r = parse(' WHEN (100) DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WHEN');
  assert.equal(r.node.values.length, 1);
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'DO');
});

test('WHEN with multiple values parses', () => {
  const r = parse(' WHEN (1, 2) DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WHEN');
  assert.equal(r.node.values.length, 2);
});

test('WHEN with ANY parses', () => {
  const r = parse(' WHEN ANY (1, 2) DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WHEN');
  assert.equal(r.node.values.length, 2);
});

test('WHEN with ALL parses', () => {
  const r = parse(' WHEN ALL (1, 2) DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WHEN');
  assert.equal(r.node.values.length, 2);
});

test('OTHERWISE with DO unit parses', () => {
  const r = parse(' OTHERWISE DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'OTHERWISE');
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'DO');
});

test('OTHERWISE with ITERATE unit parses', () => {
  const r = parse(' OTHERWISE ITERATE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'OTHERWISE');
  assert.equal(r.node.units.length, 1);
  assert.equal(r.node.units[0].kind, 'ITERATE');
});

test('OTHER keyword parses', () => {
  const r = parse(' OTHER DO;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'OTHERWISE');
});

test('LEAVE parses', () => {
  const r = parse(' LEAVE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'LEAVE');
  assert.equal(r.node.label, null);
});

test('LEAVE with label parses', () => {
  const r = parse(' LEAVE L1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'LEAVE');
  assert.equal(r.node.label.name, 'L1');
});

test('ITERATE parses', () => {
  const r = parse(' ITERATE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ITERATE');
  assert.equal(r.node.label, null);
});

test('ITERATE with label parses', () => {
  const r = parse(' ITERATE L1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ITERATE');
  assert.equal(r.node.label.name, 'L1');
});

test('GO TO parses', () => {
  const r = parse(' GO TO L1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GOTO');
  assert.equal(r.node.target.name, 'L1');
});

test('GOTO parses', () => {
  const r = parse(' GOTO L1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GOTO');
  assert.equal(r.node.target.name, 'L1');
});

test('GOTO with subscripted label parses', () => {
  const r = parse(' GOTO L(I);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GOTO');
  assert.equal(r.node.target.name, 'L');
});

test('RETURN parses', () => {
  const r = parse(' RETURN;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'RETURN');
  assert.equal(r.node.value, null);
});

test('RETURN with value parses', () => {
  const r = parse(' RETURN (1);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'RETURN');
  assert.ok(r.node.value);
});

test('STOP parses', () => {
  const r = parse(' STOP;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'STOP');
});

test('EXIT parses', () => {
  const r = parse(' EXIT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'EXIT');
});

test('DO LOOP with iterative specs parses', () => {
  const r = parse(' DO LOOP = 100 TO 0 BY -1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DO');
  assert.equal(r.node.form, 'iterative');
  assert.equal(r.node.control.name, 'LOOP');
  assert.equal(r.node.specs.length, 1);
  assert.equal(r.node.specs[0].from.tree.t, 'num');
  assert.equal(r.node.specs[0].to.tree.t, 'num');
  assert.equal(r.node.specs[0].by.tree.op, 'prefix-');
});

test('LOOP, FOREVER and UNTIL followed by = are control variables', () => {
  for (const name of ['LOOP', 'FOREVER', 'UNTIL']) {
    const r = parse(` DO ${name} = 1 TO 10;`);
    assert.equal(r.status, 'parsed', name);
    assert.deepEqual([r.node.form, r.node.control.name], ['iterative', name]);
  }
});
