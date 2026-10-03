// Tokens extracted from embedded SQL statements (lib/embedded-sql.mjs sqlTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlTokens } from '../lib/embedded-sql.mjs';
import './pin-machine.mjs';

test('splits words, punctuation, literals and host variables in a simple SELECT', () => {
  const sql = "SELECT * FROM TABLE WHERE ID = :ID";
  const expected = [
    { word: 'SELECT' }, { word: '*' }, { word: 'FROM' }, { word: 'TABLE' },
    { word: 'WHERE' }, { word: 'ID' }, { word: '=' }, { host: 'ID' }
  ];
  assert.deepStrictEqual(sqlTokens(sql), expected);
});

test('captures single-quoted literals with escaped quotes', () => {
  const sql = "INSERT INTO T VALUES ('O''Reilly')";
  const expected = [
    { word: 'INSERT' }, { word: 'INTO' }, { word: 'T' }, { word: 'VALUES' },
    { word: '(' }, { lit: "'O''Reilly'" }, { word: ')' }
  ];
  assert.deepStrictEqual(sqlTokens(sql), expected);
});

test('captures double-quoted literals', () => {
  const sql = 'SET NAME = "John"';
  const expected = [
    { word: 'SET' }, { word: 'NAME' }, { word: '=' }, { lit: '"John"' }
  ];
  assert.deepStrictEqual(sqlTokens(sql), expected);
});

test('splits a qualified host variable and its indicator into separate host tokens', () => {
  const sql = ":GROUP.NAME:IND";
  const expected = [
    { host: 'GROUP.NAME' }, { host: 'IND' }
  ];
  assert.deepStrictEqual(sqlTokens(sql), expected);
});

test('trims whitespace after the colon in a host variable', () => {
  const sql = ":  var1";
  const expected = [
    { host: 'VAR1' }
  ];
  assert.deepStrictEqual(sqlTokens(sql), expected);
});

test('returns an empty array for an empty string', () => {
  assert.deepStrictEqual(sqlTokens(''), []);
});
