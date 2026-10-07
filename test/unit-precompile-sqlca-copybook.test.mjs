// SQLCA copybook string for Db2 for z/OS (lib/precompile.mjs sqlcaCopybook).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlcaCopybook } from '../lib/precompile.mjs';
import './pin-machine.mjs';

test('sqlcaCopybook returns the exact expected string', () => {
  const expected = [
    '       01 SQLCA.',
    '          05 SQLCAID PIC X(8).',
    '          05 SQLCABC PIC S9(9) COMP-5.',
    '          05 SQLCODE PIC S9(9) COMP-5.',
    '          05 SQLCADE REDEFINES SQLCODE PIC S9(9) COMP-5.',
    '          05 SQLERRM.',
    '             49 SQLERRML PIC S9(4) COMP-5.',
    '             49 SQLERRMC PIC X(70).',
    '          05 SQLERRP PIC X(8).',
    '          05 SQLERRD PIC S9(9) COMP-5 OCCURS 6.',
    '          05 SQLWARN.',
    '             10 SQLWARN0 PIC X.',
    '             10 SQLWARN1 PIC X.',
    '             10 SQLWARN2 PIC X.',
    '             10 SQLWARN3 PIC X.',
    '             10 SQLWARN4 PIC X.',
    '             10 SQLWARN5 PIC X.',
    '             10 SQLWARN6 PIC X.',
    '             10 SQLWARN7 PIC X.',
    '          05 SQLEXT.',
    '             10 SQLWARN8 PIC X.',
    '             10 SQLWARN9 PIC X.',
    '             10 SQLWARNA PIC X.',
    '             10 SQLSTATE PIC X(5).',
    '             10 SQLSTAT REDEFINES SQLSTATE PIC X(5).',
    '',
  ].join('\n');
  assert.strictEqual(sqlcaCopybook(), expected);
});

test('sqlcaCopybook defines SQLCAID as PIC X(8)', () => {
  const result = sqlcaCopybook();
  assert.match(result, /^       01 SQLCA\.\n          05 SQLCAID PIC X\(8\)\./);
});

test('sqlcaCopybook defines SQLCABC as PIC S9(9) COMP-5', () => {
  const result = sqlcaCopybook();
  assert.match(result, /\n          05 SQLCABC PIC S9\(9\) COMP-5\./);
});

test('sqlcaCopybook defines SQLCADE redefining SQLCODE as PIC S9(9) COMP-5', () => {
  const result = sqlcaCopybook();
  assert.match(result, /\n          05 SQLCADE REDEFINES SQLCODE PIC S9\(9\) COMP-5\./);
});

test('sqlcaCopybook defines SQLERRP as PIC X(8)', () => {
  const result = sqlcaCopybook();
  assert.match(result, /\n          05 SQLERRP PIC X\(8\)\./);
});

test('sqlcaCopybook defines SQLERRD as PIC S9(9) COMP-5 OCCURS 6', () => {
  const result = sqlcaCopybook();
  assert.match(result, /\n          05 SQLERRD PIC S9\(9\) COMP-5 OCCURS 6\./);
});

test('sqlcaCopybook has 26 lines', () => {
  const result = sqlcaCopybook();
  const lines = result.split('\n');
  assert.strictEqual(lines.length, 26);
});
