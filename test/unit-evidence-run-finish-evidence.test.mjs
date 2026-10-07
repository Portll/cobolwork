// Closes the journal and reports ledger failure to stderr (lib/evidence/run.mjs finishEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finishEvidence } from '../lib/evidence/run.mjs';
import './pin-machine.mjs';

test('returns null when journal is null', () => {
  assert.equal(finishEvidence(null, 0), null);
});

test('returns null when journal is undefined', () => {
  assert.equal(finishEvidence(undefined, 0), null);
});

test('returns close result when ledger is recorded and exit is safe integer', () => {
  const result = { ledger: 'recorded', reason: null };
  const journal = { id: 'test-id', close: (opts) => result };
  assert.deepEqual(finishEvidence(journal, 0), result);
});

test('writes to stderr when ledger is not recorded', () => {
  const result = { ledger: 'failed', reason: 'disk full' };
  const journal = { id: 'test-id', close: (opts) => result };
  const stderrWrites = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk) => { stderrWrites.push(chunk); return true; };
  try {
    const r = finishEvidence(journal, 0);
    assert.deepEqual(r, result);
    assert.equal(stderrWrites.length, 1);
    assert.equal(stderrWrites[0], 'cobolwork: evidence run test-id was not recorded in the ledger: disk full\n');
  } finally {
    process.stderr.write = originalWrite;
  }
});

test('passes null to close when exit is not a safe integer', () => {
  const result = { ledger: 'recorded', reason: null };
  let capturedOpts;
  const journal = { id: 'test-id', close: (opts) => { capturedOpts = opts; return result; } };
  finishEvidence(journal, 'not-a-number');
  assert.deepEqual(capturedOpts, { exit: null });
});

test('passes exit value to close when exit is a safe integer', () => {
  const result = { ledger: 'recorded', reason: null };
  let capturedOpts;
  const journal = { id: 'test-id', close: (opts) => { capturedOpts = opts; return result; } };
  finishEvidence(journal, 42);
  assert.deepEqual(capturedOpts, { exit: 42 });
});

test('passes null to close when exit is NaN', () => {
  const result = { ledger: 'recorded', reason: null };
  let capturedOpts;
  const journal = { id: 'test-id', close: (opts) => { capturedOpts = opts; return result; } };
  finishEvidence(journal, NaN);
  assert.deepEqual(capturedOpts, { exit: null });
});

test('passes null to close when exit is Infinity', () => {
  const result = { ledger: 'recorded', reason: null };
  let capturedOpts;
  const journal = { id: 'test-id', close: (opts) => { capturedOpts = opts; return result; } };
  finishEvidence(journal, Infinity);
  assert.deepEqual(capturedOpts, { exit: null });
});
