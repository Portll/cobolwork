// Builds the sorted rule, practice, and compiler advice catalogue (lib/advice.mjs catalogue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogue } from '../lib/advice.mjs';
import './pin-machine.mjs';

test('catalogue returns an object with rules, practices, and compiler arrays', () => {
  const result = catalogue();
  assert.ok(Array.isArray(result.rules));
  assert.ok(Array.isArray(result.practices));
  assert.ok(Array.isArray(result.compiler));
});

test('catalogue sorts rules by id in ascending locale order', () => {
  const result = catalogue();
  const ids = result.rules.map(r => r.id);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(ids, sorted);
});

test('catalogue sorts practices by id in ascending locale order', () => {
  const result = catalogue();
  const ids = result.practices.map(p => p.id);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(ids, sorted);
});

test('catalogue sorts compiler messages by id in ascending locale order', () => {
  const result = catalogue([
    { id: 'z-msg', text: 'Z' },
    { id: 'a-msg', text: 'A' },
    { id: 'm-msg', text: 'M' }
  ]);
  assert.deepEqual(result.compiler.map(c => c.id), ['a-msg', 'm-msg', 'z-msg']);
});

test('catalogue compiler array is empty when no messages provided', () => {
  const result = catalogue();
  assert.deepEqual(result.compiler, []);
});

test('catalogue compiler array is empty when empty array provided', () => {
  const result = catalogue([]);
  assert.deepEqual(result.compiler, []);
});

test('catalogue compiler messages preserve original object references', () => {
  const msg1 = { id: 'b-msg', text: 'B' };
  const msg2 = { id: 'a-msg', text: 'A' };
  const result = catalogue([msg1, msg2]);
  assert.strictEqual(result.compiler[0], msg2);
  assert.strictEqual(result.compiler[1], msg1);
});

test('catalogue includes inventory practices in the practices array', () => {
  const result = catalogue();
  const ids = result.practices.map(p => p.id);
  assert.ok(ids.includes('inventory-missing-copybook'));
  assert.ok(ids.includes('inventory-recursive-copybook'));
  assert.ok(ids.includes('inventory-unreadable-source'));
  assert.ok(ids.includes('inventory-ebcdic-source'));
});

test('catalogue rule entries have required fields', () => {
  const result = catalogue();
  for (const rule of result.rules) {
    assert.ok(typeof rule.id === 'string');
    assert.ok(typeof rule.set === 'string');
    assert.ok(typeof rule.sev === 'string');
    assert.ok(typeof rule.evidence === 'string');
    assert.ok(typeof rule.text === 'string');
    assert.ok(Array.isArray(rule.steps));
    assert.ok(Array.isArray(rule.references));
    assert.ok(rule.compliance !== undefined);
  }
});

test('catalogue practice entries have required fields', () => {
  const result = catalogue();
  for (const practice of result.practices) {
    assert.ok(typeof practice.id === 'string');
    assert.ok(typeof practice.class === 'string');
    assert.ok(typeof practice.sev === 'string');
    assert.ok(typeof practice.text === 'string');
    assert.ok(Array.isArray(practice.steps));
    assert.ok(Array.isArray(practice.references));
    assert.ok(practice.compliance !== undefined);
  }
});
