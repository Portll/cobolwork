// A DSN=*.step.dd or *.dd referback resolved to the data set it names (lib/jcl.mjs resolveReferback).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferback } from '../lib/jcl.mjs';
import './pin-machine.mjs';

test('returns original dsn and null referback when dsn is not a referback pattern', () => {
  const result = resolveReferback('MY.DATASET.NAME', [], 'STEP010');
  assert.deepEqual(result, { dsn: 'MY.DATASET.NAME', referback: null });
});

test('returns original dsn and null referback when dsn is empty string', () => {
  const result = resolveReferback('', [], 'STEP010');
  assert.deepEqual(result, { dsn: '', referback: null });
});

test('returns original dsn and null referback when dsn is null', () => {
  const result = resolveReferback(null, [], 'STEP010');
  assert.deepEqual(result, { dsn: null, referback: null });
});

test('resolves referback to same step when step name is omitted and dd matches current step', () => {
  const dds = [
    { name: 'SYSUT2', step: 'STEP010', dsn: 'RESOLVED.DATASET' },
    { name: 'SYSUT2', step: 'STEP020', dsn: 'OTHER.DATASET' }
  ];
  const result = resolveReferback('*.SYSUT2', dds, 'STEP010');
  assert.deepEqual(result, {
    dsn: 'RESOLVED.DATASET',
    referback: { step: 'STEP010', dd: 'SYSUT2', resolved: true }
  });
});

test('resolves referback to specific step when step name is provided and matches', () => {
  const dds = [
    { name: 'SYSUT2', step: 'STEP010', dsn: 'RESOLVED.DATASET' },
    { name: 'SYSUT2', step: 'STEP020', dsn: 'OTHER.DATASET' }
  ];
  const result = resolveReferback('*.STEP010.SYSUT2', dds, 'STEP030');
  assert.deepEqual(result, {
    dsn: 'RESOLVED.DATASET',
    referback: { step: 'STEP010', dd: 'SYSUT2', resolved: true }
  });
});

test('returns original dsn when referback step name does not match any dd step', () => {
  const dds = [
    { name: 'SYSUT2', step: 'STEP010', dsn: 'RESOLVED.DATASET' }
  ];
  const result = resolveReferback('*.STEP999.SYSUT2', dds, 'STEP030');
  assert.deepEqual(result, {
    dsn: '*.STEP999.SYSUT2',
    referback: { step: 'STEP999', dd: 'SYSUT2', resolved: false }
  });
});

test('returns original dsn when referback dd name does not match any dd in current step', () => {
  const dds = [
    { name: 'SYSIN', step: 'STEP010', dsn: 'INPUT.DATASET' }
  ];
  const result = resolveReferback('*.SYSOUT', dds, 'STEP010');
  assert.deepEqual(result, {
    dsn: '*.SYSOUT',
    referback: { step: 'STEP010', dd: 'SYSOUT', resolved: false }
  });
});

test('resolves referback case-insensitively when dd name case differs', () => {
  const dds = [
    { name: 'sysut2', step: 'STEP010', dsn: 'RESOLVED.DATASET' }
  ];
  const result = resolveReferback('*.SYSUT2', dds, 'STEP010');
  assert.deepEqual(result, {
    dsn: 'RESOLVED.DATASET',
    referback: { step: 'STEP010', dd: 'SYSUT2', resolved: true }
  });
});

test('returns original dsn when referback pattern has invalid characters', () => {
  const result = resolveReferback('*.INVALID-CHAR.SYSUT2', [], 'STEP010');
  assert.deepEqual(result, { dsn: '*.INVALID-CHAR.SYSUT2', referback: null });
});

test('returns original dsn when dd has no step property and step name is omitted', () => {
  const dds = [
    { name: 'SYSUT2', dsn: 'RESOLVED.DATASET' }
  ];
  const result = resolveReferback('*.SYSUT2', dds, 'STEP010');
  assert.deepEqual(result, {
    dsn: '*.SYSUT2',
    referback: { step: 'STEP010', dd: 'SYSUT2', resolved: false }
  });
});
