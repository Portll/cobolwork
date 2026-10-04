import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('ESTAE parses standard form with exit and CT', () => {
  const r = parse('         ESTAE EXIT,CT');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ESTAE');
  assert.equal(r.node.exit, 'EXIT');
  assert.equal(r.node.keywords.CT, undefined);
});

test('ESTAE parses with OV and keywords', () => {
  const r = parse('         ESTAE 0,OV,XCTL=YES');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.exit, '0');
  assert.equal(r.node.keywords.XCTL, 'YES');
});

test('ESTAE refuses unknown keyword', () => {
  const r = parse('         ESTAE EXIT,FOO=BAR');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unknown keyword FOO/);
});

test('ESPIE parses SET with exit and interruptions', () => {
  const r = parse('         ESPIE SET,EXIT,(1,4)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ESPIE');
  assert.equal(r.node.action, 'SET');
  assert.deepEqual(r.node.operands, ['EXIT', '(1,4)']);
});

test('ESPIE parses RESET', () => {
  const r = parse('         ESPIE RESET');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.action, 'RESET');
  assert.deepEqual(r.node.operands, []);
});

test('ESPIE refuses invalid action', () => {
  const r = parse('         ESPIE FOO');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /invalid action FOO/);
});

test('ABEND parses user code with DUMP', () => {
  const r = parse('         ABEND 432,DUMP');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'ABEND');
  assert.equal(r.node.code, '432');
  assert.equal(r.node.dump, true);
  assert.equal(r.node.step, false);
});

test('ABEND parses system code with STEP', () => {
  const r = parse("         ABEND X'0C4',,STEP");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.code, "X'0C4'");
  assert.equal(r.node.step, true);
});

test('ABEND parses register code', () => {
  const r = parse('         ABEND (5),,STEP');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.code, '(5)');
  assert.equal(r.node.step, true);
});

test('ABEND refuses an option IBM does not list', () => {
  const r = parse('         ABEND 100,BADOPT');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /BADOPT/);
});

test('SNAP parses with DCB and ID', () => {
  const r = parse('         SNAP DCB=SNAPDD,ID=1');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'SNAP');
  assert.equal(r.node.dcb, 'SNAPDD');
  assert.equal(r.node.keywords.ID, '1');
});

test('SNAP parses with STORAGE pairs', () => {
  const r = parse('         SNAP STORAGE=((R10),(R10))');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.dcb, null);
  assert.equal(r.node.keywords.STORAGE, '((R10),(R10))');
});

test('SNAP refuses unknown keyword', () => {
  const r = parse('         SNAP FOO=BAR');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unknown keyword FOO/);
});
