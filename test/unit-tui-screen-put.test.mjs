// Writes a string to a screen buffer at a given position (lib/tui/screen.mjs put).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { put } from '../lib/tui/screen.mjs';
import './pin-machine.mjs';

test('writes text to the screen at the specified row and column', () => {
  const screen = {
    rows: 3,
    cols: 5,
    chars: [
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
    ],
    styles: [
      ['', '', '', '', ''],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
  };
  put(screen, 1, 1, 'hi');
  assert.deepEqual(screen.chars[1], [' ', 'h', 'i', ' ', ' ']);
  assert.deepEqual(screen.styles[1], ['', '', '', '', '']);
});

test('ignores writes when row is negative', () => {
  const screen = {
    rows: 3,
    cols: 5,
    chars: [
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
    ],
    styles: [
      ['', '', '', '', ''],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
  };
  put(screen, -1, 0, 'x');
  assert.deepEqual(screen.chars, [
    [' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' '],
  ]);
});

test('ignores writes when row is beyond the screen height', () => {
  const screen = {
    rows: 3,
    cols: 5,
    chars: [
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
    ],
    styles: [
      ['', '', '', '', ''],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
  };
  put(screen, 3, 0, 'x');
  assert.deepEqual(screen.chars, [
    [' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' '],
    [' ', ' ', ' ', ' ', ' '],
  ]);
});

test('skips characters that would land in negative columns', () => {
  const screen = {
    rows: 3,
    cols: 5,
    chars: [
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
    ],
    styles: [
      ['', '', '', '', ''],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
  };
  put(screen, 0, -1, 'ab');
  assert.deepEqual(screen.chars[0], ['b', ' ', ' ', ' ', ' ']);
  assert.deepEqual(screen.styles[0], ['', '', '', '', '']);
});

test('stops writing when reaching the right edge of the screen', () => {
  const screen = {
    rows: 3,
    cols: 5,
    chars: [
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
    ],
    styles: [
      ['', '', '', '', ''],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
  };
  put(screen, 0, 3, 'abc');
  assert.deepEqual(screen.chars[0], [' ', ' ', ' ', 'a', 'b']);
  assert.deepEqual(screen.styles[0], ['', '', '', '', '']);
});

test('applies the given style to each written character', () => {
  const screen = {
    rows: 3,
    cols: 5,
    chars: [
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
    ],
    styles: [
      ['', '', '', '', ''],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
  };
  put(screen, 2, 0, 'ab', 'red');
  assert.deepEqual(screen.chars[2], ['a', 'b', ' ', ' ', ' ']);
  assert.deepEqual(screen.styles[2], ['red', 'red', '', '', '']);
});

test('uses empty string as default style when none is provided', () => {
  const screen = {
    rows: 3,
    cols: 5,
    chars: [
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
      [' ', ' ', ' ', ' ', ' '],
    ],
    styles: [
      ['', '', '', '', ''],
      ['', '', '', '', ''],
      ['', '', '', '', ''],
    ],
  };
  put(screen, 0, 0, 'x');
  assert.deepEqual(screen.chars[0], ['x', ' ', ' ', ' ', ' ']);
  assert.deepEqual(screen.styles[0], ['', '', '', '', '']);
});
