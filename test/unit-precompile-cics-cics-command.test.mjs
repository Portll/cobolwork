// Computes the matching CICS command name from a list of option words (lib/precompile-cics.mjs cicsCommand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cicsCommand } from '../lib/precompile-cics.mjs';
import './pin-machine.mjs';

test('returns null when the options list is empty', () => {
  assert.strictEqual(cicsCommand([]), null);
});

test('returns the command name when the verb alone matches a command key', () => {
  const options = [{ word: 'SEND' }];
  assert.strictEqual(cicsCommand(options), 'SEND');
});

test('returns the command name when the verb and an identify word match the same command', () => {
  const options = [{ word: 'SEND' }, { word: 'MAP' }];
  assert.strictEqual(cicsCommand(options), 'SEND MAP');
});

test('returns the verb command even if an identify word belongs to a different command', () => {
  const options = [{ word: 'ADDRESS' }, { word: 'MAP' }];
  assert.strictEqual(cicsCommand(options), 'ADDRESS');
});

test('returns the default command when the verb matches only a non-default variant', () => {
  const options = [{ word: 'READQ' }];
  assert.strictEqual(cicsCommand(options), 'READQ TS');
});

test('returns null when the verb does not match any command key', () => {
  const options = [{ word: 'NONEXISTENTVERB' }];
  assert.strictEqual(cicsCommand(options), null);
});

test('returns null when the options contain words but no verb word', () => {
  const options = [{ word: 'SOMEWORD' }, { word: 'ANOTHER' }];
  assert.strictEqual(cicsCommand(options), null);
});
