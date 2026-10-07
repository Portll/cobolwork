// Records a verdict entry into the journal with normalized checks, relaxed and exit fields (lib/evidence/run.mjs recordVerdict).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordVerdict } from '../lib/evidence/run.mjs';
import './pin-machine.mjs';

test('returns without appending when journal is null', () => {
  const calls = [];
  const journal = null;
  const doc = { verdict: 'pass' };
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 0);
});

test('returns without appending when doc is null', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = null;
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 0);
});

test('appends verdict with stringified verdict and undefined checks when doc.checks is missing', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 42 };
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'verdict');
  assert.equal(calls[0][1].verdict, '42');
  assert.equal(calls[0][1].checks, undefined);
  assert.equal(calls[0][1].relaxed, undefined);
  assert.equal(calls[0][1].exit, 0);
});

test('filters checks to only null and boolean values', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 'pass', checks: { a: true, b: false, c: null, d: 'string', e: 1, f: undefined } };
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].checks, { a: true, b: false, c: null });
});

test('sets checks to undefined when doc.checks is not an object', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 'pass', checks: 'not-an-object' };
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].checks, undefined);
});

test('maps relaxed array elements to strings', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 'pass', relaxed: [1, 2, 3] };
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].relaxed, ['1', '2', '3']);
});

test('sets relaxed to undefined when doc.relaxed is not an array', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 'pass', relaxed: 'not-an-array' };
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].relaxed, undefined);
});

test('sets exit to undefined when exit is not a safe integer', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 'pass' };
  recordVerdict(journal, doc, 'not-a-number');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].exit, undefined);
});

test('sets exit to the number when exit is a safe integer', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 'pass' };
  recordVerdict(journal, doc, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].exit, 1);
});

test('handles empty checks object and empty relaxed array', () => {
  const calls = [];
  const journal = { append: (t, d) => calls.push([t, d]) };
  const doc = { verdict: 'pass', checks: {}, relaxed: [] };
  recordVerdict(journal, doc, 0);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1].checks, {});
  assert.deepEqual(calls[0][1].relaxed, []);
  assert.equal(calls[0][1].exit, 0);
});
