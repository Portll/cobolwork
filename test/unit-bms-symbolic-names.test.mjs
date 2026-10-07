// Computes the COBOL field names a symbolic map gives a BMS field (lib/bms.mjs symbolicNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbolicNames } from '../lib/bms.mjs';
import './pin-machine.mjs';

test('returns an empty array when the field has no name', () => {
  const map = { symbolic: { input: 'IN', output: 'OUT', attributes: [] } };
  const field = { name: '', line: 1 };
  assert.deepEqual(symbolicNames(map, field), []);
});

test('returns an empty array when the map has no symbolic section', () => {
  const map = {};
  const field = { name: 'TELNO', line: 1 };
  assert.deepEqual(symbolicNames(map, field), []);
});

test('lays out a plain input field with L, F, A, I in the input record and extended attributes and O in the output record', () => {
  const map = {
    symbolic: { input: 'IN', output: 'OUT', attributes: ['COLOR', 'PS'] },
    fields: [{ name: 'TELNO', line: 1 }],
  };
  const field = { name: 'telno', line: 1 };
  assert.deepEqual(symbolicNames(map, field), [
    { name: 'TELNOL', suffix: 'L', record: 'IN' },
    { name: 'TELNOF', suffix: 'F', record: 'IN' },
    { name: 'TELNOA', suffix: 'A', record: 'IN' },
    { name: 'TELNOI', suffix: 'I', record: 'IN' },
    { name: 'TELNOC', suffix: 'C', record: 'OUT' },
    { name: 'TELNOP', suffix: 'P', record: 'OUT' },
    { name: 'TELNOO', suffix: 'O', record: 'OUT' },
  ]);
});

test('lays out a plain output-only field with A, extended attributes and O in the output record', () => {
  const map = {
    symbolic: { input: null, output: 'OUT', attributes: ['HILIGHT'] },
    fields: [{ name: 'TELNO', line: 1 }],
  };
  const field = { name: 'telno', line: 1 };
  assert.deepEqual(symbolicNames(map, field), [
    { name: 'TELNOA', suffix: 'A', record: 'OUT' },
    { name: 'TELNOH', suffix: 'H', record: 'OUT' },
    { name: 'TELNOO', suffix: 'O', record: 'OUT' },
  ]);
});

test('lays out a non-leader group field with only I in the input record and O in the output record', () => {
  const map = {
    symbolic: { input: 'IN', output: 'OUT', attributes: [] },
    fields: [
      { name: 'FIRST', grpname: 'GRP', line: 1 },
      { name: 'SECOND', grpname: 'GRP', line: 2 },
    ],
  };
  const field = { name: 'second', grpname: 'grp', line: 2 };
  assert.deepEqual(symbolicNames(map, field), [
    { name: 'SECONDI', suffix: 'I', record: 'IN' },
    { name: 'SECONDO', suffix: 'O', record: 'OUT' },
  ]);
});

test('lays out a leader group field with the group name as head and L, F, A, I in the input record and extended attributes and O in the output record', () => {
  const map = {
    symbolic: { input: 'IN', output: 'OUT', attributes: ['VALIDN'] },
    fields: [
      { name: 'FIRST', grpname: 'GRP', line: 1 },
      { name: 'SECOND', grpname: 'GRP', line: 2 },
    ],
  };
  const field = { name: 'first', grpname: 'grp', line: 1 };
  assert.deepEqual(symbolicNames(map, field), [
    { name: 'GRP', suffix: null, group: 'GRP', record: 'IN' },
    { name: 'FIRSTL', suffix: 'L', record: 'IN' },
    { name: 'FIRSTF', suffix: 'F', record: 'IN' },
    { name: 'FIRSTA', suffix: 'A', record: 'IN' },
    { name: 'FIRSTI', suffix: 'I', record: 'IN' },
    { name: 'GRP', suffix: null, group: 'GRP', record: 'OUT' },
    { name: 'FIRSTV', suffix: 'V', record: 'OUT' },
    { name: 'FIRSTO', suffix: 'O', record: 'OUT' },
  ]);
});

test('lays out an occurs field with a D-suffixed input array and a DFHMSn output array', () => {
  const map = {
    symbolic: { input: 'IN', output: 'OUT', attributes: ['COLOR'], occursBefore: 0 },
    fields: [
      { name: 'TELNO', line: 1, occurs: 3 },
      { name: 'OTHER', line: 2, occurs: 2 },
    ],
  };
  const field = { name: 'telno', line: 1, occurs: 3 };
  assert.deepEqual(symbolicNames(map, field), [
    { name: 'TELNOD', suffix: 'D', occurs: 3, record: 'IN' },
    { name: 'TELNOL', suffix: 'L', record: 'IN', occurs: 3 },
    { name: 'TELNOF', suffix: 'F', record: 'IN', occurs: 3 },
    { name: 'TELNOI', suffix: 'I', record: 'IN', occurs: 3 },
    { name: 'DFHMS1', suffix: null, occurs: 3, record: 'OUT' },
    { name: 'TELNOA', suffix: 'A', record: 'OUT', occurs: 3 },
    { name: 'TELNOC', suffix: 'C', record: 'OUT', occurs: 3 },
    { name: 'TELNOO', suffix: 'O', record: 'OUT', occurs: 3 },
  ]);
});

test('counts occurs fields at or before the current line for the DFHMSn number', () => {
  const map = {
    symbolic: { input: 'IN', output: 'OUT', attributes: [], occursBefore: 1 },
    fields: [
      { name: 'A', line: 1, occurs: 2 },
      { name: 'B', line: 2, occurs: 3 },
      { name: 'C', line: 3, occurs: 4 },
    ],
  };
  const field = { name: 'b', line: 2, occurs: 3 };
  assert.deepEqual(symbolicNames(map, field), [
    { name: 'BD', suffix: 'D', occurs: 3, record: 'IN' },
    { name: 'BL', suffix: 'L', record: 'IN', occurs: 3 },
    { name: 'BF', suffix: 'F', record: 'IN', occurs: 3 },
    { name: 'BI', suffix: 'I', record: 'IN', occurs: 3 },
    { name: 'DFHMS3', suffix: null, occurs: 3, record: 'OUT' },
    { name: 'BA', suffix: 'A', record: 'OUT', occurs: 3 },
    { name: 'BO', suffix: 'O', record: 'OUT', occurs: 3 },
  ]);
});
