// Stamp reach on findings reached by entries and count open, restricted, undeclared (lib/reach.mjs stampReach).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampReach } from '../lib/reach.mjs';
import './pin-machine.mjs';

test('returns zero counts when no findings are present', () => {
  const findings = [];
  const resolver = { accessOf: () => 'open' };
  assert.deepEqual(stampReach(findings, resolver), { open: 0, restricted: 0, undeclared: 0 });
});

test('skips findings with no startedBy entries', () => {
  const findings = [{ id: 'f1' }];
  const resolver = { accessOf: () => 'open' };
  const by = stampReach(findings, resolver);
  assert.deepEqual(by, { open: 0, restricted: 0, undeclared: 0 });
  assert.equal(findings[0].reach, undefined);
});

test('marks finding as open when any entry is open', () => {
  const findings = [{ id: 'f1', startedBy: [{ transaction: 'T1' }, { transaction: 'T2' }] }];
  const resolver = { accessOf: (kind, key) => (key === 'T1' ? 'open' : 'restricted') };
  const by = stampReach(findings, resolver);
  assert.equal(findings[0].reach, 'open');
  assert.deepEqual(by, { open: 1, restricted: 0, undeclared: 0 });
});

test('marks finding as restricted when all entries are restricted and no more', () => {
  const findings = [{ id: 'f1', startedBy: [{ transaction: 'T1' }, { transaction: 'T2' }] }];
  const resolver = { accessOf: () => 'restricted' };
  const by = stampReach(findings, resolver);
  assert.equal(findings[0].reach, 'restricted');
  assert.deepEqual(by, { open: 0, restricted: 1, undeclared: 0 });
});

test('marks finding as undeclared when startedByMore is true', () => {
  const findings = [{ id: 'f1', startedBy: [{ transaction: 'T1' }], startedByMore: true }];
  const resolver = { accessOf: () => 'restricted' };
  const by = stampReach(findings, resolver);
  assert.equal(findings[0].reach, 'undeclared');
  assert.deepEqual(by, { open: 0, restricted: 0, undeclared: 1 });
});

test('marks finding as undeclared when an entry has no access', () => {
  const findings = [{ id: 'f1', startedBy: [{ transaction: 'T1' }, { job: 'J1' }] }];
  const resolver = { accessOf: (kind, key) => (kind === 'transaction' ? 'restricted' : null) };
  const by = stampReach(findings, resolver);
  assert.equal(findings[0].reach, 'undeclared');
  assert.deepEqual(by, { open: 0, restricted: 0, undeclared: 1 });
});

test('counts multiple findings across all three reach categories', () => {
  const findings = [
    { id: 'f1', startedBy: [{ transaction: 'T1' }] },
    { id: 'f2', startedBy: [{ transaction: 'T2' }] },
    { id: 'f3', startedBy: [{ transaction: 'T3' }] },
  ];
  const resolver = {
    accessOf: (kind, key) => {
      if (key === 'T1') return 'open';
      if (key === 'T2') return 'restricted';
      return null;
    },
  };
  const by = stampReach(findings, resolver);
  assert.equal(findings[0].reach, 'open');
  assert.equal(findings[1].reach, 'restricted');
  assert.equal(findings[2].reach, 'undeclared');
  assert.deepEqual(by, { open: 1, restricted: 1, undeclared: 1 });
});

test('handles job entries alongside transaction entries', () => {
  const findings = [{ id: 'f1', startedBy: [{ job: 'J1' }, { transaction: 'T1' }] }];
  const resolver = {
    accessOf: (kind, key) => {
      if (kind === 'job') return 'restricted';
      return 'open';
    },
  };
  const by = stampReach(findings, resolver);
  assert.equal(findings[0].reach, 'open');
  assert.deepEqual(by, { open: 1, restricted: 0, undeclared: 0 });
});
