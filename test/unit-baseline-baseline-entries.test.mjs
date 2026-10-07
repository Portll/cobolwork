// Computes baseline entries to accept findings, preserving existing entries (lib/baseline.mjs baselineEntries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineEntries } from '../lib/baseline.mjs';
import './pin-machine.mjs';

test('returns empty entries and zero added when findings is empty', () => {
  const result = baselineEntries([]);
  assert.deepEqual(result, { entries: [], added: 0 });
});

test('adds a finding with default action accept and no reason', () => {
  const findings = [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob' }];
  const at = '2024-01-01T00:00:00.000Z';
  const result = baselineEntries(findings, [], { at });
  assert.deepEqual(result, {
    entries: [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob', action: 'accept', reason: undefined, who: undefined, at, expires: undefined }],
    added: 1
  });
});

test('skips findings that already exist in the baseline', () => {
  const findings = [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob' }];
  const existing = [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob', action: 'accept', reason: 'old', who: 'bob', at: '2023-01-01', expires: '2024-01-01' }];
  const at = '2024-01-01T00:00:00.000Z';
  const result = baselineEntries(findings, existing, { at });
  assert.deepEqual(result, { entries: existing, added: 0 });
});

test('adds findings not in the existing baseline', () => {
  const findings = [{ fingerprint: 'fp2', rule: 'rule1', path: 'b.cob' }];
  const existing = [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob', action: 'accept', reason: 'old', who: 'bob', at: '2023-01-01', expires: '2024-01-01' }];
  const at = '2024-01-01T00:00:00.000Z';
  const result = baselineEntries(findings, existing, { at });
  assert.deepEqual(result, {
    entries: [
      existing[0],
      { fingerprint: 'fp2', rule: 'rule1', path: 'b.cob', action: 'accept', reason: undefined, who: undefined, at, expires: undefined }
    ],
    added: 1
  });
});

test('skips findings without a fingerprint', () => {
  const findings = [{ rule: 'rule1', path: 'a.cob' }];
  const at = '2024-01-01T00:00:00.000Z';
  const result = baselineEntries(findings, [], { at });
  assert.deepEqual(result, { entries: [], added: 0 });
});

test('filters findings by rules when provided', () => {
  const findings = [
    { fingerprint: 'fp1', rule: 'rule1', path: 'a.cob' },
    { fingerprint: 'fp2', rule: 'rule2', path: 'b.cob' }
  ];
  const at = '2024-01-01T00:00:00.000Z';
  const result = baselineEntries(findings, [], { at, rules: ['rule1'] });
  assert.deepEqual(result, {
    entries: [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob', action: 'accept', reason: undefined, who: undefined, at, expires: undefined }],
    added: 1
  });
});

test('uses custom action, reason, who, and expires when provided', () => {
  const findings = [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob' }];
  const at = '2024-01-01T00:00:00.000Z';
  const result = baselineEntries(findings, [], { at, action: 'ignore', reason: 'known issue', who: 'alice', expires: '2025-01-01' });
  assert.deepEqual(result, {
    entries: [{ fingerprint: 'fp1', rule: 'rule1', path: 'a.cob', action: 'ignore', reason: 'known issue', who: 'alice', at, expires: '2025-01-01' }],
    added: 1
  });
});

test('handles multiple findings with some already in baseline', () => {
  const findings = [
    { fingerprint: 'fp1', rule: 'rule1', path: 'a.cob' },
    { fingerprint: 'fp2', rule: 'rule1', path: 'b.cob' },
    { fingerprint: 'fp3', rule: 'rule2', path: 'c.cob' }
  ];
  const existing = [{ fingerprint: 'fp2', rule: 'rule1', path: 'b.cob', action: 'accept', reason: 'old', who: 'bob', at: '2023-01-01', expires: '2024-01-01' }];
  const at = '2024-01-01T00:00:00.000Z';
  const result = baselineEntries(findings, existing, { at });
  assert.deepEqual(result, {
    entries: [
      existing[0],
      { fingerprint: 'fp1', rule: 'rule1', path: 'a.cob', action: 'accept', reason: undefined, who: undefined, at, expires: undefined },
      { fingerprint: 'fp3', rule: 'rule2', path: 'c.cob', action: 'accept', reason: undefined, who: undefined, at, expires: undefined }
    ],
    added: 2
  });
});
