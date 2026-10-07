// Computes the ANSI escape sequence to update a terminal from a previous screen to a next screen (lib/tui/screen.mjs redraw).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redraw } from '../lib/tui/screen.mjs';
import './pin-machine.mjs';

test('returns clear screen when previous is null', () => {
  const next = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['', '']],
  };
  const result = redraw(null, next);
  assert.equal(result, '\x1b[2J\x1b[1;1H\x1b[0mab\x1b[0m');
});

test('returns clear screen when column counts differ', () => {
  const prev = {
    rows: 1,
    cols: 1,
    chars: [['a']],
    styles: [['']],
  };
  const next = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['', '']],
  };
  const result = redraw(prev, next);
  assert.equal(result, '\x1b[2J\x1b[1;1H\x1b[0mab\x1b[0m');
});

test('returns clear screen when row counts differ', () => {
  const prev = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['', '']],
  };
  const next = {
    rows: 2,
    cols: 2,
    chars: [['a', 'b'], ['c', 'd']],
    styles: [['', ''], ['', '']],
  };
  const result = redraw(prev, next);
  assert.equal(result, '\x1b[2J\x1b[1;1H\x1b[0mab\x1b[0m\x1b[2;1H\x1b[0mcd\x1b[0m');
});

test('returns empty string when screens are identical', () => {
  const prev = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['', '']],
  };
  const next = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['', '']],
  };
  const result = redraw(prev, next);
  assert.equal(result, '');
});

test('returns cursor move and row when one row changes', () => {
  const prev = {
    rows: 2,
    cols: 2,
    chars: [['a', 'b'], ['c', 'd']],
    styles: [['', ''], ['', '']],
  };
  const next = {
    rows: 2,
    cols: 2,
    chars: [['a', 'b'], ['x', 'y']],
    styles: [['', ''], ['', '']],
  };
  const result = redraw(prev, next);
  assert.equal(result, '\x1b[2;1H\x1b[0mxy\x1b[0m');
});

test('returns cursor moves for multiple changed rows', () => {
  const prev = {
    rows: 3,
    cols: 2,
    chars: [['a', 'b'], ['c', 'd'], ['e', 'f']],
    styles: [['', ''], ['', ''], ['', '']],
  };
  const next = {
    rows: 3,
    cols: 2,
    chars: [['x', 'y'], ['c', 'd'], ['z', 'w']],
    styles: [['', ''], ['', ''], ['', '']],
  };
  const result = redraw(prev, next);
  assert.equal(result, '\x1b[1;1H\x1b[0mxy\x1b[0m\x1b[3;1H\x1b[0mzw\x1b[0m');
});

test('emits style escape when style changes', () => {
  const prev = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['', '']],
  };
  const next = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['title', '']],
  };
  const result = redraw(prev, next);
  assert.equal(result, '\x1b[1;1H\x1b[0m\x1b[1ma\x1b[0mb\x1b[0m');
});

test('uses plain style table when color is false', () => {
  const prev = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['', '']],
  };
  const next = {
    rows: 1,
    cols: 2,
    chars: [['a', 'b']],
    styles: [['warn', '']],
  };
  const result = redraw(prev, next, { color: false });
  assert.equal(result, '\x1b[1;1H\x1b[0m\x1b[1ma\x1b[0mb\x1b[0m');
});

test('emits reset before each style change', () => {
  const prev = {
    rows: 1,
    cols: 3,
    chars: [['a', 'b', 'c']],
    styles: [['', '', '']],
  };
  const next = {
    rows: 1,
    cols: 3,
    chars: [['a', 'b', 'c']],
    styles: [['title', 'warn', '']],
  };
  const result = redraw(prev, next);
  assert.equal(result, '\x1b[1;1H\x1b[0m\x1b[1ma\x1b[0m\x1b[33mb\x1b[0mc\x1b[0m');
});
