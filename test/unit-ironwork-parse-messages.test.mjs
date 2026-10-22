// Parses ironwork diagnostic JSON lines into structured message objects (lib/ironwork.mjs parseMessages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMessages } from '../lib/ironwork.mjs';
import './pin-machine.mjs';

test('returns empty array for empty stderr', () => {
  assert.deepEqual(parseMessages('', { root: '/r', program: '/r/p.cob' }), []);
});

test('returns empty array for null stderr', () => {
  assert.deepEqual(parseMessages(null, { root: '/r', program: '/r/p.cob' }), []);
});

test('parses valid diagnostic with all fields', () => {
  const line = JSON.stringify({ id: 'E001', severity: 'E', message: 'err', line: 10, col: 5, member: '/r/m.cpy' });
  const res = parseMessages(line, { root: '/r', program: '/r/p.cob' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'E001');
  assert.equal(res[0].severity, 'E');
  assert.equal(res[0].text, 'err');
  assert.equal(res[0].path, 'm.cpy');
  assert.equal(res[0].member, 'm.cpy');
  assert.equal(res[0].line, 10);
  assert.equal(res[0].col, 5);
  assert.equal(res[0].file, '/r/m.cpy');
});

test('parses diagnostic without member', () => {
  const line = JSON.stringify({ id: 'W001', severity: 'W', message: 'warn', line: 3, col: 2 });
  const res = parseMessages(line, { root: '/r', program: '/r/p.cob' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, 'W001');
  assert.equal(res[0].severity, 'W');
  assert.equal(res[0].path, 'p.cob');
  assert.equal(res[0].line, 3);
  assert.equal(res[0].col, 2);
  assert.equal(res[0].file, '/r/p.cob');
  assert.equal(res[0].member, undefined);
});

test('handles non-diagnostic line as plain text', () => {
  const res = parseMessages('some plain text', { root: '/r', program: '/r/p.cob' });
  assert.equal(res.length, 1);
  assert.equal(res[0].id, null);
  assert.equal(res[0].severity, null);
  assert.equal(res[0].text, 'some plain text');
  assert.equal(res[0].path, 'p.cob');
  assert.equal(res[0].line, null);
  assert.equal(res[0].col, null);
  assert.equal(res[0].file, null);
});

test('redacts quoted strings in message text', () => {
  const line = JSON.stringify({ id: 'E002', severity: 'E', message: 'found "bad" here', line: 1, col: 1 });
  const res = parseMessages(line, { root: '/r', program: '/r/p.cob' });
  assert.equal(res[0].text, 'found \'\u2026\' here');
});

test('sets severity to null for invalid severity value', () => {
  const line = JSON.stringify({ id: 'X001', severity: 'Z', message: 'msg', line: 1, col: 1 });
  const res = parseMessages(line, { root: '/r', program: '/r/p.cob' });
  assert.equal(res[0].severity, null);
});

test('sets line to null when line is zero or negative', () => {
  const line = JSON.stringify({ id: 'E003', severity: 'E', message: 'msg', line: 0, col: 5 });
  const res = parseMessages(line, { root: '/r', program: '/r/p.cob' });
  assert.equal(res[0].line, null);
  assert.equal(res[0].col, null);
});

test('sets col to null when line is null even if col is valid', () => {
  const line = JSON.stringify({ id: 'E004', severity: 'E', message: 'msg', line: -1, col: 10 });
  const res = parseMessages(line, { root: '/r', program: '/r/p.cob' });
  assert.equal(res[0].line, null);
  assert.equal(res[0].col, null);
});

test('handles multiple lines with mixed content', () => {
  const l1 = JSON.stringify({ id: 'E001', severity: 'E', message: 'first', line: 1, col: 1 });
  const l2 = 'plain line';
  const l3 = JSON.stringify({ id: 'W001', severity: 'W', message: 'second', line: 2, col: 2 });
  const res = parseMessages(`${l1}\n${l2}\n${l3}`, { root: '/r', program: '/r/p.cob' });
  assert.equal(res.length, 3);
  assert.equal(res[0].id, 'E001');
  assert.equal(res[1].id, null);
  assert.equal(res[2].id, 'W001');
});
