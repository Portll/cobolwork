// Creates a screen object with cols, rows, and 2D arrays of spaces and empty strings (lib/tui/screen.mjs createScreen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScreen } from '../lib/tui/screen.mjs';
import './pin-machine.mjs';

test('returns an object with cols and rows matching the arguments', () => {
  const screen = createScreen(5, 3);
  assert.equal(screen.cols, 5);
  assert.equal(screen.rows, 3);
});

test('creates a chars array with length equal to rows', () => {
  const screen = createScreen(4, 2);
  assert.equal(screen.chars.length, 2);
});

test('creates a styles array with length equal to rows', () => {
  const screen = createScreen(4, 2);
  assert.equal(screen.styles.length, 2);
});

test('each row in chars is an array of length cols filled with spaces', () => {
  const screen = createScreen(3, 2);
  assert.equal(screen.chars[0].length, 3);
  assert.equal(screen.chars[1].length, 3);
  assert.deepEqual(screen.chars[0], [' ', ' ', ' ']);
  assert.deepEqual(screen.chars[1], [' ', ' ', ' ']);
});

test('each row in styles is an array of length cols filled with empty strings', () => {
  const screen = createScreen(3, 2);
  assert.equal(screen.styles[0].length, 3);
  assert.equal(screen.styles[1].length, 3);
  assert.deepEqual(screen.styles[0], ['', '', '']);
  assert.deepEqual(screen.styles[1], ['', '', '']);
});

test('handles zero columns by creating empty rows', () => {
  const screen = createScreen(0, 2);
  assert.equal(screen.cols, 0);
  assert.equal(screen.rows, 2);
  assert.equal(screen.chars.length, 2);
  assert.equal(screen.styles.length, 2);
  assert.deepEqual(screen.chars[0], []);
  assert.deepEqual(screen.styles[0], []);
});

test('handles zero rows by creating empty arrays', () => {
  const screen = createScreen(3, 0);
  assert.equal(screen.cols, 3);
  assert.equal(screen.rows, 0);
  assert.equal(screen.chars.length, 0);
  assert.equal(screen.styles.length, 0);
});

test('handles one column and one row', () => {
  const screen = createScreen(1, 1);
  assert.equal(screen.cols, 1);
  assert.equal(screen.rows, 1);
  assert.deepEqual(screen.chars, [[' ']]);
  assert.deepEqual(screen.styles, [['']]);
});
