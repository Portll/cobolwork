// Reports database PCBs whose PROCOPT grants options no linked program's DL/I calls use (lib/ims/rules.mjs checkProcoptAgainstCalls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProcoptAgainstCalls } from '../lib/ims/rules.mjs';
import './pin-machine.mjs';

test('returns empty when no models are given', () => {
  const out = checkProcoptAgainstCalls([], [], []);
  assert.deepEqual(out, []);
});

test('skips models whose kind is not PSB', () => {
  const models = [{ path: 'a/DBD1.cbl', model: { kind: 'DBD', name: 'DBD1' } }];
  const out = checkProcoptAgainstCalls(models, [], []);
  assert.deepEqual(out, []);
});

test('skips PSB when no program links to it and no fallback name matches', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: 'PSB1', pcbs: [] } }];
  const out = checkProcoptAgainstCalls(models, [{ id: 'PROG1', path: 'p.cbl', line: 1, functions: ['GET'] }], []);
  assert.deepEqual(out, []);
});

test('reports no finding when granted options are all used', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: 'PSB1', pcbs: [{ type: 'DB', name: 'PCB1', dbd: 'DBD1', line: 10, procopt: 'G', procoptWritten: 'G', sensegs: [] }] } }];
  const programs = [{ id: 'PROG1', path: 'p.cbl', line: 1, functions: ['GET'] }];
  const links = [{ psb: 'PSB1', program: 'PROG1', at: 'step1' }];
  const out = checkProcoptAgainstCalls(models, programs, links);
  assert.deepEqual(out, [{ rule: "ims-procopt-broader-than-used", path: "a/PSB1.cbl", line: 10, sev: "high", detail: "PSB PSB1 PCB PCB1 on DBD DBD1: PROCOPT=G grants get, which no DL/I call of PROG1 (p.cbl:1, run with it at step1) uses; it issues GET" }]);
});

test('reports finding when PROCOPT grants option no call uses', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: 'PSB1', pcbs: [{ type: 'DB', name: 'PCB1', dbd: 'DBD1', line: 10, procopt: 'A', procoptWritten: 'A', sensegs: [] }] } }];
  const programs = [{ id: 'PROG1', path: 'p.cbl', line: 1, functions: ['GET'] }];
  const links = [{ psb: 'PSB1', program: 'PROG1', at: 'step1' }];
  const out = checkProcoptAgainstCalls(models, programs, links);
  assert.equal(out.length, 1);
  assert.equal(out[0].rule, 'ims-procopt-broader-than-used');
  assert.equal(out[0].path, 'a/PSB1.cbl');
  assert.equal(out[0].line, 10);
  assert.equal(out[0].sev, 'high');
  assert.match(out[0].detail, /grants get, insert, replace, delete/);
  assert.match(out[0].detail, /PROG1 \(p\.cbl:1, run with it at step1\)/);
  assert.match(out[0].detail, /it issues GET/);
});

test('uses file name as PSB name when model name is missing', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: '', pcbs: [{ type: 'DB', name: 'PCB1', dbd: 'DBD1', line: 5, procopt: 'I', procoptWritten: 'I', sensegs: [] }] } }];
  const programs = [{ id: 'PROG1', path: 'p.cbl', line: 1, functions: ['GET'] }];
  const links = [{ psb: 'PSB1', program: 'PROG1', at: 'step1' }];
  const out = checkProcoptAgainstCalls(models, programs, links);
  assert.equal(out.length, 1);
  assert.match(out[0].detail, /PSB  PCB PCB1/);
  assert.match(out[0].detail, /grants insert/);
});

test('skips PSB when a linked program has null functions', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: 'PSB1', pcbs: [{ type: 'DB', name: 'PCB1', dbd: 'DBD1', line: 5, procopt: 'A', procoptWritten: 'A', sensegs: [] }] } }];
  const programs = [{ id: 'PROG1', path: 'p.cbl', line: 1, functions: null }];
  const links = [{ psb: 'PSB1', program: 'PROG1', at: 'step1' }];
  const out = checkProcoptAgainstCalls(models, programs, links);
  assert.deepEqual(out, []);
});

test('reports finding when SENSEG procopt grants unused option', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: 'PSB1', pcbs: [{ type: 'DB', name: 'PCB1', dbd: 'DBD1', line: 5, procopt: 'G', procoptWritten: 'G', sensegs: [{ procopt: 'D' }] }] } }];
  const programs = [{ id: 'PROG1', path: 'p.cbl', line: 1, functions: ['GET'] }];
  const links = [{ psb: 'PSB1', program: 'PROG1', at: 'step1' }];
  const out = checkProcoptAgainstCalls(models, programs, links);
  assert.equal(out.length, 1);
  assert.match(out[0].detail, /grants get, delete/);
});

test('reports finding for multiple programs with plural verb', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: 'PSB1', pcbs: [{ type: 'DB', name: 'PCB1', dbd: 'DBD1', line: 5, procopt: 'A', procoptWritten: 'A', sensegs: [] }] } }];
  const programs = [
    { id: 'PROG1', path: 'p1.cbl', line: 1, functions: ['GET'] },
    { id: 'PROG2', path: 'p2.cbl', line: 2, functions: ['INSERT'] },
  ];
  const links = [
    { psb: 'PSB1', program: 'PROG1', at: 's1' },
    { psb: 'PSB1', program: 'PROG2', at: 's2' },
  ];
  const out = checkProcoptAgainstCalls(models, programs, links);
  assert.equal(out.length, 1);
  assert.match(out[0].detail, /grants get, insert, replace, delete/);
  assert.match(out[0].detail, /they issue GET, INSERT/);
});

test('skips non-DB PCBs', () => {
  const models = [{ path: 'a/PSB1.cbl', model: { kind: 'PSB', name: 'PSB1', pcbs: [{ type: 'MSG', name: 'PCB1', dbd: null, line: 5, procopt: 'A', procoptWritten: 'A', sensegs: [] }] } }];
  const programs = [{ id: 'PROG1', path: 'p.cbl', line: 1, functions: ['GET'] }];
  const links = [{ psb: 'PSB1', program: 'PROG1', at: 'step1' }];
  const out = checkProcoptAgainstCalls(models, programs, links);
  assert.deepEqual(out, []);
});
