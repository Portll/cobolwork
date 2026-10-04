import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('CEEENTRY parses standard keywords', () => {
  const r = parse('ASMSUB  CEEENTRY PPA=MAINPPA,AUTO=WORKSIZE,MAIN=NO,BASE=R10');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CEEENTRY');
  assert.equal(r.node.name, 'ASMSUB');
  assert.equal(r.node.main, 'NO');
  assert.equal(r.node.ppa, 'MAINPPA');
  assert.equal(r.node.keywords.AUTO, 'WORKSIZE');
  assert.equal(r.node.keywords.BASE, 'R10');
});

test('CEEENTRY parses MAIN=YES', () => {
  const r = parse('DBGMAIN  CEEENTRY PPA=MAINPPA,AUTO=WORKSIZE,MAIN=YES');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.main, 'YES');
});

test('CEEENTRY parses with trailing remarks', () => {
  const r = parse('IAATS91  CEEENTRY PPA=MAINPPA,AUTO=WORKSIZE                             IAA00010');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.ppa, 'MAINPPA');
});

test('CEEENTRY refuses unknown keyword', () => {
  const r = parse('X CEEENTRY FOO=BAR');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /does not take keyword FOO/);
});

test('CEETERM parses RC keyword', () => {
  const r = parse('        CEETERM RC=0');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CEETERM');
  assert.equal(r.node.rc, '0');
  assert.equal(r.node.keywords.RC, '0');
});

test('CEETERM parses with trailing remarks', () => {
  const r = parse('         CEETERM  RC=0                                                  IAA00430');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.rc, '0');
});

test('CEETERM refuses unknown keyword', () => {
  const r = parse('X CEETERM BAD=1');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /does not take keyword BAD/);
});

test('CEEPPA parses with no operands', () => {
  const r = parse('MAINPPA    CEEPPA');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CEEPPA');
  assert.equal(r.node.name, 'MAINPPA');
  assert.deepEqual(r.node.keywords, {});
});

test('CEEPPA parses with comma and remarks', () => {
  const r = parse('PARMPPA  CEEPPA ,                 Constants describing the code block');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.name, 'PARMPPA');
});

test('CEEPPA parses with keywords', () => {
  const r = parse('MAINPPA  CEEPPA LIBRARY=YES,DSA=NO');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.keywords.LIBRARY, 'YES');
  assert.equal(r.node.keywords.DSA, 'NO');
});

test('CEEPPA refuses unknown keyword', () => {
  const r = parse('X CEEPPA FOO=BAR');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /does not take keyword FOO/);
});

test('CEECAA parses with no operands', () => {
  const r = parse('         CEECAA');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CEECAA');
  assert.deepEqual(r.node.keywords, {});
});

test('CEECAA parses with comma and remarks', () => {
  const r = parse('         CEECAA ,                Mapping of the common anchor area');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CEECAA');
});

test('CEECAA refuses operands', () => {
  const r = parse('         CEECAA FOO=BAR');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /takes no operands/);
});

test('CEEDSA parses with no operands', () => {
  const r = parse('         CEEDSA');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CEEDSA');
  assert.deepEqual(r.node.keywords, {});
});

test('CEEDSA parses with comma and remarks', () => {
  const r = parse('         CEEDSA  ,                Mapping of the dynamic save area');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CEEDSA');
});

test('CEEDSA refuses operands', () => {
  const r = parse('         CEEDSA FOO=BAR');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /takes no operands/);
});
