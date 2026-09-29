import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(join(HERE, '..', 'docs', 'spec', 'tui.md'), 'utf8');
const SUITES = ['tui.test.mjs', 'explain.test.mjs', 'tui-spec.test.mjs'];
const ID = /[TX]\d+\.\d+/;

test('T0.8 The spec and the suite name the same scenarios', () => {
  const specIds = [...SPEC.matchAll(/^#### ([TX]\d+\.\d+) /gm)].map((m) => m[1]);
  assert.ok(specIds.length > 10, 'the spec holds scenarios');
  assert.equal(new Set(specIds).size, specIds.length, 'no scenario id is used twice');
  const testIds = SUITES.flatMap((f) => [...readFileSync(join(HERE, f), 'utf8')
    .matchAll(new RegExp(`^test\\((['"])(${ID.source}) `, 'gm'))].map((m) => m[2]));
  assert.equal(new Set(testIds).size, testIds.length, 'no test id is used twice');
  assert.deepEqual(specIds.filter((id) => !testIds.includes(id)), [], 'every scenario has a test');
  assert.deepEqual(testIds.filter((id) => !specIds.includes(id)), [], 'every test has a scenario');
});
