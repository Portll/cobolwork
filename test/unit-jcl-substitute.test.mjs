// Symbolic substitution of &NAME tokens in JCL text (lib/jcl.mjs substitute).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { substitute } from '../lib/jcl.mjs';
import './pin-machine.mjs';

test('returns text unchanged when no ampersand is present', () => {
  const result = substitute('HELLO WORLD', new Map([['A', '1']]));
  assert.deepEqual(result, { text: 'HELLO WORLD', unresolved: [] });
});

test('replaces a simple symbolic reference with its value', () => {
  const symbols = new Map([['NAME', 'JOHN']]);
  const result = substitute('USER &NAME', symbols);
  assert.deepEqual(result, { text: 'USER JOHN', unresolved: [] });
});

test('treats double ampersand as a literal ampersand', () => {
  const symbols = new Map([['A', '1']]);
  const result = substitute('&&', symbols);
  assert.deepEqual(result, { text: '&&', unresolved: [] });
});

test('consumes trailing dot after symbolic reference', () => {
  const symbols = new Map([['PREFIX', 'MY']]);
  const result = substitute('&PREFIX..DATA', symbols);
  assert.deepEqual(result, { text: 'MY.DATA', unresolved: [] });
});

test('records unresolved symbols and leaves them intact', () => {
  const symbols = new Map([['A', '1']]);
  const result = substitute('&UNKNOWN', symbols);
  assert.deepEqual(result, { text: '&UNKNOWN', unresolved: ['UNKNOWN'] });
});

test('matches symbolic references case-insensitively', () => {
  const symbols = new Map([['NAME', 'JOHN']]);
  const result = substitute('&name', symbols);
  assert.deepEqual(result, { text: 'JOHN', unresolved: [] });
});

test('supports special characters in symbolic names', () => {
  const symbols = new Map([['$VAR', '42']]);
  const result = substitute('&$VAR', symbols);
  assert.deepEqual(result, { text: '42', unresolved: [] });
});

test('handles maximum length symbolic name of eight characters', () => {
  const symbols = new Map([['ABCDEFGH', 'VALUE']]);
  const result = substitute('&ABCDEFGH', symbols);
  assert.deepEqual(result, { text: 'VALUE', unresolved: [] });
});

test('leaves ampersand followed by non-name character unchanged', () => {
  const symbols = new Map([['A', '1']]);
  const result = substitute('&1', symbols);
  assert.deepEqual(result, { text: '&1', unresolved: [] });
});

test('processes multiple symbolic references in one text', () => {
  const symbols = new Map([['A', '1'], ['B', '2']]);
  const result = substitute('&A and &B', symbols);
  assert.deepEqual(result, { text: '1 and 2', unresolved: [] });
});
