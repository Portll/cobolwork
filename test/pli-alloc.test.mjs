// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);
const items = (r) => r.node.items.map((i) => [i.variable.name, i.in && i.in.name, i.set ? i.set.name : null, (i.attributes || []).map((a) => a.name)]);

test('ALLOCATE names each variable with the area it takes storage IN and the locator it SETs', () => {
  const r = parse(' ALLOCATE 1 S IN(A) SET(P), B CHAR(20), PARAMETER_STR SET(PARAMETER_PTR);');
  assert.equal(r.status, 'parsed', r.reason);
  assert.deepEqual(items(r), [['S', 'A', 'P', []], ['B', null, null, ['CHAR']], ['PARAMETER_STR', null, 'PARAMETER_PTR', []]]);
  assert.equal(parse(' ALLOC SLOG_REC;').node.kind, 'ALLOCATE');
});

test('FREE names each variable, through its locator or IN an area', () => {
  const r = parse(' FREE P->X, Y IN(A), OP_USER_STORE;');
  assert.equal(r.status, 'parsed', r.reason);
  assert.deepEqual(r.node.items.map((i) => [i.variable.name, i.in && i.in.name]), [['X', null], ['Y', 'A'], ['OP_USER_STORE', null]]);
});

test('an ALLOCATE option PL/I does not have is refused', () => {
  assert.equal(parse(' ALLOCATE X SIZE(10);').status, 'unparsed');
});
