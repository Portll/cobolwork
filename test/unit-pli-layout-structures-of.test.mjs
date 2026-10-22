// Builds a forest of structure nodes from a flat list of COBOL items (lib/pli/layout.mjs structuresOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuresOf } from '../lib/pli/layout.mjs';
import './pin-machine.mjs';

test('returns an empty array when given no items', () => {
  const result = structuresOf([]);
  assert.deepEqual(result, []);
});

test('treats level 1 items as roots with logical 1', () => {
  const items = [
    { name: 'A', level: 1, line: 1 },
    { name: 'B', level: 1, line: 2 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'A');
  assert.equal(result[0].logical, 1);
  assert.equal(result[1].name, 'B');
  assert.equal(result[1].logical, 1);
});

test('treats null level items as roots without pushing to stack', () => {
  const items = [
    { name: 'A', level: null, line: 1 },
    { name: 'B', level: 2, line: 2 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'A');
  assert.equal(result[0].logical, 1);
  assert.equal(result[1].name, 'B');
  assert.equal(result[1].logical, 1);
  assert.equal(result[1].orphan, true);
});

test('treats level 0 items as roots and pushes to stack', () => {
  const items = [
    { name: 'A', level: 0, line: 1 },
    { name: 'B', level: 1, line: 2 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, 'A');
  assert.equal(result[0].logical, 1);
  assert.equal(result[1].name, 'B');
  assert.equal(result[1].logical, 1);
});

test('nests level 2 items under the most recent level 1 parent', () => {
  const items = [
    { name: 'A', level: 1, line: 1 },
    { name: 'B', level: 2, line: 2 },
    { name: 'C', level: 2, line: 3 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'A');
  assert.equal(result[0].children.length, 2);
  assert.equal(result[0].children[0].name, 'B');
  assert.equal(result[0].children[0].logical, 2);
  assert.equal(result[0].children[1].name, 'C');
  assert.equal(result[0].children[1].logical, 2);
});

test('pops stack when encountering a level equal to the current top', () => {
  const items = [
    { name: 'A', level: 1, line: 1 },
    { name: 'B', level: 2, line: 2 },
    { name: 'C', level: 2, line: 3 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'A');
  assert.equal(result[0].children.length, 2);
  assert.equal(result[0].children[0].name, 'B');
  assert.equal(result[0].children[1].name, 'C');
});

test('pops multiple stack entries when encountering a lower level', () => {
  const items = [
    { name: 'A', level: 1, line: 1 },
    { name: 'B', level: 2, line: 2 },
    { name: 'C', level: 3, line: 3 },
    { name: 'D', level: 2, line: 4 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'A');
  assert.equal(result[0].children.length, 2);
  assert.equal(result[0].children[0].name, 'B');
  assert.equal(result[0].children[0].children.length, 1);
  assert.equal(result[0].children[0].children[0].name, 'C');
  assert.equal(result[0].children[0].children[0].logical, 3);
  assert.equal(result[0].children[1].name, 'D');
  assert.equal(result[0].children[1].logical, 2);
});

test('marks items as orphan when stack is empty and level is greater than 1', () => {
  const items = [
    { name: 'A', level: null, line: 1 },
    { name: 'B', level: 2, line: 2 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 2);
  assert.equal(result[1].orphan, true);
  assert.equal(result[1].logical, 1);
});

test('preserves file, dims, and attributes on nodes', () => {
  const items = [
    { name: 'A', level: 1, line: 1, file: 'test.cob', dims: [10], attributes: ['PIC X'] },
  ];
  const result = structuresOf(items);
  assert.equal(result[0].file, 'test.cob');
  assert.deepEqual(result[0].dims, [10]);
  assert.deepEqual(result[0].attributes, ['PIC X']);
});

test('handles deeply nested structures with correct logical levels', () => {
  const items = [
    { name: 'L1', level: 1, line: 1 },
    { name: 'L2', level: 2, line: 2 },
    { name: 'L3', level: 3, line: 3 },
    { name: 'L4', level: 4, line: 4 },
  ];
  const result = structuresOf(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].logical, 1);
  assert.equal(result[0].children[0].logical, 2);
  assert.equal(result[0].children[0].children[0].logical, 3);
  assert.equal(result[0].children[0].children[0].children[0].logical, 4);
});
