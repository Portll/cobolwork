// Sniffs each path's kind from the bytes a held tree holds, once per path (lib/sources.mjs heldClassifier).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldClassifier } from '../lib/sources.mjs';
import './pin-machine.mjs';

test('returns null for a non-source file name and never calls bytesOf', () => {
  const called = { value: false };
  const bytesOf = (p) => { called.value = true; throw new Error('should not be called'); };
  const classifier = heldClassifier(bytesOf);
  const result = classifier('README');
  assert.strictEqual(result, null);
  assert.strictEqual(called.value, false);
});

test('classifies a JCL file by detecting JOB in the first 4096 bytes', () => {
  const bytesOf = () => Buffer.from('// JOB ABC\n', 'latin1');
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('script.jcl'), 'jcl');
});

test('classifies a COBOL program by detecting IDENTIFICATION DIVISION', () => {
  const bytesOf = () => Buffer.from('IDENTIFICATION DIVISION.\n', 'latin1');
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('prog.cob'), 'program');
});

test('classifies a copybook by detecting level numbers and picture clauses', () => {
  const bytesOf = () => Buffer.from('  01 MY-RECORD PIC X.\n', 'latin1');
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('copybook.cpy'), 'copybook');
});

test('classifies a BMS map by detecting a line starting with DFHMSD', () => {
  const bytesOf = () => Buffer.from('   DFHMSD  MAPSET\n', 'latin1');
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('map.bms'), 'bms');
});

test('classifies a HLASM file by detecting both a section and a storage directive', () => {
  const bytesOf = () => Buffer.from('  CSECT\n  USING R0\n', 'latin1');
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('code.asm'), 'hlasm');
});

test('returns null for a binary file containing a NUL byte', () => {
  const bytesOf = () => Buffer.from([0x00, 0x01, 0x02]);
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('binary.bin'), null);
});

test('returns null for a file that does not match any pattern', () => {
  const bytesOf = () => Buffer.from('Hello, world!\n', 'latin1');
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('plain.txt'), null);
});

test('caches the result so subsequent calls return the same value without re-reading', () => {
  let readCount = 0;
  const bytesOf = () => { readCount++; return Buffer.from('IDENTIFICATION DIVISION.\n', 'latin1'); };
  const classifier = heldClassifier(bytesOf);
  assert.strictEqual(classifier('prog.cob'), 'program');
  assert.strictEqual(classifier('prog.cob'), 'program');
  assert.strictEqual(readCount, 1);
});
