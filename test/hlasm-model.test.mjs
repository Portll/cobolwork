import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const definition = (...body) => readHlasmStatements(['         MACRO', ...body, '         MEND'].join('\n')).statements;

test('a prototype names its macro, label, positional and keyword parameters', () => {
  const r = parseHlasmStatement(definition('&L       MYMAC &A,&B,&K=DEFAULT,&E=')[1]);
  assert.equal(r.status, 'parsed');
  assert.deepEqual(r.node, { kind: 'PROTOTYPE', macro: 'MYMAC', label: '&L', positional: ['&A', '&B'], keywords: { '&K': 'DEFAULT', '&E': '' } });
  assert.equal(parseHlasmStatement(definition('LABEL    MYMAC &A')[1]).status, 'unparsed');
});

test('a model statement is read as the statement it is, its variable symbols standing in for symbols', () => {
  const [, , mvc, dc, quoted, sequence] = definition('&L       MYMAC &A', '&L       MVC   &A.X(8),&TAB(&I+1)', '&L       DC    A(&A,&B)',
    "         DC    C'&A&&B'", '.SKIP    DS    0H');
  const r = parseHlasmStatement(mvc);
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.as, 'SS');
  assert.equal(parseHlasmStatement(dc).node.as, 'DC');
  assert.equal(parseHlasmStatement(quoted).node.node.operands[0].nominal.quoted, 'X&B');
  assert.equal(parseHlasmStatement(sequence).status, 'parsed');
});

test('a name with a variable symbol after its first character is dropped and the statement read', () => {
  const [, , inner] = definition('&NAME    GETPARM', 'KFBR&SYSNDX L    14,4(15)   GET ADDRESS');
  const r = parseHlasmStatement(inner);
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.as, 'RX');
  const [open] = readHlasmStatements('A&B.C    DS    F').statements;
  assert.equal(parseHlasmStatement(open).status, 'parsed');
});

test('an operation that is a variable symbol is refused, and open-code statements with variable symbols are read', () => {
  const [, , op] = definition('         MYMAC', '         &OP   1,2');
  assert.match(parseHlasmStatement(op).reason, /decided when the macro is expanded/);
  const [open] = readHlasmStatements("&N       DS    CL(&LEN)").statements;
  const r = parseHlasmStatement(open);
  assert.equal(r.kind, 'SUBSTITUTED');
  assert.equal(r.node.as, 'DS');
});
