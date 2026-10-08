// Programs with answers known by construction (bench/negatives.mjs): each guard's answer, and cobolwork's verdict on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineVerdict, items } from '../bench/negatives.mjs';
import './pin-machine.mjs';

const of = (rule, guard, placement) => items({ rule }).find((i) => i.guard === guard && i.placement === placement);

test('every program is within column 72 and every rule gets negatives and positives', () => {
  const all = items();
  for (const it of all) for (const [name, text] of Object.entries(it.files)) for (const l of text.split('\n')) assert.ok(l.length <= 72, `${it.id} ${name}: ${l}`);
  const byRule = Map.groupBy(all, (i) => i.rule);
  for (const [rule, list] of byRule) assert.ok(list.some((i) => i.truth === 'reaches') && list.some((i) => i.truth === 'does-not-reach'), rule);
});

test('an allow-list stops a command and is credited; with WHEN OTHER carrying on it is a finding', () => {
  assert.equal(engineVerdict(of('argv-or-env-to-os-command', 'allow-list', 'inline')), 'checked');
  assert.equal(engineVerdict(of('argv-or-env-to-os-command', 'otherwise-continues', 'inline')).startsWith('reported'), true);
  assert.equal(engineVerdict(of('argv-or-env-to-os-command', 'none', 'inline')), 'reported');
});

test('a guard only a person or a model sees is still a negative: an allow-list in a searched table', () => {
  const it = of('argv-or-env-to-os-command', 'table-search', 'inline');
  assert.equal(it.truth, 'does-not-reach');
  assert.equal(engineVerdict(it), 'reported');
});

test('a count or a length needs only its top kept, a subscript both ends', () => {
  assert.equal(of('argv-or-env-to-loop-bound', 'upper-bound-only', 'inline').truth, 'does-not-reach');
  assert.equal(of('argv-or-env-to-subscript', 'upper-bound-only', 'inline').truth, 'reaches');
});
