import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('PRINT parses valid options', () => {
  const r = parse("         PRINT NOGEN");
  assert.equal(r.status, 'parsed');
  assert.deepEqual(r.node, { kind: 'PRINT', options: ['NOGEN'] });
});

test('PRINT refuses unknown option', () => {
  const r = parse("         PRINT BADOPT");
  assert.equal(r.status, 'unparsed');
});

test('TITLE parses quoted string', () => {
  const r = parse("         TITLE 'ADA01 - REFORMAT BIRTHDAY PASSED VIA COMMAREA'");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'TITLE');
  assert.equal(r.node.text, 'ADA01 - REFORMAT BIRTHDAY PASSED VIA COMMAREA');
});

test('TITLE refuses unquoted operand', () => {
  const r = parse("         TITLE BADTITLE");
  assert.equal(r.status, 'unparsed');
});

test('EJECT parses with no operand', () => {
  const r = parse("         EJECT");
  assert.equal(r.status, 'parsed');
  assert.deepEqual(r.node, { kind: 'EJECT', value: null });
});

test('EJECT refuses operand', () => {
  const r = parse("         EJECT 1");
  assert.equal(r.status, 'unparsed');
});

test('SPACE parses expression', () => {
  const r = parse("         SPACE  3");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'SPACE');
  assert.deepEqual(r.node.value, { t: 'num', v: 3 });
});

test('SPACE refuses multiple operands', () => {
  const r = parse("         SPACE 1,2");
  assert.equal(r.status, 'unparsed');
});

test('CEJECT parses with no operand', () => {
  const r = parse("         CEJECT");
  assert.equal(r.status, 'parsed');
  assert.deepEqual(r.node, { kind: 'CEJECT', value: null });
});

test('CEJECT refuses multiple operands', () => {
  const r = parse("         CEJECT 1,2");
  assert.equal(r.status, 'unparsed');
});
