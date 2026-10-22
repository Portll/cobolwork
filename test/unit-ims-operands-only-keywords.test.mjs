// Validates that all operands are allowed keywords for a macro (lib/ims/operands.mjs onlyKeywords).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onlyKeywords } from '../lib/ims/operands.mjs';
import './pin-machine.mjs';

test('accepts empty operands', () => {
  const ops = { positional: [], keywords: new Map() };
  assert.doesNotThrow(() => onlyKeywords(ops, 'MACRO', ['KEY1']));
});

test('accepts single allowed keyword', () => {
  const ops = { positional: [], keywords: new Map([['KEY1', 'val']]) };
  assert.doesNotThrow(() => onlyKeywords(ops, 'MACRO', ['KEY1', 'KEY2']));
});

test('accepts multiple allowed keywords', () => {
  const ops = { positional: [], keywords: new Map([['KEY1', 'v1'], ['KEY2', 'v2']]) };
  assert.doesNotThrow(() => onlyKeywords(ops, 'MACRO', ['KEY1', 'KEY2']));
});

test('rejects single positional operand', () => {
  const ops = { positional: ['POS1'], keywords: new Map() };
  assert.throws(() => onlyKeywords(ops, 'MACRO', ['KEY1']), /MACRO takes no positional operand: POS1/);
});

test('rejects multiple positional operands', () => {
  const ops = { positional: ['POS1', 'POS2'], keywords: new Map() };
  assert.throws(() => onlyKeywords(ops, 'MACRO', ['KEY1']), /MACRO takes no positional operand: POS1/);
});

test('rejects single disallowed keyword', () => {
  const ops = { positional: [], keywords: new Map([['BAD', 'val']]) };
  assert.throws(() => onlyKeywords(ops, 'MACRO', ['KEY1', 'KEY2']), /MACRO has no BAD operand/);
});

test('rejects multiple keywords with one disallowed', () => {
  const ops = { positional: [], keywords: new Map([['KEY1', 'v1'], ['BAD', 'v2']]) };
  assert.throws(() => onlyKeywords(ops, 'MACRO', ['KEY1', 'KEY2']), /MACRO has no BAD operand/);
});

test('rejects positional even when keywords are valid', () => {
  const ops = { positional: ['POS1'], keywords: new Map([['KEY1', 'val']]) };
  assert.throws(() => onlyKeywords(ops, 'MACRO', ['KEY1']), /MACRO takes no positional operand: POS1/);
});
