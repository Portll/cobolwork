// Detects obsolete COBOL language elements and reports them (lib/practice-obsolete.mjs obsoleteIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { obsoleteIn } from '../lib/practice-obsolete.mjs';
import './pin-machine.mjs';

const w = (u, v = null) => ({ t: 'word', u, v });
const n = (v) => ({ t: 'num', v });
const lit = (v) => ({ t: 'lit', v });
const period = { t: 'period' };

test('identification paragraphs are reported as obsolete', () => {
  const tokens = [
    w('IDENTIFICATION'), w('DIVISION'), period,
    w('AUTHOR'), period,
  ];
  const result = obsoleteIn(tokens, []);
  assert.deepStrictEqual(result, [
    { rule: 'obsolete-identification-paragraph', tok: tokens[3], item: 'AUTHOR' },
  ]);
});

test('environment obsolete elements (MEMORY SIZE, MEMORY <number>, MULTIPLE FILE, RERUN) are reported', () => {
  const tokens = [
    w('ENVIRONMENT'), w('DIVISION'), period,
    w('MEMORY'), w('SIZE'), period,
    w('MEMORY'), n('123'), period,
    w('MULTIPLE'), w('FILE'), period,
    w('RERUN'), period,
  ];
  const result = obsoleteIn(tokens, []);
  assert.deepStrictEqual(result, [
    { rule: 'obsolete-memory-size', tok: tokens[3], item: 'MEMORY SIZE' },
    { rule: 'obsolete-memory-size', tok: tokens[6], item: 'MEMORY SIZE' },
    { rule: 'obsolete-multiple-file-tape', tok: tokens[9], item: 'MULTIPLE FILE TAPE' },
    { rule: 'obsolete-rerun', tok: tokens[12], item: 'RERUN' },
  ]);
});

test('data section obsolete elements (LABEL RECORDS, VALUE OF, DATA RECORDS) are reported', () => {
  const tokens = [
    w('FILE'), w('SECTION'), period,
    w('FD'),
    w('LABEL'), w('RECORDS'),
    w('VALUE'), w('OF'),
    w('DATA'), w('RECORDS'), period,
  ];
  const result = obsoleteIn(tokens, []);
  assert.deepStrictEqual(result, [
    { rule: 'obsolete-label-records', tok: tokens[4], item: 'LABEL RECORDS' },
    { rule: 'obsolete-value-of', tok: tokens[6], item: 'VALUE OF' },
    { rule: 'obsolete-data-records', tok: tokens[8], item: 'DATA RECORDS' },
  ]);
});

test('procedure obsolete elements (USE DEBUGGING, DEBUG-ITEM, ENTER, REVERSED) are reported', () => {
  const tokens = [
    w('PROCEDURE'), w('DIVISION'), period,
    w('USE'), w('DEBUGGING'), period,
    w('DEBUG-ITEM'), period,
    w('ENTER'), period,
    w('REVERSED'), period,
  ];
  const result = obsoleteIn(tokens, []);
  assert.deepStrictEqual(result, [
    { rule: 'obsolete-debugging-declarative', tok: tokens[3], item: 'USE FOR DEBUGGING' },
    { rule: 'obsolete-debugging-declarative', tok: tokens[6], item: 'DEBUG-ITEM' },
    { rule: 'obsolete-enter', tok: tokens[8], item: 'ENTER' },
    { rule: 'obsolete-reversed', tok: tokens[10], item: 'REVERSED' },
  ]);
});

test('segment numbers in section labels are reported', () => {
  const procTokens = [
    w('MYSEC'), w('SECTION'), n('5'), period,
  ];
  const programs = [
    {
      proc: { tokens: procTokens },
      labels: [{ kind: 'S', at: 0, name: 'MYSEC' }],
      statements: [],
    },
  ];
  const result = obsoleteIn([], programs);
  assert.deepStrictEqual(result, [
    {
      rule: 'obsolete-segment-number',
      tok: procTokens[2],
      item: 'MYSEC',
      segment: 5,
    },
  ]);
});

test('ALTER statements are reported as obsolete', () => {
  const procTokens = [
    w('ALTER'), period,
  ];
  const programs = [
    {
      proc: { tokens: procTokens },
      labels: [],
      statements: [{ verb: 'ALTER', at: 0, end: 1 }],
    },
  ];
  const result = obsoleteIn([], programs);
  assert.deepStrictEqual(result, [
    { rule: 'obsolete-alter', tok: procTokens[0], item: 'ALTER' },
  ]);
});

test('GO TO without a name is reported as obsolete', () => {
  const procTokens = [
    w('GO'), period,
  ];
  const programs = [
    {
      proc: { tokens: procTokens },
      labels: [],
      statements: [{ verb: 'GO', at: 0, end: 1 }],
    },
  ];
  const result = obsoleteIn([], programs);
  assert.deepStrictEqual(result, [
    { rule: 'obsolete-go-to-without-name', tok: procTokens[0], item: 'GO TO' },
  ]);
});

test('STOP with a literal, number, or figurative word is reported as obsolete', () => {
  const procTokens = [
    w('STOP'), lit('ZERO'), period,
  ];
  const programs = [
    {
      proc: { tokens: procTokens },
      labels: [],
      statements: [{ verb: 'STOP', at: 0, end: 2 }],
    },
  ];
  const result = obsoleteIn([], programs);
  assert.deepStrictEqual(result, [
    { rule: 'obsolete-stop-literal', tok: procTokens[0], item: 'STOP literal' },
  ]);
});
