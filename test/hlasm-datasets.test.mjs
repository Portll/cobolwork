import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);
const names = (r) => r.node.dcbs.map((d) => [d.dcb.disp.name, d.options]);

test('OPEN pairs each DCB with its options, written in parentheses, bare or omitted', () => {
  assert.deepEqual(names(parse('         OPEN  (INDCB,(INPUT),OUTDCB,(OUTPUT))')), [['INDCB', ['INPUT']], ['OUTDCB', ['OUTPUT']]]);
  assert.deepEqual(names(parse('         OPEN  (INDCB,INPUT,OUTDCB,OUTPUT)')), [['INDCB', ['INPUT']], ['OUTDCB', ['OUTPUT']]]);
  assert.deepEqual(names(parse('         OPEN  (INDCB,,OUTDCB,(OUTPUT))')), [['INDCB', []], ['OUTDCB', ['OUTPUT']]]);
  assert.deepEqual(parse('         OPEN  (PRINT,OUTPUT),MODE=31').node.keywords, { MODE: '31' });
});

test('a single DCB may be written without parentheses, and an unknown option or keyword is refused', () => {
  assert.deepEqual(names(parse('         CLOSE FILEOUT')), [['FILEOUT', []]]);
  assert.deepEqual(names(parse('         CLOSE (IN,LEAVE)')), [['IN', ['LEAVE']]]);
  assert.equal(parse('         OPEN  (IN,(SIDEWAYS))').status, 'unparsed');
  assert.equal(parse('         OPEN  (IN),COLOUR=RED').status, 'unparsed');
});

test('DCB keeps its keywords and names the DD statement it reads', () => {
  const r = parse('INDCB    DCB   DDNAME=sysin,MACRF=GM,RECFM=FB,LRECL=80,EODAD=EOF');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.name, 'INDCB');
  assert.equal(r.node.ddname, 'SYSIN');
  assert.equal(r.node.keywords.EODAD, 'EOF');
  assert.equal(parse('BAD      DCB   DDNAME=X,COLOUR=RED').status, 'unparsed');
  assert.equal(parse('BAD      DCB   X').status, 'unparsed');
});

test('OPEN and CLOSE read their list and execute forms, with DCB slots left to the other form', () => {
  const list = parse('OPENL    OPEN  (,),MF=L');
  assert.equal(list.status, 'parsed');
  assert.equal(list.node.mf, 'L');
  assert.equal(list.node.dcbs[0].dcb, null);
  assert.equal(parse('CLOSEL   CLOSE (,DISP),MF=L').status, 'parsed');
  const exec = parse('         OPEN  TYPE=J,MF=(E,OPENLIST)');
  assert.equal(exec.status, 'parsed');
  assert.deepEqual(exec.node.mf, { form: 'E', list: 'OPENLIST' });
  assert.equal(parse('         CLOSE MF=(E,(10))').status, 'parsed');
  assert.equal(parse('         OPEN  (INDCB,(INPUT)),MF=(E,OPENLIST)').status, 'parsed');
  assert.match(parse('         OPEN  (,)').reason, /empty dcb address/);
  assert.match(parse('         CLOSE TYPE=T').reason, /exactly one positional operand/);
});
