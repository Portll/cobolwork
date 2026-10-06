import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('CSECT parses with and without a name', () => {
  assert.deepEqual(parse('COBDATFT CSECT').node, { kind: 'CSECT', name: 'COBDATFT' });
  assert.deepEqual(parse('         CSECT').node, { kind: 'CSECT', name: null });
  assert.equal(parse('LAB401   CSECT                    Back to our CSECT').node.name, 'LAB401');
});

test('DSECT takes a name, or none for an unnamed dummy section', () => {
  assert.deepEqual(parse('DFHEISTG DSECT').node, { kind: 'DSECT', name: 'DFHEISTG' });
  assert.equal(parse('         DSECT').status, 'parsed');
});

test('RSECT and COM parse with and without a name', () => {
  assert.deepEqual(parse('$HTMLCPY RSECT').node, { kind: 'RSECT', name: '$HTMLCPY' });
  assert.deepEqual(parse('         RSECT').node, { kind: 'RSECT', name: null });
  assert.deepEqual(parse('         COM').node, { kind: 'COM', name: null });
  assert.equal(parse('         COM   remark').status, 'parsed');
});

test('START parses with and without an origin', () => {
  const r = parse('MVSWAIT  START 0');
  assert.equal(r.node.kind, 'START');
  assert.equal(r.node.name, 'MVSWAIT');
  assert.equal(r.node.origin.v, 0);
  assert.deepEqual(parse('         START').node, { kind: 'START', name: null, origin: null });
  assert.equal(parse('         START 1,2').status, 'unparsed');
});

test('LOCTR requires a name and no operand', () => {
  assert.deepEqual(parse('LOC      LOCTR').node, { kind: 'LOCTR', name: 'LOC' });
  assert.equal(parse('         LOCTR').status, 'unparsed');
  assert.equal(parse('LOC      LOCTR remark').status, 'parsed');
});

test('ENTRY, EXTRN, WXTRN parse names and PART', () => {
  assert.deepEqual(parse('         ENTRY CABDTCNV').node, { kind: 'ENTRY', names: ['CABDTCNV'], parts: [] });
  assert.deepEqual(parse('         EXTRN A,B').node, { kind: 'EXTRN', names: ['A', 'B'], parts: [] });
  assert.deepEqual(parse('         WXTRN PART(A,B)').node, { kind: 'WXTRN', names: [], parts: ['A', 'B'] });
  assert.equal(parse('         ENTRY').status, 'unparsed');
  assert.equal(parse('         ENTRY 1').status, 'unparsed');
});

test('AMODE and RMODE parse valid modes', () => {
  assert.deepEqual(parse('ASAM1    AMODE 31').node, { kind: 'AMODE', name: 'ASAM1', mode: '31' });
  assert.deepEqual(parse('DYNQUERY  AMODE ANY').node, { kind: 'AMODE', name: 'DYNQUERY', mode: 'ANY' });
  assert.deepEqual(parse('DYNQUERY  RMODE ANY').node, { kind: 'RMODE', name: 'DYNQUERY', mode: 'ANY' });
  assert.deepEqual(parse('CABABEND RMODE 24').node, { kind: 'RMODE', name: 'CABABEND', mode: '24' });
  assert.equal(parse('         AMODE 99').status, 'unparsed');
  assert.equal(parse('         RMODE 99').status, 'unparsed');
});

test('ALIAS parses C and X strings', () => {
  assert.deepEqual(parse('MYALIAS  ALIAS C\'ABC\'').node, { kind: 'ALIAS', name: 'MYALIAS', alias: { type: 'C', text: 'ABC' } });
  assert.deepEqual(parse('MYALIAS  ALIAS X\'1F\'').node, { kind: 'ALIAS', name: 'MYALIAS', alias: { type: 'X', text: '1F' } });
  assert.equal(parse('         ALIAS C\'ABC\'').status, 'unparsed');
  assert.equal(parse('MYALIAS  ALIAS B\'ABC\'').status, 'unparsed');
});

test('XATTR parses keywords with values', () => {
  const r = parse('MYSEC    XATTR LINKAGE(OS),SCOPE(MODULE)');
  assert.equal(r.node.kind, 'XATTR');
  assert.equal(r.node.name, 'MYSEC');
  assert.equal(r.node.attributes.LINKAGE, 'OS');
  assert.equal(r.node.attributes.SCOPE, 'MODULE');
  assert.equal(parse('         XATTR LINKAGE(OS)').status, 'unparsed');
  assert.equal(parse('MYSEC    XATTR BADKEY').status, 'unparsed');
});

test('CATTR parses keywords with and without values', () => {
  const r = parse('MYSEC    CATTR RENT,REUSABLE,RMODE(31)');
  assert.equal(r.node.kind, 'CATTR');
  assert.equal(r.node.name, 'MYSEC');
  assert.equal(r.node.attributes.RENT, true);
  assert.equal(r.node.attributes.REUSABLE, true);
  assert.equal(r.node.attributes.RMODE, '31');
  assert.equal(parse('         CATTR RENT').status, 'unparsed');
  assert.equal(parse('MYSEC    CATTR BADKEY').status, 'unparsed');
});

test('DXD requires a name and one operand', () => {
  assert.deepEqual(parse('MYDXD    DXD 1F').node, { kind: 'DXD', name: 'MYDXD', operand: '1F' });
  assert.equal(parse('         DXD 1F').status, 'unparsed');
  assert.equal(parse('MYDXD    DXD').status, 'unparsed');
});

test('CXD parses with and without a name', () => {
  assert.deepEqual(parse('MYCXD    CXD').node, { kind: 'CXD', name: 'MYCXD' });
  assert.deepEqual(parse('         CXD').node, { kind: 'CXD', name: null });
  assert.equal(parse('         CXD   remark').status, 'parsed');
});
