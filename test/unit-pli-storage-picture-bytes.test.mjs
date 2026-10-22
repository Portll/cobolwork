// Bytes a PICTURE occupies (lib/pli/storage.mjs pictureBytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pictureBytes } from '../lib/pli/storage.mjs';
import './pin-machine.mjs';

test('simple picture with a V separator', () => {
  assert.strictEqual(pictureBytes('9(3)V99'), 3);
});

test('picture containing CR and DB two character codes', () => {
  assert.strictEqual(pictureBytes('9CR9DB'), 6);
});

test('repetition factor multiplies a single character', () => {
  assert.strictEqual(pictureBytes('9(5)9'), 6);
});

test('F scaling factor is ignored before counting bytes', () => {
  assert.strictEqual(pictureBytes('9(2)F(3)9'), 3);
});

test('V and K characters contribute zero bytes', () => {
  assert.strictEqual(pictureBytes('V'), 0);
  assert.strictEqual(pictureBytes('K'), 0);
  assert.strictEqual(pictureBytes('9V9'), 2);
});

test('repetition of a two character code (CR) counts twice per repetition', () => {
  assert.strictEqual(pictureBytes('9(2)CR'), 5);
});

test('complex picture with multiple repetitions, CR, DB, V and single digits', () => {
  assert.strictEqual(pictureBytes('9(2)CR9(3)DBV9'), 13);
});
