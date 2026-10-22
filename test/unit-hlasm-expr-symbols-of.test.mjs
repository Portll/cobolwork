// Collects the unqualified symbol names referenced by an expression AST (lib/hlasm/expr.mjs symbolsOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbolsOf } from '../lib/hlasm/expr.mjs';
import './pin-machine.mjs';

test('returns an empty array for a null input', () => {
  assert.deepEqual(symbolsOf(null), []);
});

test('returns the name for a simple symbol node', () => {
  assert.deepEqual(symbolsOf({ t: 'sym', name: 'FOO' }), ['FOO']);
});

test('returns the name for a qualified symbol node', () => {
  assert.deepEqual(symbolsOf({ t: 'sym', qualifier: 'Q', name: 'BAR' }), ['BAR']);
});

test('recurses into the operand of an attribute node', () => {
  assert.deepEqual(symbolsOf({ t: 'attr', attr: 'L', of: { t: 'sym', name: 'X' } }), ['X']);
});

test('recurses into the inner expression of a paren node', () => {
  assert.deepEqual(symbolsOf({ t: 'paren', e: { t: 'sym', name: 'Y' } }), ['Y']);
});

test('recurses into the operand of a unary node', () => {
  assert.deepEqual(symbolsOf({ t: 'unary', op: '-', e: { t: 'sym', name: 'Z' } }), ['Z']);
});

test('collects symbols from both sides of a binary node', () => {
  assert.deepEqual(symbolsOf({ t: 'bin', op: '+', l: { t: 'sym', name: 'A' }, r: { t: 'sym', name: 'B' } }), ['A', 'B']);
});

test('collects symbols from a nested binary tree in left-to-right order', () => {
  const e = { t: 'bin', op: '+', l: { t: 'sym', name: 'A' }, r: { t: 'bin', op: '*', l: { t: 'sym', name: 'B' }, r: { t: 'sym', name: 'C' } } };
  assert.deepEqual(symbolsOf(e), ['A', 'B', 'C']);
});

test('ignores numeric and literal nodes', () => {
  assert.deepEqual(symbolsOf({ t: 'num', v: 42 }), []);
  assert.deepEqual(symbolsOf({ t: 'lit', dc: 'X' }), []);
});

test('appends to the provided output array', () => {
  const out = ['PRE'];
  const result = symbolsOf({ t: 'sym', name: 'POST' }, out);
  assert.deepEqual(result, ['PRE', 'POST']);
  assert.deepEqual(out, ['PRE', 'POST']);
});
