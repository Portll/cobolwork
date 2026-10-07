// Checks whether a version string satisfies a version expression (lib/advisories.mjs versionMatches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionMatches } from '../lib/advisories.mjs';
import './pin-machine.mjs';

test('exact match returns true', () => {
  assert.equal(versionMatches('1.2.3', '1.2.3'), true);
});

test('exact mismatch returns false', () => {
  assert.equal(versionMatches('1.2.3', '1.2.4'), false);
});

test('greater than operator works', () => {
  assert.equal(versionMatches('2.0.0', '>1.0.0'), true);
});

test('greater than or equal operator works', () => {
  assert.equal(versionMatches('1.0.0', '>=1.0.0'), true);
});

test('less than operator works', () => {
  assert.equal(versionMatches('0.9.0', '<1.0.0'), true);
});

test('less than or equal operator works', () => {
  assert.equal(versionMatches('1.0.0', '<=1.0.0'), true);
});

test('closed interval includes boundaries', () => {
  assert.equal(versionMatches('1.0.0', '[1.0.0,2.0.0]'), true);
  assert.equal(versionMatches('2.0.0', '[1.0.0,2.0.0]'), true);
});

test('half-open interval excludes upper bound', () => {
  assert.equal(versionMatches('1.0.0', '[1.0.0,2.0.0)'), true);
  assert.equal(versionMatches('2.0.0', '[1.0.0,2.0.0)'), false);
});

test('multiple expressions with OR work', () => {
  assert.equal(versionMatches('1.0.0', '1.0.0||2.0.0'), true);
  assert.equal(versionMatches('3.0.0', '1.0.0||2.0.0'), false);
});
