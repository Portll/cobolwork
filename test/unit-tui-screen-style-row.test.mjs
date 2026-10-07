// Fills a row's style array with the given style if the row is in bounds (lib/tui/screen.mjs styleRow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { styleRow } from '../lib/tui/screen.mjs';
import './pin-machine.mjs';

test('fills the style array of a valid row with the provided style', () => {
  const screen = { rows: 3, styles: [new Array(10).fill(0), new Array(10).fill(0), new Array(10).fill(0)] };
  styleRow(screen, 1, 42);
  assert.deepEqual(screen.styles[1], new Array(10).fill(42));
});

test('does nothing when row is negative', () => {
  const screen = { rows: 3, styles: [new Array(10).fill(0), new Array(10).fill(0), new Array(10).fill(0)] };
  styleRow(screen, -1, 42);
  assert.deepEqual(screen.styles[0], new Array(10).fill(0));
});

test('does nothing when row equals screen.rows', () => {
  const screen = { rows: 3, styles: [new Array(10).fill(0), new Array(10).fill(0), new Array(10).fill(0)] };
  styleRow(screen, 3, 42);
  assert.deepEqual(screen.styles[2], new Array(10).fill(0));
});

test('does nothing when row is greater than screen.rows', () => {
  const screen = { rows: 3, styles: [new Array(10).fill(0), new Array(10).fill(0), new Array(10).fill(0)] };
  styleRow(screen, 5, 42);
  assert.deepEqual(screen.styles[2], new Array(10).fill(0));
});

test('fills row 0 when it is the first valid row', () => {
  const screen = { rows: 2, styles: [new Array(5).fill(1), new Array(5).fill(1)] };
  styleRow(screen, 0, 99);
  assert.deepEqual(screen.styles[0], new Array(5).fill(99));
});

test('fills the last valid row when row is screen.rows minus one', () => {
  const screen = { rows: 2, styles: [new Array(5).fill(1), new Array(5).fill(1)] };
  styleRow(screen, 1, 77);
  assert.deepEqual(screen.styles[1], new Array(5).fill(77));
});
