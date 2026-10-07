// Stamp effect privileged on findings started by entries the resolver flags as elevated-authority (lib/reach.mjs stampEffect).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampEffect } from '../lib/reach.mjs';
import './pin-machine.mjs';

test('returns zero privileged when findings is empty', () => {
  const by = stampEffect([], { privilegedOf: () => true });
  assert.deepEqual(by, { privileged: 0 });
});

test('skips findings without startedBy', () => {
  const findings = [{ id: 1 }];
  const by = stampEffect(findings, { privilegedOf: () => true });
  assert.deepEqual(by, { privileged: 0 });
  assert.equal(findings[0].effect, undefined);
});

test('skips findings with empty startedBy array', () => {
  const findings = [{ id: 1, startedBy: [] }];
  const by = stampEffect(findings, { privilegedOf: () => true });
  assert.deepEqual(by, { privileged: 0 });
  assert.equal(findings[0].effect, undefined);
});

test('stamps privileged when transaction entry is flagged', () => {
  const findings = [{ id: 1, startedBy: [{ transaction: 'T1' }] }];
  const by = stampEffect(findings, { privilegedOf: (kind, key) => kind === 'transaction' && key === 'T1' });
  assert.deepEqual(by, { privileged: 1 });
  assert.equal(findings[0].effect, 'privileged');
});

test('stamps privileged when job entry is flagged', () => {
  const findings = [{ id: 1, startedBy: [{ job: 'J1' }] }];
  const by = stampEffect(findings, { privilegedOf: (kind, key) => kind === 'job' && key === 'J1' });
  assert.deepEqual(by, { privileged: 1 });
  assert.equal(findings[0].effect, 'privileged');
});

test('does not stamp when entry has no kind', () => {
  const findings = [{ id: 1, startedBy: [{ other: 'X' }] }];
  const by = stampEffect(findings, { privilegedOf: () => true });
  assert.deepEqual(by, { privileged: 0 });
  assert.equal(findings[0].effect, undefined);
});

test('does not stamp when resolver returns false for flagged entry', () => {
  const findings = [{ id: 1, startedBy: [{ transaction: 'T1' }] }];
  const by = stampEffect(findings, { privilegedOf: () => false });
  assert.deepEqual(by, { privileged: 0 });
  assert.equal(findings[0].effect, undefined);
});

test('stamps only once when multiple entries are flagged', () => {
  const findings = [{ id: 1, startedBy: [{ transaction: 'T1' }, { job: 'J1' }] }];
  const by = stampEffect(findings, { privilegedOf: () => true });
  assert.deepEqual(by, { privileged: 1 });
  assert.equal(findings[0].effect, 'privileged');
});

test('counts each stamped finding separately', () => {
  const findings = [
    { id: 1, startedBy: [{ transaction: 'T1' }] },
    { id: 2, startedBy: [{ job: 'J1' }] },
    { id: 3, startedBy: [] },
  ];
  const by = stampEffect(findings, { privilegedOf: () => true });
  assert.deepEqual(by, { privileged: 2 });
  assert.equal(findings[0].effect, 'privileged');
  assert.equal(findings[1].effect, 'privileged');
  assert.equal(findings[2].effect, undefined);
});
