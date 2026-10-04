import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('LINK parses EP= and PARAM= with VL=1', () => {
  const res = parse('         LINK EP=TAED002A,Param=(ParmStr),VL=1');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, 'TAED002A');
  assert.equal(res.node.eploc, null);
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
  assert.equal(res.node.param, '(ParmStr)');
  assert.equal(res.node.keywords.VL, '1');
});

test('LINK refuses unknown keyword', () => {
  const res = parse('         LINK EP=FOO,BAD=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /unknown keyword/);
});

test('LOAD parses EP= with trailing comment', () => {
  const res = parse('         LOAD  EP=CEELOCT                LOAD ENTRY OF CEELOCT');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, 'CEELOCT');
  assert.equal(res.node.eploc, null);
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
});

test('LOAD refuses missing EP/EPLOC/DE', () => {
  const res = parse('         LOAD  DCB=FOO');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /missing EP, EPLOC, or DE/);
});

test('XCTL parses register list and EPLOC=', () => {
  const res = parse('         XCTL (2,12),EPLOC=XCTLEP');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, null);
  assert.equal(res.node.eploc, 'XCTLEP');
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
});

test('XCTL refuses invalid register list', () => {
  const res = parse('         XCTL (2,12,14),EP=FOO');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /invalid register list/);
});

test('ATTACH parses EP= and ECB=', () => {
  const res = parse('         ATTACH EP=FOO,ECB=BAR');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, 'FOO');
  assert.equal(res.node.eploc, null);
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
  assert.equal(res.node.param, null);
  assert.equal(res.node.keywords.ECB, 'BAR');
});

test('ATTACH refuses unknown keyword', () => {
  const res = parse('         ATTACH EP=FOO,BAD=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /unknown keyword/);
});
