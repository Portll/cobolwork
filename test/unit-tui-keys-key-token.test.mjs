// Maps readline keypress arguments to a canonical token string (lib/tui/keys.mjs keyToken).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyToken } from '../lib/tui/keys.mjs';
import './pin-machine.mjs';

test('returns C-c for ctrl c', () => {
  assert.equal(keyToken('', { ctrl: true, name: 'c' }), 'C-c');
});

test('returns F1 for f1', () => {
  assert.equal(keyToken('', { name: 'f1' }), 'F1');
});

test('returns F12 for f12', () => {
  assert.equal(keyToken('', { name: 'f12' }), 'F12');
});

test('returns null for f13', () => {
  assert.equal(keyToken('', { name: 'f13' }), null);
});

test('returns Up for up', () => {
  assert.equal(keyToken('', { name: 'up' }), 'Up');
});

test('returns null for ctrl up', () => {
  assert.equal(keyToken('', { ctrl: true, name: 'up' }), null);
});

test('returns char:a for a', () => {
  assert.equal(keyToken('a', {}), 'char:a');
});

test('returns "char: " for a space', () => {
  assert.equal(keyToken(' ', {}), 'char: ');
});

test('returns null for empty string', () => {
  assert.equal(keyToken('', {}), null);
});
