// Validates pack structure and rule scopes (lib/packs.mjs packProblems).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packProblems } from '../lib/packs.mjs';
import './pin-machine.mjs';

test('returns empty array for valid pack with no rules', () => {
  const pack = { name: 'test-pack', rules: [] };
  assert.deepEqual(packProblems(pack), []);
});

test('returns error when rules is not an array', () => {
  const pack = { name: 'test-pack', rules: 'not-an-array' };
  assert.deepEqual(packProblems(pack), ['test-pack: rules must be an array of objects, each with a pattern']);
});

test('returns error when rules contains non-object element', () => {
  const pack = { name: 'test-pack', rules: ['string-rule'] };
  assert.deepEqual(packProblems(pack), ['test-pack: rules must be an array of objects, each with a pattern']);
});

test('returns error when rule lacks pattern property', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1' }] };
  assert.deepEqual(packProblems(pack), ['test-pack: rules must be an array of objects, each with a pattern']);
});

test('returns error when rule pattern is not a string', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: 123 }] };
  assert.deepEqual(packProblems(pack), ['test-pack: rules must be an array of objects, each with a pattern']);
});

test('returns error when appliesTo contains non-string element', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: 'test', appliesTo: ['jcl-instream', 42] }] };
  assert.deepEqual(packProblems(pack), ['test-pack: rules must be an array of objects, each with a pattern']);
});

test('returns error for unknown scope in appliesTo', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: 'test', appliesTo: ['invalid-scope'] }] };
  assert.deepEqual(packProblems(pack), ['test-pack:r1: unknown scope \'invalid-scope\'']);
});

test('returns error when appliesTo is empty array', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: 'test', appliesTo: [] }] };
  assert.deepEqual(packProblems(pack), ['test-pack:r1: no scope, so it can never match anything']);
});

test('returns error for invalid regular expression pattern', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: '[invalid', appliesTo: ['jcl-instream'] }] };
  const result = packProblems(pack);
  assert.equal(result.length, 1);
  assert.ok(result[0].startsWith('test-pack:r1:'));
  assert.ok(result[0].includes('Unterminated character class'));
});

test('returns error when setsContext is true but setsContextPattern is missing', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: 'test', setsContext: true }] };
  assert.deepEqual(packProblems(pack), ['test-pack:r1: setsContext without a pattern that sets it']);
});

test('returns error when setsContextPattern is invalid regular expression', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: 'test', setsContext: true, setsContextPattern: '[bad' }] };
  const result = packProblems(pack);
  assert.equal(result.length, 1);
  assert.ok(result[0].startsWith('test-pack:r1: setsContextPattern'));
  assert.ok(result[0].includes('Unterminated character class'));
});

test('returns error when requiresContext references context not set by any rule', () => {
  const pack = { name: 'test-pack', rules: [{ id: 'r1', pattern: 'test', requiresContext: 'missing-context' }] };
  assert.deepEqual(packProblems(pack), ['test-pack:r1: requires context \'missing-context\' that no rule in this pack sets']);
});

test('returns empty array when requiresContext is set by another rule in pack', () => {
  const pack = {
    name: 'test-pack',
    rules: [
      { id: 'r1', pattern: 'test', setsContext: 'ctx', setsContextPattern: 'ctx-pattern' },
      { id: 'r2', pattern: 'test2', requiresContext: 'ctx' }
    ]
  };
  assert.deepEqual(packProblems(pack), []);
});

test('returns error when programs is not an array of strings', () => {
  const pack = { name: 'test-pack', programs: ['valid', 123] };
  assert.deepEqual(packProblems(pack), ['test-pack: programs must be an array of names']);
});

test('returns empty array for valid pack with multiple rules and valid scopes', () => {
  const pack = {
    name: 'test-pack',
    rules: [
      { id: 'r1', pattern: 'test1', appliesTo: ['jcl-step'] },
      { id: 'r2', pattern: 'test2', appliesTo: ['jcl-instream'] },
      { id: 'r3', pattern: 'test3', appliesTo: ['jcl-step', 'jcl-instream'] }
    ]
  };
  assert.deepEqual(packProblems(pack), []);
});
