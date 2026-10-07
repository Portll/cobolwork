// Which host variables a statement reads and which it writes (lib/embedded-sql.mjs hostVariableRoles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostVariableRoles } from '../lib/embedded-sql.mjs';
import './pin-machine.mjs';

test('SELECT INTO writes the host variable', () => {
  assert.deepEqual(hostVariableRoles('SELECT A INTO :X FROM T'), { sending: [], receiving: ['X'] });
});

test('SELECT without INTO reads the host variable', () => {
  assert.deepEqual(hostVariableRoles('SELECT A FROM T WHERE A = :X'), { sending: ['X'], receiving: [] });
});

test('INSERT INTO reads the host variable', () => {
  assert.deepEqual(hostVariableRoles('INSERT INTO T (A) VALUES (:X)'), { sending: ['X'], receiving: [] });
});

test('UPDATE SET reads the host variable', () => {
  assert.deepEqual(hostVariableRoles('UPDATE T SET A = :X'), { sending: ['X'], receiving: [] });
});

test('UPDATE SET reads the host variable in WHERE', () => {
  assert.deepEqual(hostVariableRoles('UPDATE T SET A = 1 WHERE B = :X'), { sending: ['X'], receiving: [] });
});

test('DELETE reads the host variable in WHERE', () => {
  assert.deepEqual(hostVariableRoles('DELETE FROM T WHERE A = :X'), { sending: ['X'], receiving: [] });
});

test('CALL reads and writes a lone host variable argument', () => {
  assert.deepEqual(hostVariableRoles('CALL P(:X)'), { sending: ['X'], receiving: ['X'] });
});

test('CALL reads a host variable in an expression argument', () => {
  assert.deepEqual(hostVariableRoles('CALL P(:X + 1)'), { sending: ['X'], receiving: [] });
});

test('GET DIAGNOSTICS writes the host variable', () => {
  assert.deepEqual(hostVariableRoles('GET DIAGNOSTICS :X = SQLCODE'), { sending: [], receiving: ['X'] });
});

test('ASSOCIATE LOCATORS writes the host variable', () => {
  assert.deepEqual(hostVariableRoles('ASSOCIATE LOCATORS :X WITH CURSOR C'), { sending: [], receiving: ['X'] });
});
