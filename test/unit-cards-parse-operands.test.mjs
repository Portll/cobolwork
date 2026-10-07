// Splits a card's operand field into positional operands and KEY=VALUE keyword operands (lib/cards.mjs parseOperands).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOperands } from '../lib/cards.mjs';
import './pin-machine.mjs';

test('empty field yields no positional or keyword arguments', () => {
  assert.deepEqual(parseOperands(''), { positional: [], keywords: new Map() });
});

test('single positional operand is returned as-is', () => {
  assert.deepEqual(parseOperands('FOO'), { positional: ['FOO'], keywords: new Map() });
});

test('multiple positional operands are collected in order', () => {
  assert.deepEqual(parseOperands('A,B,C'), { positional: ['A', 'B', 'C'], keywords: new Map() });
});

test('keyword argument is stored with uppercased key and original value', () => {
  assert.deepEqual(parseOperands('KEY=VALUE'), { positional: [], keywords: new Map([['KEY', 'VALUE']]) });
});

test('positional operands before first keyword are kept separate from keywords', () => {
  assert.deepEqual(parseOperands('PROC,KEY=VAL'), { positional: ['PROC'], keywords: new Map([['KEY', 'VAL']]) });
});

test('comma inside parentheses does not split the operand', () => {
  assert.deepEqual(parseOperands('DISP=(NEW,CATLG,DELETE)'), { positional: [], keywords: new Map([['DISP', '(NEW,CATLG,DELETE)']]) });
});

test('keyword with value containing nested parentheses and equals signs is parsed correctly', () => {
  assert.deepEqual(parseOperands('DCB=(RECFM=FB,LRECL=80)'), { positional: [], keywords: new Map([['DCB', '(RECFM=FB,LRECL=80)']]) });
});

test('quoted string containing comma and equals is treated as one operand', () => {
  assert.deepEqual(parseOperands("'A,B=C'"), { positional: ["'A,B=C'"], keywords: new Map() });
});

test('escaped quote inside quoted string is handled correctly', () => {
  assert.deepEqual(parseOperands("'IT''S'"), { positional: ["'IT''S'"], keywords: new Map() });
});

test('whitespace around operands is trimmed', () => {
  assert.deepEqual(parseOperands('  A , B  '), { positional: ['A', 'B'], keywords: new Map() });
});
