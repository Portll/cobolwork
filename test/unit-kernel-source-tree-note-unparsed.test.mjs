// Records a file that was read but not parsed, incrementing a counter and appending a diagnostic string (lib/kernel/source-tree.mjs noteUnparsed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteUnparsed } from '../lib/kernel/source-tree.mjs';
import './pin-machine.mjs';

test('increments filesUnparsed from zero to one and appends a diagnostic with the error code', () => {
  const stats = {};
  const tree = { rel: (f) => 'a.cbl' };
  const file = 'a.cbl';
  const err = { code: 'ENOENT' };
  noteUnparsed(stats, tree, file, err);
  assert.equal(stats.filesUnparsed, 1);
  assert.deepEqual(stats.unparsed, ['a.cbl: ENOENT']);
});

test('increments filesUnparsed from one to two and appends a second diagnostic', () => {
  const stats = { filesUnparsed: 1, unparsed: ['x.cbl: EACCES'] };
  const tree = { rel: (f) => 'b.cbl' };
  const file = 'b.cbl';
  const err = { code: 'EACCES' };
  noteUnparsed(stats, tree, file, err);
  assert.equal(stats.filesUnparsed, 2);
  assert.deepEqual(stats.unparsed, ['x.cbl: EACCES', 'b.cbl: EACCES']);
});

test('uses the error name when the error has no code', () => {
  const stats = {};
  const tree = { rel: (f) => 'c.cbl' };
  const file = 'c.cbl';
  const err = { name: 'ReferenceError' };
  noteUnparsed(stats, tree, file, err);
  assert.equal(stats.filesUnparsed, 1);
  assert.deepEqual(stats.unparsed, ['c.cbl: ReferenceError']);
});

test('uses the error code when both code and name are present', () => {
  const stats = {};
  const tree = { rel: (f) => 'd.cbl' };
  const file = 'd.cbl';
  const err = { code: 'EPERM', name: 'Error' };
  noteUnparsed(stats, tree, file, err);
  assert.equal(stats.filesUnparsed, 1);
  assert.deepEqual(stats.unparsed, ['d.cbl: EPERM']);
});

test('uses unknown when the error is null', () => {
  const stats = {};
  const tree = { rel: (f) => 'e.cbl' };
  const file = 'e.cbl';
  noteUnparsed(stats, tree, file, null);
  assert.equal(stats.filesUnparsed, 1);
  assert.deepEqual(stats.unparsed, ['e.cbl: unknown']);
});

test('uses unknown when the error is undefined', () => {
  const stats = {};
  const tree = { rel: (f) => 'f.cbl' };
  const file = 'f.cbl';
  noteUnparsed(stats, tree, file, undefined);
  assert.equal(stats.filesUnparsed, 1);
  assert.deepEqual(stats.unparsed, ['f.cbl: unknown']);
});

test('uses unknown when the error is an empty object', () => {
  const stats = {};
  const tree = { rel: (f) => 'g.cbl' };
  const file = 'g.cbl';
  noteUnparsed(stats, tree, file, {});
  assert.equal(stats.filesUnparsed, 1);
  assert.deepEqual(stats.unparsed, ['g.cbl: unknown']);
});

test('initializes the unparsed array when it is not yet present', () => {
  const stats = { filesUnparsed: 0 };
  const tree = { rel: (f) => 'h.cbl' };
  const file = 'h.cbl';
  const err = { code: 'EISDIR' };
  noteUnparsed(stats, tree, file, err);
  assert.equal(stats.filesUnparsed, 1);
  assert.deepEqual(stats.unparsed, ['h.cbl: EISDIR']);
});
