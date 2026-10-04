// A source line split into sequence, indicator, text and ignored columns by format (lib/cards.mjs cobolCard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cobolCard } from '../lib/cards.mjs';
import './pin-machine.mjs';

test('an unknown format returns the whole line as text', () => {
  const line = '1234567ABCDEF';
  const result = cobolCard(line, 'unknown');
  assert.deepEqual(result, {
    sequence: '',
    indicator: '',
    text: line,
    ignored: ''
  });
});

test('extracts sequence, indicator, text and ignored for fixed format', () => {
  const line = '1234567ABCDEF' + 'X'.repeat(70) + 'IGNORED';
  const result = cobolCard(line, 'fixed');
  assert.deepEqual(result, {
    sequence: '123456',
    indicator: '7',
    text: 'ABCDEF' + 'X'.repeat(59),
    ignored: 'XXXXXXXXXXXIGNORED'
  });
});

test('extracts sequence, indicator, text and ignored for variable format', () => {
  const line = '6543210' + 'VARIABL' + 'Y'.repeat(240) + 'MORE';
  const result = cobolCard(line, 'variable');
  assert.deepEqual(result, {
    sequence: '654321',
    indicator: '0',
    text: 'VARIABL' + 'Y'.repeat(236),
    ignored: 'YYYYMORE'
  });
});

test('a fixed line reads column 7 as the indicator whatever character it holds', () => {
  const line = '123456' + 'ABCDEF' + 'X'.repeat(70);
  const result = cobolCard(line, 'fixed');
  assert.deepEqual(result, {
    sequence: '123456',
    indicator: 'A',
    text: 'BCDEF' + 'X'.repeat(60),
    ignored: 'XXXXXXXXXX'
  });
});

test('handles line shorter than end boundary', () => {
  const line = '1234567ABCDEF';
  const result = cobolCard(line, 'fixed');
  assert.deepEqual(result, {
    sequence: '123456',
    indicator: '7',
    text: 'ABCDEF',
    ignored: ''
  });
});

test('returns empty ignored when line length equals end boundary', () => {
  const line = '1234567' + 'A'.repeat(65);
  const result = cobolCard(line, 'fixed');
  assert.deepEqual(result, {
    sequence: '123456',
    indicator: '7',
    text: 'A'.repeat(65),
    ignored: ''
  });
});
