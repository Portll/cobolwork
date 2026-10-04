import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('EQU reads its value, length, type and assembler type, and needs a name and a value', () => {
  const r = parse("R12      EQU   12,,,,GR");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.assemblerType, 'GR');
  assert.equal(parse("Y        EQU   X,40,C'F'").node.length.v, 40);
  assert.equal(parse('         EQU   5').status, 'unparsed');
  assert.equal(parse('A        EQU   5,,,,XX').status, 'unparsed');
});

test('USING reads ordinary, ranged, labeled and dependent forms', () => {
  assert.equal(parse('         USING *,12').node.registers.length, 1);
  assert.ok(parse('         USING (BASE,END),11,12').node.end);
  assert.equal(parse('LBL      USING WORK,13').node.label, 'LBL');
  assert.equal(parse('         USING DSECTX,FIELD+4').node.registers[0].t, 'bin');
  assert.equal(parse('         USING *').status, 'unparsed');
});

test('ORG, CNOP, LTORG and END take the operands HLASM gives them and refuse others', () => {
  assert.equal(parse('         ORG').node.value, null);
  assert.equal(parse('         ORG   *,8').node.boundary, 8);
  assert.equal(parse('         ORG   *,6').status, 'unparsed');
  assert.equal(parse('         CNOP  2,8').status, 'parsed');
  assert.equal(parse('         CNOP  2').status, 'unparsed');
  assert.equal(parse('         LTORG').status, 'parsed');
  assert.equal(parse('         END   START').node.entry.name, 'START');
});

test('PUSH and POP take PRINT, USING, ACONTROL and NOPRINT only', () => {
  assert.deepEqual(parse('         PUSH  PRINT,USING').node.what, ['PRINT', 'USING']);
  assert.equal(parse('         POP   LISTING').status, 'unparsed');
});
