// Splits a macro call into positional operands and keyword=value pairs (lib/hlasm/operands.mjs macroOperands).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { macroOperands } from '../lib/hlasm/operands.mjs';
import './pin-machine.mjs';

test('returns empty positional and keywords for an empty field', () => {
  const result = macroOperands('');
  assert.deepEqual(result, { positional: [], keywords: new Map() });
});

test('returns a single positional operand for a simple name', () => {
  const result = macroOperands('FOO');
  assert.deepEqual(result, { positional: ['FOO'], keywords: new Map() });
});

test('returns multiple positional operands separated by commas', () => {
  const result = macroOperands('FOO,BAR,BAZ');
  assert.deepEqual(result, { positional: ['FOO', 'BAR', 'BAZ'], keywords: new Map() });
});

test('parses a keyword operand with a simple value', () => {
  const result = macroOperands('NAME=VALUE');
  assert.deepEqual(result, { positional: [], keywords: new Map([['NAME', 'VALUE']]) });
});

test('parses multiple keyword operands', () => {
  const result = macroOperands('A=1,B=2,C=3');
  assert.deepEqual(result, { positional: [], keywords: new Map([['A', '1'], ['B', '2'], ['C', '3']]) });
});

test('parses mixed positional and keyword operands', () => {
  const result = macroOperands('FOO,BAR=BAZ,QUX');
  assert.deepEqual(result, { positional: ['FOO', 'QUX'], keywords: new Map([['BAR', 'BAZ']]) });
});

test('uppercases keyword names while preserving value case', () => {
  const result = macroOperands('name=VALUE');
  assert.deepEqual(result, { positional: [], keywords: new Map([['NAME', 'VALUE']]) });
});

test('treats a literal with equals sign as a positional operand', () => {
  const result = macroOperands("=F'1'");
  assert.deepEqual(result, { positional: ["=F'1'"], keywords: new Map() });
});

test('parses keyword with a quoted value containing an equals sign', () => {
  const result = macroOperands("KEY='A=B'");
  assert.deepEqual(result, { positional: [], keywords: new Map([['KEY', "'A=B'"]]) });
});

test('parses keyword with a parenthesized value', () => {
  const result = macroOperands('KEY=(A,B)');
  assert.deepEqual(result, { positional: [], keywords: new Map([['KEY', '(A,B)']]) });
});
