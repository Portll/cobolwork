// Parses gitleaks-mainframe.toml text into an array of rule objects with folded allowlists (lib/sets/secrets.mjs readToml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readToml } from '../lib/sets/secrets.mjs';
import './pin-machine.mjs';

test('returns an empty array for empty text', () => {
  assert.deepEqual(readToml(''), []);
});

test('ignores blank lines and comment lines', () => {
  const text = '\n   \n# a comment\n[[rules]]\n';
  assert.deepEqual(readToml(text), [{ allowlist: {} }]);
});

test('creates a rule entry for each [[rules]] header', () => {
  const text = '[[rules]]\n[[rules]]\n';
  assert.deepEqual(readToml(text), [{ allowlist: {} }, { allowlist: {} }]);
});

test('folds key-value pairs into the allowlist of the current rule', () => {
  const text = '[[rules]]\n[rules.allowlist]\npaths = ["a", "b"]\n';
  assert.deepEqual(readToml(text), [{ allowlist: { paths: ['a', 'b'] } }]);
});

test('parses double-quoted string values using JSON.parse', () => {
  const text = '[[rules]]\n[rules.allowlist]\nname = "hello"\n';
  assert.deepEqual(readToml(text), [{ allowlist: { name: 'hello' } }]);
});

test('parses triple-quoted string values by slicing delimiters', () => {
  const text = '[[rules]]\n[rules.allowlist]\nmsg = \'\'\'x\'\'\'\n';
  assert.deepEqual(readToml(text), [{ allowlist: { msg: 'x' } }]);
});

test('parses array values containing mixed quoted and triple-quoted strings', () => {
  const text = '[[rules]]\n[rules.allowlist]\nitems = [\'\'\'x\'\'\', "y"]\n';
  assert.deepEqual(readToml(text), [{ allowlist: { items: ['x', 'y'] } }]);
});

test('parses integer values as numbers', () => {
  const text = '[[rules]]\n[rules.allowlist]\nmax = 42\n';
  assert.deepEqual(readToml(text), [{ allowlist: { max: 42 } }]);
});

test('parses boolean values true and false', () => {
  const text = '[[rules]]\n[rules.allowlist]\na = true\nb = false\n';
  assert.deepEqual(readToml(text), [{ allowlist: { a: true, b: false } }]);
});

test('ignores key-value pairs when not inside an allowlist section', () => {
  const text = '[[rules]]\n[rules.allowlist]\nname = "kept"\n[other]\nname = "ignored"\n';
  assert.deepEqual(readToml(text), [{ allowlist: { name: 'kept' } }]);
});
