// Storage bytes of a COBOL literal (lib/layout.mjs literalBytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { literalBytes } from '../lib/layout.mjs';
import './pin-machine.mjs';

test('hex literal with prefix X uses one byte per two digits', () => {
  assert.equal(literalBytes({ prefix: 'X', v: 'AB12' }), 2);
});

test('hex literal with prefix BX uses one byte per two digits', () => {
  assert.equal(literalBytes({ prefix: 'BX', v: 'AB12' }), 2);
});

test('hex literal with odd length truncates to floor of half', () => {
  assert.equal(literalBytes({ prefix: 'X', v: 'ABC' }), 1);
});

test('national hex literal with prefix NX uses one byte per two digits', () => {
  assert.equal(literalBytes({ prefix: 'NX', v: 'AB12' }), 2);
});

test('national hex literal with odd length truncates to floor of half', () => {
  assert.equal(literalBytes({ prefix: 'NX', v: 'ABC' }), 0);
});

test('Z literal adds one byte for terminating null', () => {
  assert.equal(literalBytes({ prefix: 'Z', v: 'HELLO' }), 6);
});

test('national literal with prefix N uses two bytes per character', () => {
  assert.equal(literalBytes({ prefix: 'N', v: 'HELLO' }), 10);
});

test('national character literal with prefix NC uses two bytes per character', () => {
  assert.equal(literalBytes({ prefix: 'NC', v: 'HELLO' }), 10);
});

test('unsigned literal with prefix U uses two bytes per character', () => {
  assert.equal(literalBytes({ prefix: 'U', v: 'HELLO' }), 10);
});

test('literal without recognized prefix uses one byte per character', () => {
  assert.equal(literalBytes({ v: 'HELLO' }), 5);
});
