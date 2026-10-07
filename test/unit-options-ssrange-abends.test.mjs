// Computes whether the last SSRANGE setting in the option list abends on a bad index (lib/options.mjs ssrangeAbends).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ssrangeAbends } from '../lib/options.mjs';
import './pin-machine.mjs';

test('returns true when the last option is SSRANGE with no MSG', () => {
  assert.strictEqual(ssrangeAbends(['SSRANGE']), true);
});

test('returns false when the last SSRANGE option contains MSG', () => {
  assert.strictEqual(ssrangeAbends(['SSRANGE(MSG)']), false);
});

test('returns true when the last SSRANGE option contains ABD but not MSG', () => {
  assert.strictEqual(ssrangeAbends(['SSRANGE(ABD)']), true);
});

test('returns false when the last SSRANGE option contains both ABD and MSG', () => {
  assert.strictEqual(ssrangeAbends(['SSRANGE(ABD,MSG)']), false);
});

test('returns the result of the last SSRANGE option when earlier options are present', () => {
  assert.strictEqual(ssrangeAbends(['NUMCHECK', 'SSRANGE(ABD)']), true);
  assert.strictEqual(ssrangeAbends(['NUMCHECK', 'SSRANGE(MSG)']), false);
});

test('returns null when no SSRANGE option is present in the list', () => {
  assert.strictEqual(ssrangeAbends(['NUMCHECK', 'PARMCHECK']), null);
});
