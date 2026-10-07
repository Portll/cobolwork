// Resolve entry-point access and privilege from feeds and site keys (lib/reach.mjs reachResolver).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachResolver } from '../lib/reach.mjs';
import './pin-machine.mjs';

test('returns declared false and effectDeclared false when no feeds and no site keys', () => {
  const r = reachResolver({ feeds: [], site: {} });
  assert.equal(r.declared, false);
  assert.equal(r.effectDeclared, false);
  assert.equal(r.accessOf('transaction', 'T1'), null);
  assert.equal(r.privilegedOf('transaction', 'T1'), false);
  assert.equal(r.accessFrom('transaction', 'T1'), null);
  assert.equal(r.privilegedFrom('transaction', 'T1'), null);
});

test('returns declared true when site has open transactions', () => {
  const r = reachResolver({ feeds: [], site: { openTransactions: ['T1'] } });
  assert.equal(r.declared, true);
  assert.equal(r.effectDeclared, false);
  assert.equal(r.accessOf('transaction', 'T1'), 'open');
  assert.equal(r.accessFrom('transaction', 'T1'), 'the site file');
});

test('returns declared true when site has restricted jobs', () => {
  const r = reachResolver({ feeds: [], site: { restrictedJobs: ['J1'] } });
  assert.equal(r.declared, true);
  assert.equal(r.effectDeclared, false);
  assert.equal(r.accessOf('job', 'J1'), 'restricted');
  assert.equal(r.accessFrom('job', 'J1'), 'the site file');
});

test('returns effectDeclared true when site has privileged transactions', () => {
  const r = reachResolver({ feeds: [], site: { privilegedTransactions: ['T1'] } });
  assert.equal(r.declared, false);
  assert.equal(r.effectDeclared, true);
  assert.equal(r.privilegedOf('transaction', 'T1'), true);
  assert.equal(r.privilegedFrom('transaction', 'T1'), 'the site file');
});

test('returns access from feed when feed names the transaction', () => {
  const feed = { file: 'f.cbl', extract: 'E1', retrieved: '2024-01-01', problem: null, transactions: { T1: 'open' }, jobs: {}, privileged: { transactions: [], jobs: [] } };
  const r = reachResolver({ feeds: [feed], site: {} });
  assert.equal(r.declared, true);
  assert.equal(r.effectDeclared, false);
  assert.equal(r.accessOf('transaction', 'T1'), 'open');
  assert.equal(r.accessFrom('transaction', 'T1'), 'f.cbl (E1, retrieved 2024-01-01)');
});

test('returns privileged from feed when feed names the job', () => {
  const feed = { file: 'f.cbl', extract: 'E1', retrieved: '2024-01-01', problem: null, transactions: {}, jobs: {}, privileged: { transactions: [], jobs: ['J1'] } };
  const r = reachResolver({ feeds: [feed], site: {} });
  assert.equal(r.declared, false);
  assert.equal(r.effectDeclared, true);
  assert.equal(r.privilegedOf('job', 'J1'), true);
  assert.equal(r.privilegedFrom('job', 'J1'), 'f.cbl (E1, retrieved 2024-01-01)');
});

test('ignores feeds with problem set', () => {
  const feed = { file: 'f.cbl', extract: 'E1', retrieved: '2024-01-01', problem: 'bad', transactions: { T1: 'open' }, jobs: {}, privileged: { transactions: [], jobs: [] } };
  const r = reachResolver({ feeds: [feed], site: {} });
  assert.equal(r.declared, false);
  assert.equal(r.effectDeclared, false);
  assert.equal(r.accessOf('transaction', 'T1'), null);
  assert.equal(r.privilegedOf('transaction', 'T1'), false);
});

test('returns null for unknown kind in accessOf', () => {
  const r = reachResolver({ feeds: [], site: {} });
  assert.equal(r.accessOf('unknown', 'X'), null);
  assert.equal(r.privilegedOf('unknown', 'X'), false);
});

test('returns restricted access from site when not open', () => {
  const r = reachResolver({ feeds: [], site: { openTransactions: ['T1'], restrictedTransactions: ['T2'] } });
  assert.equal(r.accessOf('transaction', 'T1'), 'open');
  assert.equal(r.accessOf('transaction', 'T2'), 'restricted');
  assert.equal(r.accessOf('transaction', 'T3'), null);
});

test('returns open access from site for jobs', () => {
  const r = reachResolver({ feeds: [], site: { openJobs: ['J1'], restrictedJobs: ['J2'] } });
  assert.equal(r.accessOf('job', 'J1'), 'open');
  assert.equal(r.accessOf('job', 'J2'), 'restricted');
  assert.equal(r.accessOf('job', 'J3'), null);
});
