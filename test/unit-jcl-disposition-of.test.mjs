// Extracts and normalizes the status, normal, and abnormal disposition parameters from a JCL DISP parameter string (lib/jcl.mjs dispositionOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispositionOf } from '../lib/jcl.mjs';
import './pin-machine.mjs';

test('returns null for empty input', () => {
  assert.deepEqual(dispositionOf(''), null);
});

test('returns null for undefined input', () => {
  assert.deepEqual(dispositionOf(undefined), null);
});

test('returns null for null input', () => {
  assert.deepEqual(dispositionOf(null), null);
});

test('defaults status to NEW when omitted', () => {
  assert.deepEqual(dispositionOf('(,PASS,DELETE)'), { status: 'NEW', normal: 'PASS', abnormal: 'DELETE' });
});

test('defaults normal and abnormal to null when omitted', () => {
  assert.deepEqual(dispositionOf('(SHR)'), { status: 'SHR', normal: null, abnormal: null });
});

test('defaults all fields when input is just parentheses', () => {
  assert.deepEqual(dispositionOf('()'), { status: 'NEW', normal: null, abnormal: null });
});

test('normalizes case and trims whitespace', () => {
  assert.deepEqual(dispositionOf('(shr, pass, delete)'), { status: 'SHR', normal: 'PASS', abnormal: 'DELETE' });
});

test('handles input without parentheses', () => {
  assert.deepEqual(dispositionOf('SHR,PASS,DELETE'), { status: 'SHR', normal: 'PASS', abnormal: 'DELETE' });
});

test('handles extra commas resulting in empty trailing fields', () => {
  assert.deepEqual(dispositionOf('(SHR,,DELETE)'), { status: 'SHR', normal: null, abnormal: 'DELETE' });
});

test('handles multiple empty fields', () => {
  assert.deepEqual(dispositionOf('(,,DELETE)'), { status: 'NEW', normal: null, abnormal: 'DELETE' });
});
