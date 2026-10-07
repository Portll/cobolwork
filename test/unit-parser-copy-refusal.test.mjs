// Determines whether a COPY name is allowed based on path and context (lib/parser.mjs copyRefusal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyRefusal } from '../lib/parser.mjs';
import './pin-machine.mjs';

test('refuses an absolute copy name when allowAbsoluteCopy is false', () => {
  const result = copyRefusal('/etc/hosts', { allowAbsoluteCopy: false });
  assert.strictEqual(result, 'refused-absolute');
});

test('allows an absolute copy name when allowAbsoluteCopy is true', () => {
  const result = copyRefusal('/etc/hosts', { allowAbsoluteCopy: true });
  assert.strictEqual(result, null);
});

test('refuses an absolute copy name when allowAbsoluteCopy is omitted', () => {
  const result = copyRefusal('/etc/hosts', {});
  assert.strictEqual(result, 'refused-absolute');
});

test('returns null when no fileIndex or mainDir is provided', () => {
  const result = copyRefusal('foo.cpy', {});
  assert.strictEqual(result, null);
});

test('allows a relative copy that stays inside the tree', () => {
  const ctx = { fileIndex: { root: '/project' }, mainDir: '/project/src' };
  const result = copyRefusal('subdir/book.cpy', ctx);
  assert.strictEqual(result, null);
});

test('allows a relative copy that resolves exactly to the tree root', () => {
  const ctx = { fileIndex: { root: '/project' }, mainDir: '/project/src' };
  const result = copyRefusal('..', ctx);
  assert.strictEqual(result, null);
});

test('allows a relative copy that resolves to a sibling inside the tree', () => {
  const ctx = { fileIndex: { root: '/project' }, mainDir: '/project/src' };
  const result = copyRefusal('../copybooks/book.cpy', ctx);
  assert.strictEqual(result, null);
});

test('refuses a relative copy that climbs outside the tree', () => {
  const ctx = { fileIndex: { root: '/project' }, mainDir: '/project/src' };
  const result = copyRefusal('../../outside.cpy', ctx);
  assert.strictEqual(result, 'refused-outside');
});

test('refuses a relative copy that is an absolute path outside the tree', () => {
  const ctx = { fileIndex: { root: '/project' }, mainDir: '/project/src' };
  const result = copyRefusal('/project2/file.cpy', ctx);
  assert.strictEqual(result, 'refused-absolute');
});
