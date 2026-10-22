// Computes the column margins for PL/I source (lib/pli/lex.mjs marginsOf).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marginsOf } from '../lib/pli/lex.mjs';
import './pin-machine.mjs';

test('returns process-option margins when *PROCESS MARGINS is present', () => {
  const src = '*PROCESS MARGINS(5,80,1)\n   DATA DIVISION.';
  assert.deepEqual(marginsOf(src), { left: 5, right: 80, carriage: 1, reason: 'process-option' });
});

test('returns process-option margins with carriage 0 when only two arguments are given', () => {
  const src = '*PROCESS MARGINS(3,72)\n   DATA DIVISION.';
  assert.deepEqual(marginsOf(src), { left: 3, right: 72, carriage: 0, reason: 'process-option' });
});

test('defaults to left 2, right 72, carriage 0 when all lines fit within 72 and start with carriage characters', () => {
  const src = '  DATA DIVISION.\n  WORKING-STORAGE SECTION.';
  assert.deepEqual(marginsOf(src), { left: 2, right: 72, carriage: 0, reason: 'default' });
});

test('defaults to left 1 when a line starts with a non-carriage character', () => {
  const src = 'A DATA DIVISION.\n  WORKING-STORAGE SECTION.';
  assert.deepEqual(marginsOf(src), { left: 1, right: 72, carriage: 0, reason: 'default' });
});

test('detects sequence-area when long lines are mostly sequence-like', () => {
  const longLine = ' '.repeat(72) + '12345678';
  const src = `${longLine}\n  DATA DIVISION.`;
  assert.deepEqual(marginsOf(src), { left: 2, right: 72, carriage: 0, reason: 'sequence-area' });
});

test('does not treat as sequence-area when sequence-like proportion is below 95 percent', () => {
  const longLine = ' '.repeat(72) + '12345678';
  const nonSeqLine = ' '.repeat(72) + 'ABCDEFGHIJ';
  const src = `${longLine}\n${nonSeqLine}\n  DATA DIVISION.`;
  assert.deepEqual(marginsOf(src), { left: 2, right: Infinity, carriage: 0, reason: 'text-beyond-72' });
});

test('sets carriage to 1 when left is 2 and a line starts with a non-space carriage character', () => {
  const src = '0 DATA DIVISION.\n  WORKING-STORAGE SECTION.';
  assert.deepEqual(marginsOf(src), { left: 2, right: 72, carriage: 1, reason: 'default' });
});

test('sets carriage to 0 when left is 1 even if a line starts with a non-space carriage character', () => {
  const src = 'A DATA DIVISION.\n  WORKING-STORAGE SECTION.';
  assert.deepEqual(marginsOf(src), { left: 1, right: 72, carriage: 0, reason: 'default' });
});
