// A CALL's written-back argument carries taint back only to the call it came in through
// (README, What a finding looks like): in another caller's CALL the parameter is that caller's storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'writeback');
const commands = (dir) => scan(join(HERE, dir)).findings.filter((f) => f.rule === 'argv-or-env-to-os-command').map((f) => f.path).sort();

test('taint one caller gives a shared subprogram does not leave through another caller\'s argument', () => {
  assert.deepEqual(commands('cross'), []);
});

test('taint written back to the call it came in through is followed', () => {
  assert.deepEqual(commands('same'), ['APROG.cbl']);
});

test('taint a subprogram keeps in its own storage reaches a later caller', () => {
  assert.deepEqual(commands('static'), ['BPROG.cbl']);
});

test('taint a subprogram keeps does not reach a caller that only another job step runs', () => {
  assert.deepEqual(commands('apart'), []);
});

test('taint a subprogram keeps reaches a later caller in the same job step', () => {
  assert.deepEqual(commands('together'), ['BPROG.cbl']);
});

test('a nested call returns to the frame it was made from, and that frame to its own caller', () => {
  assert.deepEqual(commands('nested'), ['APROG.cbl']);
});
