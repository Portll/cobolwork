// Records an MVS 3.8 form on a node or throws when the option is off (lib/hlasm/mvs38.mjs mvs38Form).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mvs38Form } from '../lib/hlasm/mvs38.mjs';
import './pin-machine.mjs';

test('throws when opts.mvs38 is false', () => {
  const node = {};
  assert.throws(() => mvs38Form({ mvs38: false }, node, 'MACRO', 'FORM'), /MACRO: FORM is an MVS 3.8 form/);
  assert.equal(node.mvs38, undefined);
});

test('pushes form when opts is undefined', () => {
  const node = {};
  mvs38Form(undefined, node, 'MACRO', 'FORM');
  assert.deepEqual(node.mvs38, ['FORM']);
});

test('pushes form when opts is null', () => {
  const node = {};
  mvs38Form(null, node, 'MACRO', 'FORM');
  assert.deepEqual(node.mvs38, ['FORM']);
});

test('pushes form when opts is empty object', () => {
  const node = {};
  mvs38Form({}, node, 'MACRO', 'FORM');
  assert.deepEqual(node.mvs38, ['FORM']);
});

test('pushes form when opts.mvs38 is true', () => {
  const node = {};
  mvs38Form({ mvs38: true }, node, 'MACRO', 'FORM');
  assert.deepEqual(node.mvs38, ['FORM']);
});

test('pushes form when opts.mvs38 is 0', () => {
  const node = {};
  mvs38Form({ mvs38: 0 }, node, 'MACRO', 'FORM');
  assert.deepEqual(node.mvs38, ['FORM']);
});

test('pushes form when opts.mvs38 is empty string', () => {
  const node = {};
  mvs38Form({ mvs38: '' }, node, 'MACRO', 'FORM');
  assert.deepEqual(node.mvs38, ['FORM']);
});

test('appends to existing mvs38 array', () => {
  const node = { mvs38: ['EXISTING'] };
  mvs38Form({}, node, 'MACRO', 'NEW');
  assert.deepEqual(node.mvs38, ['EXISTING', 'NEW']);
});

test('appends multiple forms sequentially', () => {
  const node = {};
  mvs38Form({}, node, 'MACRO', 'A');
  mvs38Form({}, node, 'MACRO', 'B');
  mvs38Form({}, node, 'MACRO', 'C');
  assert.deepEqual(node.mvs38, ['A', 'B', 'C']);
});

test('throws with correct message format for specific macro and form', () => {
  const node = {};
  assert.throws(() => mvs38Form({ mvs38: false }, node, 'MYMACRO', 'MYFORM'), /MYMACRO: MYFORM is an MVS 3.8 form/);
});
