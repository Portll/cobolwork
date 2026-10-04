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

test('a name built from variable symbols stands in as a symbol and the statement is read', () => {
  const [, , inner] = definition('&NAME    GETPARM', 'KFBR&SYSNDX L    14,4(15)   GET ADDRESS');
  const r = parseHlasmStatement(inner);
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.as, 'RX');
  const [open] = readHlasmStatements('A&B.C    DS    F').statements;
  assert.equal(parseHlasmStatement(open).status, 'parsed');
  const [, , equ, offset] = definition('&NAME    MYMAC &SYMBOL', '&NAME    EQU   *', '&SYMBOL  EQU   *+&BYTE');
  assert.equal(parseHlasmStatement(equ).status, 'parsed');
  assert.equal(parseHlasmStatement(offset).node.as, 'EQU');
});

test('an operation that is a variable symbol is refused, and open-code statements with variable symbols are read', () => {
  const [, , op] = definition('         MYMAC', '         &OP   1,2');
  assert.match(parseHlasmStatement(op).reason, /decided when the macro is expanded/);
  const [open] = readHlasmStatements("&N       DS    CL(&LEN)").statements;
  const r = parseHlasmStatement(open);
  assert.equal(r.kind, 'SUBSTITUTED');
  assert.equal(r.node.as, 'DS');
});

test('a variable that may carry a quoted value or a number is read that way when a symbol does not fit', () => {
  const [, , message, literal, factor, symbol] = definition('&L       MYMAC &MSG,&T,&R', '&L       DC    C&MSG', '         LA    &R,=C&LIST',
    '&W       DC    &T.F\'0\'', '&L       LA    &R,0(&R)');
  for (const st of [message, literal, factor]) {
    const r = parseHlasmStatement(st);
    assert.equal(r.status, 'parsed', st.field);
    assert.equal(r.node.exact, false);
  }
  assert.equal(parseHlasmStatement(symbol).node.exact, true);
  const [, , noType] = definition('&L       MYMAC &S', '&N       DC    &STRING');
  assert.match(parseHlasmStatement(noType).reason, /no nominal value|type/);
});
