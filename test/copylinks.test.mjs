// Two programs share storage only through a real mechanism. Sharing a copybook, or a program id
// held in another executable, is not one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'copylinks');
const subscripts = (repo) => scan(FIXTURES, { repos: [repo] }).findings.filter(f => f.rule === 'argv-or-env-to-subscript');

test('two programs that only share a copybook do not share its items', () => {
  assert.deepEqual(subscripts('shared'), []);
});

test('a copybook item passed on a CALL still carries the value into the callee', () => {
  const f = subscripts('called');
  assert.equal(f.length, 1);
  assert.equal(f[0].crossProgram, true);
  assert.deepEqual(f[0].trace.map(t => `${t.program}.${t.item}`), ['CALLA.CPY-IDX', 'CALLB.LK-IDX']);
});

test('a CALL reaches the program of that id in its own source file, not one in another executable', () => {
  assert.deepEqual(subscripts('samename'), []);
});

test('a CALL target held in other files only is linked to every holder, and the trace says so', () => {
  const f = subscripts('ambiguous');
  assert.equal(f.length, 1);
  assert.match(JSON.stringify(f[0].trace), /any of 2 programs named HELPER/);
});

test('a CALL target held twice in different directories goes to the holder nearest the caller', () => {
  assert.deepEqual(subscripts('nearest'), []);
});
