// Maps a dataset disposition status to the step's access mode (lib/jcl.mjs accessOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessOf } from '../lib/jcl.mjs';
import './pin-machine.mjs';

test('returns unknown when disposition is empty string', () => {
  assert.equal(accessOf(''), 'unknown');
});

test('returns create when status is NEW', () => {
  assert.equal(accessOf('(NEW,DELETE,DELETE)'), 'create');
});

test('returns create when status is omitted and defaults to NEW', () => {
  assert.equal(accessOf('(,PASS,KEEP)'), 'create');
});

test('returns append when status is MOD', () => {
  assert.equal(accessOf('(MOD,KEEP,KEEP)'), 'append');
});

test('returns read when status is SHR', () => {
  assert.equal(accessOf('(SHR,KEEP,KEEP)'), 'read');
});

test('returns exclusive when status is OLD', () => {
  assert.equal(accessOf('(OLD,DELETE,DELETE)'), 'exclusive');
});

test('returns unknown when status is unrecognized', () => {
  assert.equal(accessOf('(FOO,KEEP,KEEP)'), 'unknown');
});

test('handles lowercase input by uppercasing status', () => {
  assert.equal(accessOf('(new,delete,delete)'), 'create');
});
