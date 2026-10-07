// The DD a queue is written to, following one INDIRECT hop (lib/csd.mjs ddOfQueue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddOfQueue } from '../lib/csd.mjs';
import './pin-machine.mjs';

test('returns null when the queue is not defined', () => {
  const csd = { tdqueues: new Map() };
  assert.equal(ddOfQueue(csd, 'Q1'), null);
});

test('returns the ddname when the queue is EXTRA with a ddname', () => {
  const csd = { tdqueues: new Map([['Q1', { type: 'EXTRA', ddname: 'DD1' }]]) };
  assert.equal(ddOfQueue(csd, 'Q1'), 'DD1');
});

test('returns null when the queue is INDIRECT but the indirect target is missing', () => {
  const csd = { tdqueues: new Map([['Q1', { type: 'INDIRECT', indirect: 'Q2' }]]) };
  assert.equal(ddOfQueue(csd, 'Q1'), null);
});

test('returns the ddname when the queue is INDIRECT and the indirect target is EXTRA with a ddname', () => {
  const csd = {
    tdqueues: new Map([
      ['Q1', { type: 'INDIRECT', indirect: 'Q2' }],
      ['Q2', { type: 'EXTRA', ddname: 'DD2' }]
    ])
  };
  assert.equal(ddOfQueue(csd, 'Q1'), 'DD2');
});

test('returns null when the queue is INDIRECT but indirect is null', () => {
  const csd = { tdqueues: new Map([['Q1', { type: 'INDIRECT', indirect: null }]]) };
  assert.equal(ddOfQueue(csd, 'Q1'), null);
});

test('returns null when the queue is of an unknown type', () => {
  const csd = { tdqueues: new Map([['Q1', { type: 'OTHER', ddname: 'DD1' }]]) };
  assert.equal(ddOfQueue(csd, 'Q1'), null);
});
