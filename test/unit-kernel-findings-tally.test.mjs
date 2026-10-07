// Counts findings per rule (lib/kernel/findings.mjs tally).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../lib/kernel/findings.mjs';
import './pin-machine.mjs';

test('returns an empty object for an empty array', () => {
  assert.deepEqual(tally([]), {});
});

test('counts a single finding under its rule', () => {
  assert.deepEqual(tally([{ rule: 'R1' }]), { R1: 1 });
});

test('increments the count for repeated rules', () => {
  assert.deepEqual(tally([{ rule: 'R1' }, { rule: 'R1' }]), { R1: 2 });
});

test('tracks distinct rules independently', () => {
  assert.deepEqual(tally([{ rule: 'A' }, { rule: 'B' }]), { A: 1, B: 1 });
});

test('aggregates mixed rules in one pass', () => {
  assert.deepEqual(
    tally([{ rule: 'X' }, { rule: 'Y' }, { rule: 'X' }, { rule: 'Z' }, { rule: 'Y' }]),
    { X: 2, Y: 2, Z: 1 }
  );
});

test('handles rules that are not strings', () => {
  assert.deepEqual(tally([{ rule: 42 }, { rule: 42 }, { rule: null }]), { 42: 2, null: 1 });
});

test('ignores extra properties on finding objects', () => {
  assert.deepEqual(tally([{ rule: 'R', line: 10, msg: 'oops' }]), { R: 1 });
});

test('works with a large number of findings', () => {
  const findings = Array.from({ length: 100 }, (_, i) => ({ rule: i % 3 === 0 ? 'A' : 'B' }));
  const result = tally(findings);
  assert.equal(result.A, 34);
  assert.equal(result.B, 66);
});
