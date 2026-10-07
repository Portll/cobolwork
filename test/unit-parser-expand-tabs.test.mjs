// Expands tab characters into spaces up to the next multiple of a column width (lib/parser.mjs expandTabs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandTabs } from '../lib/parser.mjs';
import './pin-machine.mjs';

test('returns the same string when there are no tab characters', () => {
  const input = 'no tabs here';
  assert.strictEqual(expandTabs(input), input);
});

test('replaces a leading tab with the default width of eight spaces', () => {
  const input = '\tstart';
  const expected = '        start';
  assert.strictEqual(expandTabs(input), expected);
});

test('replaces a tab after three characters with five spaces (default width 8)', () => {
  const input = 'abc\tdef';
  const expected = 'abc     def';
  assert.strictEqual(expandTabs(input), expected);
});

test('handles multiple tabs correctly with default width 8', () => {
  const input = 'a\tb\tc';
  const expected = 'a       b       c';
  assert.strictEqual(expandTabs(input), expected);
});

test('replaces a trailing tab with spaces to reach the next column boundary', () => {
  const input = 'abcd\t';
  const expected = 'abcd    ';
  assert.strictEqual(expandTabs(input), expected);
});

test('uses a custom width when provided', () => {
  const input = 'ab\tcd';
  const expected = 'ab  cd';
  assert.strictEqual(expandTabs(input, 4), expected);
});
