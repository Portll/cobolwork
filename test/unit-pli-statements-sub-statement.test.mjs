// Parses labels and returns a substatement object (lib/pli/statements.mjs subStatement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

test('returns labels and remaining tokens when no labels are present', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [{ t: 'word', v: 'MOVE', line: 10 }];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [],
    conditions: [],
    toks: [{ t: 'word', v: 'MOVE', line: 10 }],
    line: 10,
    endLine: 2
  });
});

test('extracts a single label and the following tokens', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [
    { t: 'word', u: 'LBL', v: 'LBL', line: 5 },
    { t: 'op', v: ':', line: 5 },
    { t: 'word', v: 'MOVE', line: 5 }
  ];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [{ name: 'LBL', line: 5 }],
    conditions: [],
    toks: [{ t: 'word', v: 'MOVE', line: 5 }],
    line: 5,
    endLine: 2
  });
});

test('extracts multiple labels before the first non-label token', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [
    { t: 'word', u: 'L1', v: 'L1', line: 3 },
    { t: 'op', v: ':', line: 3 },
    { t: 'word', u: 'L2', v: 'L2', line: 3 },
    { t: 'op', v: ':', line: 3 },
    { t: 'word', v: 'ADD', line: 3 }
  ];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [
      { name: 'L1', line: 3 },
      { name: 'L2', line: 3 }
    ],
    conditions: [],
    toks: [{ t: 'word', v: 'ADD', line: 3 }],
    line: 3,
    endLine: 2
  });
});

test('does not treat a word followed by a non-colon op as a label', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [
    { t: 'word', u: 'L1', v: 'L1', line: 4 },
    { t: 'op', v: '=', line: 4 },
    { t: 'word', v: 'X', line: 4 }
  ];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [],
    conditions: [],
    toks: [
      { t: 'word', u: 'L1', v: 'L1', line: 4 },
      { t: 'op', v: '=', line: 4 },
      { t: 'word', v: 'X', line: 4 }
    ],
    line: 4,
    endLine: 2
  });
});

test('does not treat a word at the end of tokens as a label', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [
    { t: 'word', u: 'L1', v: 'L1', line: 6 }
  ];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [],
    conditions: [],
    toks: [{ t: 'word', u: 'L1', v: 'L1', line: 6 }],
    line: 6,
    endLine: 2
  });
});

test('uses parent line when toks is empty', () => {
  const parent = { line: 7, endLine: 8 };
  const toks = [];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [],
    conditions: [],
    toks: [],
    line: 7,
    endLine: 8
  });
});

test('includes file property when parent has file', () => {
  const parent = { line: 1, endLine: 2, file: 'test.cbl' };
  const toks = [{ t: 'word', v: 'MOVE', line: 10 }];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [],
    conditions: [],
    toks: [{ t: 'word', v: 'MOVE', line: 10 }],
    line: 10,
    endLine: 2,
    file: 'test.cbl'
  });
});

test('omits file property when parent has no file', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [{ t: 'word', v: 'MOVE', line: 10 }];
  const result = subStatement(parent, toks);
  assert.equal('file' in result, false);
});

test('handles a colon op that is not preceded by a word', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [
    { t: 'op', v: ':', line: 5 },
    { t: 'word', v: 'MOVE', line: 5 }
  ];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [],
    conditions: [],
    toks: [
      { t: 'op', v: ':', line: 5 },
      { t: 'word', v: 'MOVE', line: 5 }
    ],
    line: 5,
    endLine: 2
  });
});

test('extracts labels when the first token is a label and the second is a colon', () => {
  const parent = { line: 1, endLine: 2 };
  const toks = [
    { t: 'word', u: 'A', v: 'A', line: 2 },
    { t: 'op', v: ':', line: 2 },
    { t: 'word', v: 'GO', line: 2 },
    { t: 'word', v: 'TO', line: 2 }
  ];
  const result = subStatement(parent, toks);
  assert.deepEqual(result, {
    labels: [{ name: 'A', line: 2 }],
    conditions: [],
    toks: [
      { t: 'word', v: 'GO', line: 2 },
      { t: 'word', v: 'TO', line: 2 }
    ],
    line: 2,
    endLine: 2
  });
});
