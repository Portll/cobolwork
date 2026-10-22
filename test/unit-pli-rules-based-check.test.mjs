// Detects BASED storage addressing patterns in COBOL programs (lib/pli/rules/based.mjs check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../lib/pli/rules/based.mjs';
import './pin-machine.mjs';

test('returns empty array when no BASED variables are declared', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 1, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [{ name: 'X', attributes: [] }] } } },
      { line: 2, parsed: { status: 'parsed', node: { kind: 'ASSIGNMENT', targets: [{ t: 'ref', name: 'X' }], value: { tree: { t: 'word', u: '1' } } } } }
    ]
  };
  assert.deepEqual(check(program), []);
});

test('reports single BASED variable with plain pointer', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 10, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [{ name: 'P1', attributes: [{ name: 'BASED', args: [] }] }] } } }
    ]
  };
  const result = check(program);
  assert.equal(result.length, 1);
  assert.equal(result[0].rule, 'pli-based-storage-addressing');
  assert.equal(result[0].path, 'test.cbl');
  assert.equal(result[0].line, 10);
  assert.equal(result[0].detail, '1 variable declared BASED (P1), plain pointers addressing whatever the pointer holds');
});

test('reports multiple BASED variables with ADDR overlays', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 5, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [
        { name: 'A', attributes: [{ name: 'BASED', args: [{ t: 'word', u: 'ADDR' }] }] },
        { name: 'B', attributes: [{ name: 'BASED', args: [{ t: 'word', u: 'ADDR' }] }] }
      ] } } }
    ]
  };
  const result = check(program);
  assert.equal(result.length, 1);
  assert.equal(result[0].line, 5);
  assert.equal(result[0].detail, '2 variables declared BASED (A, B), using ADDR() of declared variables (overlays)');
});

test('reports mixed ADDR and plain BASED variables', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 3, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [
        { name: 'X', attributes: [{ name: 'BASED', args: [{ t: 'word', u: 'ADDR' }] }] },
        { name: 'Y', attributes: [{ name: 'BASED', args: [] }] }
      ] } } }
    ]
  };
  const result = check(program);
  assert.equal(result[0].line, 3);
  assert.equal(result[0].detail, '2 variables declared BASED (X, Y), some using ADDR() of declared variables (overlays) and some plain pointers');
});

test('includes first computed address assignment to pointer variable', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 1, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [
        { name: 'PTR', attributes: [{ name: 'POINTER' }] },
        { name: 'B', attributes: [{ name: 'BASED', args: [] }] }
      ] } } },
      { line: 8, parsed: { status: 'parsed', node: { kind: 'ASSIGNMENT', targets: [{ t: 'ref', name: 'PTR' }], value: { tree: { op: '+', args: [] } } } } }
    ]
  };
  const result = check(program);
  assert.equal(result[0].line, 1);
  assert.equal(result[0].detail, '1 variable declared BASED (B), plain pointers addressing whatever the pointer holds; first computed address assignment to PTR at line 8');
});

test('does not report non-computed address assignment to pointer', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 1, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [
        { name: 'PTR', attributes: [{ name: 'POINTER' }] },
        { name: 'B', attributes: [{ name: 'BASED', args: [] }] }
      ] } } },
      { line: 8, parsed: { status: 'parsed', node: { kind: 'ASSIGNMENT', targets: [{ t: 'ref', name: 'PTR' }], value: { tree: { t: 'word', u: '0' } } } } }
    ]
  };
  const result = check(program);
  assert.equal(result[0].detail, '1 variable declared BASED (B), plain pointers addressing whatever the pointer holds');
});

test('handles POINTERADD function call as computed address', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 2, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [
        { name: 'PTR', attributes: [{ name: 'POINTER' }] },
        { name: 'B', attributes: [{ name: 'BASED', args: [] }] }
      ] } } },
      { line: 15, parsed: { status: 'parsed', node: { kind: 'ASSIGNMENT', targets: [{ t: 'ref', name: 'PTR' }], value: { tree: { t: 'ref', name: 'POINTERADD', args: [[{ t: 'word', u: 'X' }]] } } } } }
    ]
  };
  const result = check(program);
  assert.equal(result[0].detail, '1 variable declared BASED (B), plain pointers addressing whatever the pointer holds; first computed address assignment to PTR at line 15');
});

test('skips unparsed statements and units without nodes', () => {
  const program = {
    path: 'test.cbl',
    statements: [
      { line: 1, parsed: { status: 'error', node: null } },
      { line: 2, parsed: { status: 'parsed', node: null } },
      { line: 3, parsed: { status: 'parsed', node: { kind: 'DECLARE', items: [{ name: 'B', attributes: [{ name: 'BASED', args: [] }] }] } } }
    ]
  };
  const result = check(program);
  assert.equal(result.length, 1);
  assert.equal(result[0].line, 3);
});
