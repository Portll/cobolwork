// A statement card split into text through column 72 and the sequence after it (lib/cards.mjs statementCard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementCard } from '../lib/cards.mjs';
import './pin-machine.mjs';

test('a line shorter than 72 columns is all text', () => {
  const line = 'ABC';
  const result = statementCard(line);
  assert.deepEqual(result, { text: 'ABC', sequence: '' });
});

test('a line of exactly 72 columns has no sequence', () => {
  const line = 'a'.repeat(72);
  const result = statementCard(line);
  assert.deepEqual(result, { text: 'a'.repeat(72), sequence: '' });
});

test('column 73 starts the sequence', () => {
  const line = 'a'.repeat(72) + 'b';
  const result = statementCard(line);
  assert.deepEqual(result, { text: 'a'.repeat(72), sequence: 'b' });
});

test('everything past column 72 is sequence, however long', () => {
  const line = 'x'.repeat(100);
  const result = statementCard(line);
  assert.deepEqual(result, { text: 'x'.repeat(72), sequence: 'x'.repeat(28) });
});

test('an empty line gives empty text and sequence', () => {
  const line = '';
  const result = statementCard(line);
  assert.deepEqual(result, { text: '', sequence: '' });
});


