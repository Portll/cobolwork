// Computes the next TUI state and effects for a key or resize event (lib/tui/app.mjs update).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { update } from '../lib/tui/app.mjs';
import './pin-machine.mjs';

test('resize event updates cols and rows', () => {
  const state = { cols: 80, rows: 24, keymap: 'modern', cmd: '', cmdOpen: false, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'resize', cols: 100, rows: 30 });
  assert.deepEqual(out, { state: { ...state, cols: 100, rows: 30 }, effects: [] });
});

test('non-key non-resize event returns state unchanged', () => {
  const state = { cols: 80, rows: 24, keymap: 'modern', cmd: 'x', cmdOpen: false, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'other' });
  assert.deepEqual(out, { state, effects: [] });
});

test('ispf keymap appends char to cmd', () => {
  const state = { cols: 80, rows: 24, keymap: 'ispf', cmd: 'F', cmdOpen: true, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'char:I' });
  assert.deepEqual(out, { state: { ...state, cmd: 'FI', message: '' }, effects: [] });
});

test('ispf keymap backspace removes last char from cmd', () => {
  const state = { cols: 80, rows: 24, keymap: 'ispf', cmd: 'FI', cmdOpen: true, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'Backspace' });
  assert.deepEqual(out, { state: { ...state, cmd: 'F', message: '' }, effects: [] });
});

test('ispf keymap enter with empty cmd closes command line', () => {
  const state = { cols: 80, rows: 24, keymap: 'ispf', cmd: '  ', cmdOpen: true, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'Enter' });
  assert.deepEqual(out, { state: { ...state, cmd: '', cmdOpen: false, message: '' }, effects: [] });
});

test('ispf keymap escape closes command line', () => {
  const state = { cols: 80, rows: 24, keymap: 'ispf', cmd: 'abc', cmdOpen: true, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'Escape' });
  assert.deepEqual(out, { state: { ...state, cmd: '', cmdOpen: false, message: '' }, effects: [] });
});

test('modern keymap without cmdOpen ignores char token', () => {
  const state = { cols: 80, rows: 24, keymap: 'modern', cmd: '', cmdOpen: false, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'char:a' });
  assert.deepEqual(out, { state: { ...state, message: '' }, effects: [] });
});

test('modern keymap with cmdOpen appends char to cmd', () => {
  const state = { cols: 80, rows: 24, keymap: 'modern', cmd: 'F', cmdOpen: true, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'char:I' });
  assert.deepEqual(out, { state: { ...state, cmd: 'FI', message: '' }, effects: [] });
});

test('modern keymap with cmdOpen backspace removes last char', () => {
  const state = { cols: 80, rows: 24, keymap: 'modern', cmd: 'FI', cmdOpen: true, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'Backspace' });
  assert.deepEqual(out, { state: { ...state, cmd: 'F', message: '' }, effects: [] });
});

test('modern keymap with cmdOpen enter with non-empty cmd executes command', () => {
  const state = { cols: 80, rows: 24, keymap: 'modern', cmd: 'HELP', cmdOpen: true, sel: 0, top: 0, stack: [{ panel: 'home' }], message: '', view: {} };
  const out = update(state, { type: 'key', token: 'Enter' });
  assert.equal(out.state.stack.length, 2);
  assert.equal(out.state.stack[1].panel, 'help');
  assert.equal(out.state.cmd, '');
  assert.equal(out.state.cmdOpen, false);
});
