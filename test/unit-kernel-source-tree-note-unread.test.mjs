// Records a file read failure in stats (lib/kernel/source-tree.mjs noteUnread).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteUnread } from '../lib/kernel/source-tree.mjs';
import './pin-machine.mjs';

test('increments filesUnreadable from zero to one', () => {
  const stats = {};
  const tree = { rel: (f) => 'a.cbl' };
  const file = 'a.cbl';
  const err = { code: 'ENOENT' };
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 1);
  assert.deepEqual(stats.unreadable, ['a.cbl: ENOENT']);
});

test('increments filesUnreadable from existing count', () => {
  const stats = { filesUnreadable: 5 };
  const tree = { rel: (f) => 'b.cbl' };
  const file = 'b.cbl';
  const err = { code: 'EACCES' };
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 6);
  assert.deepEqual(stats.unreadable, ['b.cbl: EACCES']);
});

test('uses error name when code is missing', () => {
  const stats = {};
  const tree = { rel: (f) => 'c.cbl' };
  const file = 'c.cbl';
  const err = { name: 'ReferenceError' };
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 1);
  assert.deepEqual(stats.unreadable, ['c.cbl: ReferenceError']);
});

test('uses unknown when err is null', () => {
  const stats = {};
  const tree = { rel: (f) => 'd.cbl' };
  const file = 'd.cbl';
  const err = null;
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 1);
  assert.deepEqual(stats.unreadable, ['d.cbl: unknown']);
});

test('uses unknown when err is undefined', () => {
  const stats = {};
  const tree = { rel: (f) => 'e.cbl' };
  const file = 'e.cbl';
  const err = undefined;
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 1);
  assert.deepEqual(stats.unreadable, ['e.cbl: unknown']);
});

test('uses unknown when err has no code or name', () => {
  const stats = {};
  const tree = { rel: (f) => 'f.cbl' };
  const file = 'f.cbl';
  const err = {};
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 1);
  assert.deepEqual(stats.unreadable, ['f.cbl: unknown']);
});

test('appends to existing unreadable array', () => {
  const stats = { filesUnreadable: 1, unreadable: ['x.cbl: ENOENT'] };
  const tree = { rel: (f) => 'y.cbl' };
  const file = 'y.cbl';
  const err = { code: 'EACCES' };
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 2);
  assert.deepEqual(stats.unreadable, ['x.cbl: ENOENT', 'y.cbl: EACCES']);
});

test('creates unreadable array when not present', () => {
  const stats = { filesUnreadable: 0 };
  const tree = { rel: (f) => 'g.cbl' };
  const file = 'g.cbl';
  const err = { code: 'EISDIR' };
  noteUnread(stats, tree, file, err);
  assert.equal(stats.filesUnreadable, 1);
  assert.deepEqual(stats.unreadable, ['g.cbl: EISDIR']);
});
