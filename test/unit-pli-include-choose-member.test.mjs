// The candidate beside `from`, else the first one (lib/pli/include.mjs chooseMember).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseMember } from '../lib/pli/include.mjs';
import './pin-machine.mjs';

test('returns null when candidates is empty', () => {
  assert.strictEqual(chooseMember([], 'foo.cob'), null);
});

test('returns null when candidates is undefined', () => {
  assert.strictEqual(chooseMember(undefined, 'foo.cob'), null);
});

test('returns the first candidate when none share the same directory', () => {
  const candidates = ['/a/b/file1.cob', '/c/d/file2.cob'];
  assert.strictEqual(chooseMember(candidates, '/x/y/from.cob'), '/a/b/file1.cob');
});

test('returns the first candidate that shares the same directory as from', () => {
  const candidates = ['/a/b/file1.cob', '/a/b/file2.cob', '/c/d/file3.cob'];
  assert.strictEqual(chooseMember(candidates, '/a/b/from.cob'), '/a/b/file1.cob');
});

test('returns the only candidate when there is only one', () => {
  const candidates = ['/a/b/file1.cob'];
  assert.strictEqual(chooseMember(candidates, '/a/b/from.cob'), '/a/b/file1.cob');
});

test('returns the first candidate when from has no directory component', () => {
  const candidates = ['file1.cob', 'file2.cob'];
  assert.strictEqual(chooseMember(candidates, 'from.cob'), 'file1.cob');
});

test('returns the first candidate when dirname(from) is empty and candidates have directories', () => {
  const candidates = ['/a/b/file1.cob', '/c/d/file2.cob'];
  assert.strictEqual(chooseMember(candidates, 'from.cob'), '/a/b/file1.cob');
});
