// Groups DD statements by their DD name, with each group containing the DD and any subsequent unnamed DDs (lib/utilities.mjs ddGroups).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddGroups } from '../lib/utilities.mjs';
import './pin-machine.mjs';

test('returns an empty map when step has no DDs', () => {
  const step = { dds: [] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map());
});

test('groups a single named DD into its own group', () => {
  const step = { dds: [{ name: 'SYSIN' }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([['SYSIN', [{ name: 'SYSIN' }]]]));
});

test('groups multiple named DDs into separate groups', () => {
  const step = { dds: [{ name: 'SYSIN' }, { name: 'SYSPRINT' }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([
    ['SYSIN', [{ name: 'SYSIN' }]],
    ['SYSPRINT', [{ name: 'SYSPRINT' }]]
  ]));
});

test('appends unnamed DDs to the current named group', () => {
  const step = { dds: [{ name: 'SYSIN' }, { name: null }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([['SYSIN', [{ name: 'SYSIN' }, { name: null }]]]));
});

test('starts a new group when a named DD follows an unnamed DD', () => {
  const step = { dds: [{ name: 'SYSIN' }, { name: null }, { name: 'SYSPRINT' }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([
    ['SYSIN', [{ name: 'SYSIN' }, { name: null }]],
    ['SYSPRINT', [{ name: 'SYSPRINT' }]]
  ]));
});

test('uppercases DD names when grouping', () => {
  const step = { dds: [{ name: 'sysin' }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([['SYSIN', [{ name: 'sysin' }]]]));
});

test('treats empty string name as falsy and does not create a new group', () => {
  const step = { dds: [{ name: 'SYSIN' }, { name: '' }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([['SYSIN', [{ name: 'SYSIN' }, { name: '' }]]]));
});

test('ignores unnamed DDs before any named DD', () => {
  const step = { dds: [{ name: null }, { name: 'SYSIN' }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([['SYSIN', [{ name: 'SYSIN' }]]]));
});

test('groups repeated DD names into the same group', () => {
  const step = { dds: [{ name: 'SYSIN' }, { name: 'SYSIN' }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([['SYSIN', [{ name: 'SYSIN' }, { name: 'SYSIN' }]]]));
});

test('handles mixed case and empty names in sequence', () => {
  const step = { dds: [{ name: 'sysin' }, { name: '' }, { name: 'SYSPRINT' }, { name: null }] };
  const result = ddGroups(step);
  assert.deepEqual(result, new Map([
    ['SYSIN', [{ name: 'sysin' }, { name: '' }]],
    ['SYSPRINT', [{ name: 'SYSPRINT' }, { name: null }]]
  ]));
});
