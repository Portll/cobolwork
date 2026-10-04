import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('MODESET parses SVC generation form with KEY and MODE', () => {
  const res = parse('         MODESET KEY=ZERO,MODE=SUP');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'MODESET');
  assert.equal(res.node.key, 'ZERO');
  assert.equal(res.node.mode, 'SUP');
  assert.equal(res.node.extkey, null);
  assert.equal(res.node.keywords.KEY, 'ZERO');
  assert.equal(res.node.keywords.MODE, 'SUP');
});

test('MODESET parses standard form with EXTKEY, SAVEKEY, and WORKREG', () => {
  const res = parse('         MODESET EXTKEY=TCB,SAVEKEY=KEYSAVE,WORKREG=1');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'MODESET');
  assert.equal(res.node.extkey, 'TCB');
  assert.equal(res.node.keywords.SAVEKEY, 'KEYSAVE');
  assert.equal(res.node.keywords.WORKREG, '1');
});

test('MODESET parses standard form with KEYREG', () => {
  const res = parse('         MODESET KEYREG=REG3,SAVEKEY=KEY,WORKREG=4');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'MODESET');
  assert.equal(res.node.keywords.KEYREG, 'REG3');
});

test('MODESET refuses unknown keyword', () => {
  const res = parse('         MODESET BADKEY=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /unknown keyword/);
});

test('MODESET refuses invalid EXTKEY value', () => {
  const res = parse('         MODESET EXTKEY=BAD');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /invalid EXTKEY/);
});

test('TESTAUTH parses with FCTN', () => {
  const res = parse('         TESTAUTH FCTN=1');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'TESTAUTH');
  assert.equal(res.node.keywords.FCTN, '1');
});

test('TESTAUTH parses with STATE, KEY, and FCTN', () => {
  const res = parse('         TESTAUTH STATE=YES,KEY=NO,FCTN=1');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'TESTAUTH');
  assert.equal(res.node.keywords.STATE, 'YES');
  assert.equal(res.node.keywords.KEY, 'NO');
  assert.equal(res.node.keywords.FCTN, '1');
});

test('TESTAUTH parses with RBLEVEL and BRANCH', () => {
  const res = parse('         TESTAUTH RBLEVEL=1,BRANCH=YES');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'TESTAUTH');
  assert.equal(res.node.keywords.RBLEVEL, '1');
  assert.equal(res.node.keywords.BRANCH, 'YES');
});

test('TESTAUTH refuses unknown keyword', () => {
  const res = parse('         TESTAUTH BADKEY=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /unknown keyword/);
});

test('TESTAUTH refuses invalid STATE value', () => {
  const res = parse('         TESTAUTH STATE=MAYBE');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /invalid STATE/);
});

test('RACROUTE parses with REQUEST=AUTH', () => {
  const res = parse('         RACROUTE REQUEST=AUTH,CLASS=DATASET,ENTITY=USER.DATA');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'RACROUTE');
  assert.equal(res.node.request, 'AUTH');
  assert.equal(res.node.class, 'DATASET');
  assert.equal(res.node.entity, 'USER.DATA');
  assert.equal(res.node.attr, null);
});

test('RACROUTE parses with REQUEST=VERIFY', () => {
  const res = parse('         RACROUTE REQUEST=VERIFY,CLASS=USER,ENTITY=JSMITH');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'RACROUTE');
  assert.equal(res.node.request, 'VERIFY');
  assert.equal(res.node.class, 'USER');
  assert.equal(res.node.entity, 'JSMITH');
});

test('RACROUTE parses with REQUEST=EXTRACT and ATTR', () => {
  const res = parse('         RACROUTE REQUEST=EXTRACT,CLASS=USER,ENTITY=JSMITH,ATTR=ACCT');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.kind, 'RACROUTE');
  assert.equal(res.node.request, 'EXTRACT');
  assert.equal(res.node.attr, 'ACCT');
});

test('RACROUTE refuses missing REQUEST', () => {
  const res = parse('         RACROUTE CLASS=DATASET');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /REQUEST is required/);
});

test('RACROUTE refuses invalid REQUEST value', () => {
  const res = parse('         RACROUTE REQUEST=BAD');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /invalid REQUEST/);
});

test('MODESET reads its list and execute forms', () => {
  const list = parse('LIST     MODESET KEY=ZERO,MODE=SUP,MF=L');
  assert.equal(list.status, 'parsed');
  assert.equal(list.node.mf, 'L');
  assert.equal(list.node.key, 'ZERO');
  const exec = parse('         MODESET MF=(E,LIST)');
  assert.equal(exec.status, 'parsed');
  assert.equal(exec.node.mf, 'E');
  assert.equal(exec.node.list, 'LIST');
  assert.equal(parse('         MODESET MF=(E,(1))').node.list, '(1)');
  assert.match(parse('         MODESET MF=L').reason, /needs KEY or MODE/);
  assert.match(parse('         MODESET KEY=ZERO,MF=(E,LIST)').reason, /execute form does not take KEY/);
  assert.match(parse('         MODESET EXTKEY=ZERO,MF=L').reason, /list form does not take EXTKEY/);
  assert.match(parse('         MODESET KEY=ZERO,MF=X').reason, /not L or \(E,addr\)/);
});
