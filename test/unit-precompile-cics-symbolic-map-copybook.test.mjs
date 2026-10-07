// Generates a COBOL copybook for a BMS symbolic map (lib/precompile-cics.mjs symbolicMapCopybook).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbolicMapCopybook } from '../lib/precompile-cics.mjs';
import './pin-machine.mjs';

test('returns null when no maps have symbolic input or output', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [{ name: 'F1', length: 10, occurs: 1, line: 3 }],
        symbolic: { input: null, output: null, attributes: [] }
      }
    ]
  };
  assert.equal(symbolicMapCopybook(mapset), null);
});

test('returns null when a field has a group name', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [
          { name: 'F1', length: 10, occurs: 1, line: 3, grpname: 'G1' },
          { name: 'F2', length: 5, occurs: 1, line: 4 }
        ],
        symbolic: { input: 'MAPIN', output: null, attributes: [] }
      }
    ]
  };
  assert.equal(symbolicMapCopybook(mapset), null);
});

test('returns null when a field occurs more than once', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [
          { name: 'F1', length: 10, occurs: 2, line: 3 },
          { name: 'F2', length: 5, occurs: 1, line: 4 }
        ],
        symbolic: { input: 'MAPIN', output: null, attributes: [] }
      }
    ]
  };
  assert.equal(symbolicMapCopybook(mapset), null);
});

test('generates input-only copybook without prefix', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [
          { name: 'FIELD1', length: 10, occurs: 1, line: 3, picin: 'X(10)' },
          { name: 'FIELD2', length: 5, occurs: 1, line: 4, picin: '9(5)' }
        ],
        symbolic: { input: 'MAPIN', output: null, attributes: [] }
      }
    ]
  };
  const result = symbolicMapCopybook(mapset);
  assert.deepEqual(result.names, ['MAPIN', 'FIELD1L', 'FIELD1F', 'MAPIN-F1', 'FIELD1A', 'FIELD1I', 'FIELD2L', 'FIELD2F', 'MAPIN-F2', 'FIELD2A', 'FIELD2I']);
  assert.deepEqual(result.lines, [2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4]);
  assert.equal(result.text, `       01  MAPIN.\n           02  FIELD1L COMP PIC S9(4).\n           02  FIELD1F PIC X.\n           02  MAPIN-F1 REDEFINES FIELD1F.\n             03  FIELD1A PIC X.\n           02  FIELD1I PIC X(10).\n           02  FIELD2L COMP PIC S9(4).\n           02  FIELD2F PIC X.\n           02  MAPIN-F2 REDEFINES FIELD2F.\n             03  FIELD2A PIC X.\n           02  FIELD2I PIC 9(5).\n`);
});

test('generates input-only copybook with prefix', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map([['TIOAPFX', 'YES']]),
        fields: [
          { name: 'FIELD1', length: 10, occurs: 1, line: 3, picin: 'X(10)' }
        ],
        symbolic: { input: 'MAPIN', output: null, attributes: [] }
      }
    ]
  };
  const result = symbolicMapCopybook(mapset);
  assert.deepEqual(result.names, ['MAPIN', 'MAPIN-F1', 'FIELD1L', 'FIELD1F', 'MAPIN-F2', 'FIELD1A', 'FIELD1I']);
  assert.deepEqual(result.lines, [2, 2, 3, 3, 3, 3, 3]);
  assert.equal(result.text, `       01  MAPIN.\n           02  MAPIN-F1 PIC X(12).\n           02  FIELD1L COMP PIC S9(4).\n           02  FIELD1F PIC X.\n           02  MAPIN-F2 REDEFINES FIELD1F.\n             03  FIELD1A PIC X.\n           02  FIELD1I PIC X(10).\n`);
});

test('generates input and output copybook with attributes', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [
          { name: 'FIELD1', length: 10, occurs: 1, line: 3, picin: 'X(10)', picout: 'X(10)' }
        ],
        symbolic: { input: 'MAPIN', output: 'MAPOUT', attributes: ['COLOR', 'PS'] }
      }
    ]
  };
  const result = symbolicMapCopybook(mapset);
  assert.deepEqual(result.names, ['MAPIN', 'FIELD1L', 'FIELD1F', 'MAPIN-F1', 'FIELD1A', 'MAPIN-F2', 'FIELD1I', 'MAPOUT', 'MAPOUT-F3', 'FIELD1C', 'FIELD1P', 'FIELD1O']);
  assert.deepEqual(result.lines, [2, 3, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3]);
  assert.equal(result.text, `       01  MAPIN.\n           02  FIELD1L COMP PIC S9(4).\n           02  FIELD1F PIC X.\n           02  MAPIN-F1 REDEFINES FIELD1F.\n             03  FIELD1A PIC X.\n           02  MAPIN-F2 PIC X(2).\n           02  FIELD1I PIC X(10).\n       01  MAPOUT REDEFINES MAPIN.\n           02  MAPOUT-F3 PIC X(3).\n           02  FIELD1C PIC X.\n           02  FIELD1P PIC X.\n           02  FIELD1O PIC X(10).\n`);
});

