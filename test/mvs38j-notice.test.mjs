// The MVS 3.8j admission screen: which member text counts as carrying an IBM notice (diag/mvs38j-notice.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeIn } from '../diag/mvs38j-notice.mjs';
import './pin-machine.mjs';

const card = (text, sequence = '00010000') => text.padEnd(72) + sequence;

test('a property notice is a notice', () => {
  assert.match(noticeIn('* THIS MODULE IS THE PROPERTY OF IBM\nA  CSECT\n'), /PROPERTY OF IBM/);
});

test('a notice broken across comment cards still matches', () => {
  const text = [card('*   LICENSED MATERIALS -'), card('*   PROGRAM PROPERTY OF SOMEONE')].join('\n');
  assert.match(noticeIn(text), /LICENSED MATERIALS - PROGRAM PROPERTY/);
});

test('a program number beside a rights word is a notice', () => {
  assert.ok(noticeIn('*  5740-XYN COPYRIGHT\n'));
});

test('COPYRIGHT = NONE is not a notice', () => {
  assert.equal(noticeIn('*  COPYRIGHT = NONE\nA  CSECT\n   USING *,15\n'), null);
});

test('a program number alone is not a notice', () => {
  assert.equal(noticeIn('*  COMPONENT 5752-SC1B3\nA  CSECT\n'), null);
});

test('a sequence column is not read as text', () => {
  const text = '*'.padEnd(69) + '(C)';
  assert.equal(noticeIn(card(text, 'IBM')), null);
  assert.ok(noticeIn(text + 'IBM CORP'));
});
