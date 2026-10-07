// Decodes a source byte buffer to text and reports its encoding: EBCDIC, UTF-8 or latin1 (lib/sources.mjs decodeSource).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSource } from '../lib/sources.mjs';
import './pin-machine.mjs';

test('decodes EBCDIC buffer with newlines to text and marks encoding ebcdic', () => {
  const buf = Buffer.alloc(16, 0xC1);
  buf[7] = 0x15;
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'ebcdic');
  assert.equal(result.text, 'AAAAAAA\nAAAAAAAA');
});

test('decodes EBCDIC buffer without newlines and length multiple of 80 into 80-char lines', () => {
  const buf = Buffer.alloc(160, 0x40);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'ebcdic');
  assert.equal(result.text, ' '.repeat(80) + '\n' + ' '.repeat(80));
});

test('decodes EBCDIC buffer without newlines and length not multiple of 80 as continuous text', () => {
  const buf = Buffer.alloc(16, 0xC1);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'ebcdic');
  assert.equal(result.text, 'AAAAAAAAAAAAAAAA');
});

test('decodes ASCII buffer as latin1 and marks encoding latin1', () => {
  const buf = Buffer.from([0x41, 0x42, 0x43]);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'latin1');
  assert.equal(result.text, 'ABC');
});

test('returns latin1 encoding for buffer containing NUL byte', () => {
  const buf = Buffer.from([0x41, 0x00, 0x42]);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'latin1');
  assert.equal(result.text, 'A\x00B');
});

test('returns latin1 encoding for buffer shorter than 16 bytes', () => {
  const buf = Buffer.from([0xC1, 0xC2, 0xC3]);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'latin1');
  assert.equal(result.text, '\u00C1\u00C2\u00C3');
});

test('returns latin1 encoding for empty buffer', () => {
  const buf = Buffer.alloc(0);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'latin1');
  assert.equal(result.text, '');
});

test('detects EBCDIC when EBCDIC ratio exceeds 0.6 and ASCII ratio below 0.25', () => {
  const buf = Buffer.alloc(16, 0xC1);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'ebcdic');
  assert.equal(result.text, 'AAAAAAAAAAAAAAAA');
});

test('returns latin1 when ASCII ratio is at or above 0.25 boundary', () => {
  const buf = Buffer.alloc(16, 0x41);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'latin1');
  assert.equal(result.text, 'AAAAAAAAAAAAAAAA');
});

test('returns latin1 when EBCDIC ratio is at or below 0.6 boundary', () => {
  const buf = Buffer.alloc(16, 0x20);
  const result = decodeSource(buf);
  assert.equal(result.encoding, 'latin1');
  assert.equal(result.text, '                ');
});
