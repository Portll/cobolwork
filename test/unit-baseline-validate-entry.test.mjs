// Returns a list of validation errors for a single baseline entry (lib/baseline.mjs validateEntry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry } from '../lib/baseline.mjs';
import './pin-machine.mjs';

test('rejects a non-object entry', () => {
  assert.deepEqual(validateEntry(null), ['entry is not an object']);
  assert.deepEqual(validateEntry('x'), ['entry is not an object']);
  assert.deepEqual(validateEntry([]), ['entry is not an object']);
});

test('accepts a fully valid note entry', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'note',
    reason: 'r',
    who: 'w',
    at: '2027-01-31',
  };
  assert.deepEqual(validateEntry(e), []);
});

test('rejects a bad fingerprint', () => {
  const e = {
    fingerprint: 'xyz',
    rule: 'R1',
    action: 'note',
    reason: 'r',
    who: 'w',
    at: '2027-01-31',
  };
  assert.deepEqual(validateEntry(e), ['fingerprint must be the 32 hex digits a report prints']);
});

test('rejects a missing rule', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: '',
    action: 'note',
    reason: 'r',
    who: 'w',
    at: '2027-01-31',
  };
  assert.deepEqual(validateEntry(e), ['missing rule']);
});

test('rejects an unknown action', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'bogus',
    reason: 'r',
    who: 'w',
    at: '2027-01-31',
  };
  assert.deepEqual(validateEntry(e), ['action must be one of accept, false-positive, wont-fix, incorrect-scan-result, note, resolved']);
});

test('rejects a missing reason', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'note',
    reason: '   ',
    who: 'w',
    at: '2027-01-31',
  };
  assert.deepEqual(validateEntry(e), ['missing reason']);
});

test('rejects a missing who', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'note',
    reason: 'r',
    who: '',
    at: '2027-01-31',
  };
  assert.deepEqual(validateEntry(e), ['missing who']);
});

test('rejects a non-ISO at date', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'note',
    reason: 'r',
    who: 'w',
    at: '31/01/2027',
  };
  assert.deepEqual(validateEntry(e), ['missing at, or not an ISO 8601 date such as 2027-01-31']);
});

test('requires an expires date for a suppression', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'accept',
    reason: 'r',
    who: 'w',
    at: '2027-01-31',
  };
  assert.deepEqual(validateEntry(e), ['a suppression needs an expires date: one that never lapses is never looked at again']);
});

test('rejects a non-ISO expires date', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'accept',
    reason: 'r',
    who: 'w',
    at: '2027-01-31',
    expires: 'soon',
  };
  assert.deepEqual(validateEntry(e), ['expires is not an ISO 8601 date such as 2027-01-31']);
});

test('requires defect.detail for incorrect-scan-result', () => {
  const e = {
    fingerprint: 'a'.repeat(32),
    rule: 'R1',
    action: 'incorrect-scan-result',
    reason: 'r',
    who: 'w',
    at: '2027-01-31',
    expires: '2028-01-31',
  };
  assert.deepEqual(validateEntry(e), ['incorrect-scan-result must say what the scanner got wrong, in defect.detail']);
});
