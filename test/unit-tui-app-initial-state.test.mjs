// Builds the initial TUI state object (lib/tui/app.mjs initialState).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../lib/tui/app.mjs';
import './pin-machine.mjs';

test('returns the report, default keymap ispf, default cols 80, default rows 24, empty stack with home panel, and zeroed view fields', () => {
  const report = { findings: [], summary: {} };
  const s = initialState({ report });
  assert.equal(s.report, report);
  assert.equal(s.keymap, 'ispf');
  assert.equal(s.cols, 80);
  assert.equal(s.rows, 24);
  assert.deepEqual(s.stack, [{ panel: 'home' }]);
  assert.equal(s.sel, 0);
  assert.equal(s.top, 0);
  assert.equal(s.cmd, '');
  assert.equal(s.cmdOpen, false);
  assert.equal(s.message, '');
});

test('falls back to ispf when the provided keymap is not known', () => {
  const s = initialState({ report: {}, keymap: 'nope' });
  assert.equal(s.keymap, 'ispf');
});

test('uses the provided cols and rows when given', () => {
  const s = initialState({ report: {}, cols: 120, rows: 40 });
  assert.equal(s.cols, 120);
  assert.equal(s.rows, 40);
});

test('defaults cols to 80 when cols is omitted', () => {
  const s = initialState({ report: {}, rows: 30 });
  assert.equal(s.cols, 80);
});

test('defaults rows to 24 when rows is omitted', () => {
  const s = initialState({ report: {}, cols: 100 });
  assert.equal(s.rows, 24);
});

test('stack always contains exactly one entry with panel home', () => {
  const s = initialState({ report: { findings: [1, 2, 3] }, keymap: 'ispf', cols: 80, rows: 24 });
  assert.equal(s.stack.length, 1);
  assert.equal(s.stack[0].panel, 'home');
});

test('state and stack are fresh objects each call', () => {
  const a = initialState({ report: {} });
  const b = initialState({ report: {} });
  assert.notEqual(a, b);
  assert.notEqual(a.stack, b.stack);
  assert.notEqual(a.stack[0], b.stack[0]);
});
