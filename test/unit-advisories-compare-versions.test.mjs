// Dotted numeric version comparison with textual prerelease ordering (lib/advisories.mjs compareVersions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from '../lib/advisories.mjs';
import './pin-machine.mjs';

test('returns 0 when both versions are identical', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('returns 0 when trailing zeros are omitted', () => {
  assert.equal(compareVersions('3', '3.0'), 0);
});

test('returns -1 when the first version is numerically smaller', () => {
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
});

test('returns 1 when the first version is numerically larger', () => {
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
});

test('returns -1 when the first version has a textual prerelease tag', () => {
  assert.equal(compareVersions('3.1-rc1', '3.1'), -1);
});

test('returns 1 when the second version has a textual prerelease tag', () => {
  assert.equal(compareVersions('3.1', '3.1-rc1'), 1);
});

test('returns -1 when the first version is shorter and numerically smaller', () => {
  assert.equal(compareVersions('1.2', '1.2.1'), -1);
});

test('returns 1 when the first version is longer and numerically larger', () => {
  assert.equal(compareVersions('1.2.1', '1.2'), 1);
});

test('returns -1 when comparing two textual components lexicographically', () => {
  assert.equal(compareVersions('1.0-alpha', '1.0-beta'), -1);
});

test('returns 1 when comparing two textual components lexicographically in reverse', () => {
  assert.equal(compareVersions('1.0-beta', '1.0-alpha'), 1);
});
