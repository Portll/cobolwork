// Decodes a buffer as UTF-8, falling back to Latin-1 if replacement characters appear (lib/pli/lex.mjs sourceText).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceText } from '../lib/pli/lex.mjs';
import './pin-machine.mjs';

test('returns ASCII text unchanged when buffer is valid UTF-8', () => {
  const buf = Buffer.from('HELLO', 'utf8');
  assert.equal(sourceText(buf), 'HELLO');
});

test('returns multi-byte UTF-8 characters correctly when valid', () => {
  const buf = Buffer.from('caf\u00e9', 'utf8');
  assert.equal(sourceText(buf), 'caf\u00e9');
});

test('falls back to Latin-1 when buffer contains invalid UTF-8 bytes', () => {
  const buf = Buffer.from([0x41, 0x42, 0x80, 0x43]);
  assert.equal(sourceText(buf), 'AB\x80C');
});

test('falls back to Latin-1 when buffer is entirely invalid UTF-8', () => {
  const buf = Buffer.from([0xff, 0xfe, 0xfd]);
  assert.equal(sourceText(buf), '\xff\xfe\xfd');
});

test('returns empty string for empty buffer', () => {
  const buf = Buffer.alloc(0);
  assert.equal(sourceText(buf), '');
});

test('handles mixed valid and invalid UTF-8 by using Latin-1', () => {
  const buf = Buffer.from([0x41, 0x42, 0x43, 0x80, 0x44, 0x45]);
  assert.equal(sourceText(buf), 'ABC\x80DE');
});

test('preserves Latin-1 special characters when falling back', () => {
  const buf = Buffer.from([0x41, 0x42, 0x43, 0x80, 0x44, 0x45]);
  assert.equal(sourceText(buf), 'ABC\x80DE');
});

test('handles buffer with only valid UTF-8 multi-byte sequences', () => {
  const buf = Buffer.from('\u65e5\u672c\u8a9e', 'utf8');
  assert.equal(sourceText(buf), '\u65e5\u672c\u8a9e');
});
