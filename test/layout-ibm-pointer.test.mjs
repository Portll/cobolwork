import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../lib/parser.mjs';
import './pin-machine.mjs';

const SOURCE = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. PTRS.',
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01  PARMS.',
  '           05  P-STORAGE   USAGE POINTER.',
  '           05  P-LEN       PIC 9(4) BINARY.',
  '           05  P-NEXT      PROCEDURE-POINTER.',
  '       PROCEDURE DIVISION.',
  '           GOBACK.',
  '',
].join('\n');

const sizes = (std) => {
  const items = parseSource(SOURCE, 'PTRS.cbl', { format: 'fixed', std }).programs[0].items;
  return Object.fromEntries(items.map((it) => [it.name, [it.size, it.offset]]));
};

test('a pointer holds 4 bytes under the IBM standard and 8 otherwise', () => {
  assert.deepEqual(sizes('ibm'), { PARMS: [10, 0], 'P-STORAGE': [4, 0], 'P-LEN': [2, 4], 'P-NEXT': [4, 6] });
  assert.deepEqual(sizes('default'), { PARMS: [18, 0], 'P-STORAGE': [8, 0], 'P-LEN': [2, 8], 'P-NEXT': [8, 10] });
});
