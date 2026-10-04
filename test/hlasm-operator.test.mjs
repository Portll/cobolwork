import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('WTO: simple quoted message', () => {
  const r = parse("         WTO   'HELLO WORLD'");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WTO');
  assert.equal(r.node.text, "'HELLO WORLD'");
  assert.deepEqual(r.node.keywords, {});
});

test('WTO: multi-line message in parentheses', () => {
  const r = parse("         WTO   ('LINE1','LINE2')");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WTO');
  assert.equal(r.node.text, "('LINE1','LINE2')");
});

test('WTO: with ROUTCDE and MF keywords', () => {
  const r = parse("         WTO   'MSG',ROUTCDE=(2,11),MF=L");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WTO');
  assert.equal(r.node.text, "'MSG'");
  assert.equal(r.node.keywords.ROUTCDE, '(2,11)');
  assert.equal(r.node.keywords.MF, 'L');
});

test('WTO: with DESC keyword', () => {
  const r = parse("         WTO   'MSG',DESC=(6)");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WTO');
  assert.equal(r.node.keywords.DESC, '(6)');
});

test('WTO: unknown keyword is refused', () => {
  const r = parse("         WTO   'MSG',FOO=1");
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unknown keyword FOO/);
});

test('WTO: non-quoted first operand is refused', () => {
  const r = parse("         WTO   MSGVAR");
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /must be a quoted string/);
});

test('WTOR: standard form with all four positional operands', () => {
  const r = parse("         WTOR  'REPLY?',REPLY,8,ECB");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WTOR');
  assert.equal(r.node.text, "'REPLY?'");
  assert.equal(r.node.reply, 'REPLY');
  assert.equal(r.node.replyLength, '8');
  assert.equal(r.node.ecb, 'ECB');
  assert.deepEqual(r.node.keywords, {});
});

test('WTOR: with ROUTCDE and MCSFLAG keywords', () => {
  const r = parse("         WTOR  'MSG',R,10,E,ROUTCDE=1,MCSFLAG=(BRDCST)");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WTOR');
  assert.equal(r.node.text, "'MSG'");
  assert.equal(r.node.reply, 'R');
  assert.equal(r.node.replyLength, '10');
  assert.equal(r.node.ecb, 'E');
  assert.equal(r.node.keywords.ROUTCDE, '1');
  assert.equal(r.node.keywords.MCSFLAG, '(BRDCST)');
});

test('WTOR: with TEXT keyword and no positional operands', () => {
  const r = parse("         WTOR  TEXT=(MSG,REPLY,8,ECB)");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WTOR');
  assert.equal(r.node.text, null);
  assert.equal(r.node.reply, null);
  assert.equal(r.node.replyLength, null);
  assert.equal(r.node.ecb, null);
  assert.equal(r.node.keywords.TEXT, '(MSG,REPLY,8,ECB)');
});

test('WTOR: unknown keyword is refused', () => {
  const r = parse("         WTOR  'MSG',R,8,E,FOO=1");
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unknown keyword FOO/);
});

test('WTOR: wrong number of positional operands is refused', () => {
  const r = parse("         WTOR  'MSG',R,8");
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /expected 4 positional operands/);
});

test('WTOR: no operands and no TEXT is refused', () => {
  const r = parse("         WTOR");
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /no positional operands and no TEXT/);
});

test('WTO and WTOR read their list and execute forms, multiple-line messages and authorized keywords', () => {
  assert.equal(parse('         WTO   ,MF=(E,(1))').status, 'parsed');
  assert.equal(parse('         WTO   MF=(E,DSAWTO),LINKAGE=BRANCH').status, 'parsed');
  assert.equal(parse("         WTO   ('LINE ONE',C),('LINE TWO',L),(,E)").status, 'parsed');
  assert.equal(parse("WTORL    WTOR  ' REPLY ?',ROUTCDE=(1,2),MF=L").status, 'parsed');
  assert.equal(parse('         WTOR  ,WTOANS1,50,WTORECB1,MF=(E,WTORL1)').status, 'parsed');
  assert.equal(parse('         WTOR  MF=(E,PROMPT)').status, 'parsed');
  assert.match(parse('         WTOR  ,ANS,50,ECB').reason, /first positional operand/);
});
