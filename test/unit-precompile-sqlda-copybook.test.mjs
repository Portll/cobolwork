// The SQLDA copybook a program's INCLUDE SQLDA needs (lib/precompile.mjs sqldaCopybook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqldaCopybook } from '../lib/precompile.mjs';
import './pin-machine.mjs';

test('returns a string', () => {
  const result = sqldaCopybook();
  assert.equal(typeof result, 'string');
});

test('starts with the 01 SQLDA level', () => {
  const result = sqldaCopybook();
  assert.ok(result.startsWith('       01 SQLDA.'));
});

test('contains the SQLDAID field definition', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('          05 SQLDAID PIC X(8).'));
});

test('contains the SQLDABC field definition', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('          05 SQLDABC PIC S9(9) BINARY.'));
});

test('contains the SQLN and SQLD field definitions', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('          05 SQLN PIC S9(4) BINARY.'));
  assert.ok(result.includes('          05 SQLD PIC S9(4) BINARY.'));
});

test('contains the SQLVAR OCCURS clause with DEPENDING ON SQLN', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('          05 SQLVAR OCCURS 0 TO 750 TIMES DEPENDING ON SQLN.'));
});

test('contains the SQLVAR1 level 10 item', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('             10 SQLVAR1.'));
});

test('contains the SQLTYPE, SQLLEN, and FILLER REDEFINES definitions', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('                15 SQLTYPE PIC S9(4) BINARY.'));
  assert.ok(result.includes('                15 SQLLEN PIC S9(4) BINARY.'));
  assert.ok(result.includes('                15 FILLER REDEFINES SQLLEN.'));
});

test('contains the SQLPRECISION and SQLSCALE level 20 fields', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('                   20 SQLPRECISION PIC X.'));
  assert.ok(result.includes('                   20 SQLSCALE PIC X.'));
});

test('contains the SQLDATA, SQLIND, and SQLNAME definitions', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('                15 SQLDATA POINTER.'));
  assert.ok(result.includes('                15 SQLIND POINTER.'));
  assert.ok(result.includes('                15 SQLNAME.'));
});

test('contains the SQLNAMEL and SQLNAMEC level 49 fields', () => {
  const result = sqldaCopybook();
  assert.ok(result.includes('                   49 SQLNAMEL PIC S9(4) BINARY.'));
  assert.ok(result.includes('                   49 SQLNAMEC PIC X(30).'));
});

test('ends with a trailing newline', () => {
  const result = sqldaCopybook();
  assert.ok(result.endsWith('\n'));
});

test('has the exact expected full content', () => {
  const result = sqldaCopybook();
  const expected = [
    '       01 SQLDA.',
    '          05 SQLDAID PIC X(8).',
    '          05 SQLDABC PIC S9(9) BINARY.',
    '          05 SQLN PIC S9(4) BINARY.',
    '          05 SQLD PIC S9(4) BINARY.',
    '          05 SQLVAR OCCURS 0 TO 750 TIMES DEPENDING ON SQLN.',
    '             10 SQLVAR1.',
    '                15 SQLTYPE PIC S9(4) BINARY.',
    '                15 SQLLEN PIC S9(4) BINARY.',
    '                15 FILLER REDEFINES SQLLEN.',
    '                   20 SQLPRECISION PIC X.',
    '                   20 SQLSCALE PIC X.',
    '                15 SQLDATA POINTER.',
    '                15 SQLIND POINTER.',
    '                15 SQLNAME.',
    '                   49 SQLNAMEL PIC S9(4) BINARY.',
    '                   49 SQLNAMEC PIC X(30).',
    '',
  ].join('\n');
  assert.equal(result, expected);
});