test('generates output-only copybook without prefix', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [
          { name: 'FIELD1', length: 10, occurs: 1, line: 3, picout: 'X(10)' }
        ],
        symbolic: { input: null, output: 'MAPOUT', attributes: ['HILIGHT'] }
      }
    ]
  };
  const result = symbolicMapCopybook(mapset);
  assert.deepEqual(result.names, ['MAPOUT', 'MAPOUT-F1', 'FIELD1A', 'FIELD1H', 'FIELD1O']);
  assert.deepEqual(result.lines, [2, 3, 3, 3, 3]);
  assert.equal(result.text, `       01  MAPOUT.\n           02  MAPOUT-F1 PIC X(2).\n           02  FIELD1A PIC X.\n           02  FIELD1H PIC X.\n           02  FIELD1O PIC X(10).\n`);
});

test('uses default pic when picin or picout is missing', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [
          { name: 'FIELD1', length: 8, occurs: 1, line: 3 }
        ],
        symbolic: { input: 'MAPIN', output: 'MAPOUT', attributes: [] }
      }
    ]
  };
  const result = symbolicMapCopybook(mapset);
  assert.equal(result.text, `       01  MAPIN.\n           02  FIELD1L COMP PIC S9(4).\n           02  FIELD1F PIC X.\n           02  MAPIN-F1 REDEFINES FIELD1F.\n             03  FIELD1A PIC X.\n           02  FIELD1I PIC X(8).\n       01  MAPOUT REDEFINES MAPIN.\n           02  MAPOUT-F2 PIC X(3).\n           02  FIELD1O PIC X(8).\n`);
});

test('handles multiple maps in sequence', () => {
  const mapset = {
    line: 1,
    options: { tioapfx: 'NO' },
    maps: [
      {
        line: 2,
        operands: new Map(),
        fields: [
          { name: 'F1', length: 5, occurs: 1, line: 3, picin: 'X(5)', picout: 'X(5)' }
        ],
        symbolic: { input: 'MAP1IN', output: 'MAP1OUT', attributes: [] }
      },
      {
        line: 10,
        operands: new Map(),
        fields: [
          { name: 'F2', length: 3, occurs: 1, line: 11, picin: '9(3)', picout: '9(3)' }
        ],
        symbolic: { input: 'MAP2IN', output: 'MAP2OUT', attributes: [] }
      }
    ]
  };
  const result = symbolicMapCopybook(mapset);
  assert.deepEqual(result.names, ['MAP1IN', 'F1L', 'F1F', 'MAP1IN-F1', 'F1A', 'F1I', 'MAP1OUT', 'MAP1OUT-F2', 'F1O', 'MAP2IN', 'F2L', 'F2F', 'MAP2IN-F3', 'F2A', 'F2I', 'MAP2OUT', 'MAP2OUT-F4', 'F2O']);
  assert.deepEqual(result.lines, [2, 3, 3, 3, 3, 3, 2, 3, 3, 10, 11, 11, 11, 11, 11, 10, 11, 11]);
  assert.equal(result.text, `       01  MAP1IN.\n           02  F1L COMP PIC S9(4).\n           02  F1F PIC X.\n           02  MAP1IN-F1 REDEFINES F1F.\n             03  F1A PIC X.\n           02  F1I PIC X(5).\n       01  MAP1OUT REDEFINES MAP1IN.\n           02  MAP1OUT-F2 PIC X(3).\n           02  F1O PIC X(5).\n       01  MAP2IN.\n           02  F2L COMP PIC S9(4).\n           02  F2F PIC X.\n           02  MAP2IN-F3 REDEFINES F2F.\n             03  F2A PIC X.\n           02  F2I PIC 9(3).\n       01  MAP2OUT REDEFINES MAP2IN.\n           02  MAP2OUT-F4 PIC X(3).\n           02  F2O PIC 9(3).\n`);
});
