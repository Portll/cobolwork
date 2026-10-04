import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('CALL parses standard form with entry, params, and VL', () => {
  const res = parse('         CALL  ASAM2,(DATALEN,INREC,HEXTOP,HEXBOT),VL');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'CALL');
  assert.equal(res.node.entry, 'ASAM2');
  assert.equal(res.node.register, null);
  assert.deepEqual(res.node.params, ['DATALEN', 'INREC', 'HEXTOP', 'HEXBOT']);
  assert.equal(res.node.vl, true);
  assert.equal(res.node.keywords.VL, 'VL');
});

test('CALL parses with MF keyword', () => {
  const res = parse('         CALL  CEE3PRM,(CHARPARM,FBCODE),VL,MF=(E,CALL3PRM)');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.entry, 'CEE3PRM');
  assert.equal(res.node.keywords.MF, '(E,CALL3PRM)');
});

test('CALL parses with register entry', () => {
  const res = parse('         CALL  (15),(ADDR1,ADDR2,ADDR3)');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.entry, null);
  assert.equal(res.node.register, '(15)');
  assert.deepEqual(res.node.params, ['ADDR1', 'ADDR2', 'ADDR3']);
});

test('CALL refuses unknown keyword', () => {
  const res = parse('         CALL  ENTRY,VL,FOO=BAR');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /FOO/);
});

test('SAVE parses standard form with registers', () => {
  const res = parse('BEGIN    SAVE (14,12)    SAVE REGISTERS');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'SAVE');
  assert.deepEqual(res.node.registers, ['14', '12']);
  assert.equal(res.node.t, false);
  assert.equal(res.node.id, null);
});

test('SAVE parses with T and ID', () => {
  const res = parse('         SAVE  (14,12),T,MYID');
  assert.equal(res.status, 'parsed');
  assert.deepEqual(res.node.registers, ['14', '12']);
  assert.equal(res.node.t, true);
  assert.equal(res.node.id, 'MYID');
});

test('SAVE refuses keywords', () => {
  const res = parse('         SAVE  (14,12),FOO=BAR');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /keywords/);
});

test('RETURN parses standard form with registers', () => {
  const res = parse('         RETURN (14,12)');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'RETURN');
  assert.deepEqual(res.node.registers, ['14', '12']);
  assert.equal(res.node.t, false);
  assert.equal(res.node.rc, null);
});

test('RETURN parses with RC keyword', () => {
  const res = parse('         RETURN (14,12),RC=(15)');
  assert.equal(res.status, 'parsed');
  assert.deepEqual(res.node.registers, ['14', '12']);
  assert.equal(res.node.rc, '(15)');
  assert.equal(res.node.keywords.RC, '(15)');
});

test('RETURN parses with T and RC', () => {
  const res = parse('         RETURN (14,12),T,RC=0');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.t, true);
  assert.equal(res.node.rc, '0');
});

test('RETURN refuses unknown keyword', () => {
  const res = parse('         RETURN (14,12),FOO=BAR');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /FOO/);
});

test('SAVE with an empty T slot and an identifier, and a list-form CALL with no entry, parse', () => {
  assert.equal(parse('         SAVE  (14,12),,*').node.id, '*');
  assert.equal(parse('CALL3PRM CALL  ,(,),VL,MF=L').status, 'parsed');
  assert.equal(parse('         CALL  ,(A),VL').status, 'unparsed');
});
