// Compiles pack rules into regex objects and metadata (lib/packs.mjs compilePack).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePack } from '../lib/packs.mjs';
import './pin-machine.mjs';

test('returns empty array when pack has no rules', () => {
  const pack = { name: 'test', vendor: 'v', product: 'p' };
  assert.deepStrictEqual(compilePack(pack), []);
});

test('compiles a single rule with default flags and appliesTo', () => {
  const pack = {
    name: 'alpha',
    vendor: 'v',
    product: 'p',
    rules: [
      { pattern: '^ABC', flags: 'g' }
    ]
  };
  const result = compilePack(pack);
  assert.strictEqual(result.length, 1);
  const r = result[0];
  assert.strictEqual(r.pattern, '^ABC');
  assert.strictEqual(r.flags, 'g');
  assert.strictEqual(r.pack, 'alpha');
  assert.strictEqual(r.vendor, 'v');
  assert.strictEqual(r.product, 'p');
  assert.deepStrictEqual(r.appliesTo, ['jcl-instream']);
  assert.strictEqual(r.re.source, '^ABC');
  assert.strictEqual(r.re.flags, 'g');
  assert.strictEqual(r.setsContextRe, null);
});

test('uses default flags "i" when none provided', () => {
  const pack = {
    name: 'beta',
    vendor: 'v',
    product: 'p',
    rules: [
      { pattern: 'foo' }
    ]
  };
  const r = compilePack(pack)[0];
  assert.strictEqual(r.re.flags, 'i');
});

test('appliesTo defaults to ["jcl-instream"] when omitted', () => {
  const pack = {
    name: 'gamma',
    vendor: 'v',
    product: 'p',
    rules: [
      { pattern: 'bar', flags: 'm' }
    ]
  };
  const r = compilePack(pack)[0];
  assert.deepStrictEqual(r.appliesTo, ['jcl-instream']);
});

test('creates setsContextRe when setsContext and setsContextPattern are present', () => {
  const pack = {
    name: 'delta',
    vendor: 'v',
    product: 'p',
    rules: [
      { pattern: 'x', setsContext: true, setsContextPattern: 'y' }
    ]
  };
  const r = compilePack(pack)[0];
  assert.strictEqual(r.setsContextRe.source, 'y');
  assert.strictEqual(r.setsContextRe.flags, 'i');
});

test('setsContextRe is null when setsContext is false', () => {
  const pack = {
    name: 'epsilon',
    vendor: 'v',
    product: 'p',
    rules: [
      { pattern: 'z', setsContext: false, setsContextPattern: 'w' }
    ]
  };
  const r = compilePack(pack)[0];
  assert.strictEqual(r.setsContextRe, null);
});

test('handles multiple rules with mixed properties', () => {
  const pack = {
    name: 'zeta',
    vendor: 'v',
    product: 'p',
    rules: [
      { pattern: 'a', flags: 'g', appliesTo: ['stream1'] },
      { pattern: 'b', setsContext: true, setsContextPattern: 'c' }
    ]
  };
  const res = compilePack(pack);
  assert.strictEqual(res.length, 2);
  const [r1, r2] = res;
  assert.deepStrictEqual(r1.appliesTo, ['stream1']);
  assert.strictEqual(r1.re.flags, 'g');
  assert.strictEqual(r2.setsContextRe.source, 'c');
  assert.strictEqual(r2.setsContextRe.flags, 'i');
});
