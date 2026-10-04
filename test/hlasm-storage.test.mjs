import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('STORAGE parses OBTAIN with LENGTH and ADDR', () => {
  const res = parse('         STORAGE OBTAIN,LENGTH=100,ADDR=(1)');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.request, 'OBTAIN');
  assert.equal(res.node.length, '100');
  assert.equal(res.node.address, '(1)');
  assert.equal(res.node.subpool, null);
  assert.equal(res.node.key, null);
  assert.equal(res.node.cond, null);
});

test('STORAGE parses RELEASE with SP and KEY', () => {
  const res = parse('         STORAGE RELEASE,SP=1,KEY=9');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.request, 'RELEASE');
  assert.equal(res.node.subpool, '1');
  assert.equal(res.node.key, '9');
});

test('STORAGE refuses invalid request type', () => {
  const res = parse('         STORAGE INVALID');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /STORAGE request must be OBTAIN or RELEASE/);
});

test('STORAGE refuses unknown keyword', () => {
  const res = parse('         STORAGE OBTAIN,FOO=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /STORAGE does not accept keyword FOO/);
});

test('GETMAIN parses R with LV', () => {
  const res = parse('         GETMAIN R,LV=WORKLEN');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.mode, 'R');
  assert.equal(res.node.length, 'WORKLEN');
  assert.equal(res.node.address, null);
  assert.equal(res.node.subpool, null);
});

test('GETMAIN parses RU with LV and SP', () => {
  const res = parse('         GETMAIN RU,LV=WORKAREA_LEN,SP=1');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.mode, 'RU');
  assert.equal(res.node.length, 'WORKAREA_LEN');
  assert.equal(res.node.subpool, '1');
});

test('GETMAIN refuses invalid request type', () => {
  const res = parse('         GETMAIN XX,LV=100');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /GETMAIN request type must be one of/);
});

test('GETMAIN refuses unknown keyword', () => {
  const res = parse('         GETMAIN R,LV=100,FOO=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /GETMAIN does not accept keyword FOO/);
});

test('FREEMAIN parses R with LV and A', () => {
  const res = parse('         FREEMAIN R,LV=WORKLEN,A=(1)');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.mode, 'R');
  assert.equal(res.node.length, 'WORKLEN');
  assert.equal(res.node.address, '(1)');
  assert.equal(res.node.subpool, null);
});

test('FREEMAIN parses RU with A and LV', () => {
  const res = parse('         FREEMAIN RU,A=(R6),LV=(R7)');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.mode, 'RU');
  assert.equal(res.node.address, '(R6)');
  assert.equal(res.node.length, '(R7)');
});

test('FREEMAIN refuses invalid request type', () => {
  const res = parse('         FREEMAIN XX,LV=100');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /FREEMAIN request type must be one of/);
});

test('FREEMAIN refuses unknown keyword', () => {
  const res = parse('         FREEMAIN R,LV=100,FOO=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /FREEMAIN does not accept keyword FOO/);
});
