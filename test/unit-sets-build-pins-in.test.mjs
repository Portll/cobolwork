// Extracts product version pins from build text (lib/sets/build.mjs pinsIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinsIn } from '../lib/sets/build.mjs';
import './pin-machine.mjs';

test('returns empty array for text with no pins', () => {
  assert.deepEqual(pinsIn('hello world'), []);
});

test('detects gnucobol version assignment', () => {
  const result = pinsIn('gnucobol-version: 3.2');
  assert.equal(result.length, 1);
  assert.equal(result[0].product, 'gnucobol');
  assert.equal(result[0].version, '3.2');
  assert.equal(result[0].text, 'gnucobol-version: 3.2');
});

test('detects gnucobol tarball filename', () => {
  const result = pinsIn('gnucobol-3.2.tar.gz');
  assert.equal(result.length, 1);
  assert.equal(result[0].product, 'gnucobol');
  assert.equal(result[0].version, '3.2');
  assert.equal(result[0].text, 'gnucobol-3.2.');
});

test('detects opentext visual cobol version', () => {
  const result = pinsIn('visual-cobol: 8.6');
  assert.equal(result.length, 1);
  assert.equal(result[0].product, 'opentext-cobol');
  assert.equal(result[0].version, '8.6');
  assert.equal(result[0].text, 'visual-cobol: 8.6');
});

test('detects zowe cli version in package.json style', () => {
  const result = pinsIn('"@zowe/cli": "^7.18.0"');
  assert.equal(result.length, 1);
  assert.equal(result[0].product, 'zowe');
  assert.equal(result[0].version, '7.18.0');
  assert.equal(result[0].text, '"@zowe/cli": "^7.18.0');
});

test('detects cics transaction gateway jar', () => {
  const result = pinsIn('ctgclient-1.2.3.jar');
  assert.equal(result.length, 1);
  assert.equal(result[0].product, 'cics-transaction-gateway');
  assert.equal(result[0].version, '1.2.3');
  assert.equal(result[0].text, 'ctgclient-1.2.3.jar');
});

test('deduplicates same product and version from multiple patterns', () => {
  const result = pinsIn('gnucobol-version: 3.2\ngnucobol-3.2.tar.gz');
  assert.equal(result.length, 1);
  assert.equal(result[0].product, 'gnucobol');
  assert.equal(result[0].version, '3.2');
});

test('detects multiple different products in one text', () => {
  const result = pinsIn('gnucobol-version: 3.2\nvisual-cobol: 8.6');
  assert.equal(result.length, 2);
  assert.equal(result[0].product, 'gnucobol');
  assert.equal(result[0].version, '3.2');
  assert.equal(result[1].product, 'opentext-cobol');
  assert.equal(result[1].version, '8.6');
});
