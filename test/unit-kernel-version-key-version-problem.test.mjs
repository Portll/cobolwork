// Why a document cannot be read, or null when it can (lib/kernel/version-key.mjs versionProblem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionProblem } from '../lib/kernel/version-key.mjs';
import './pin-machine.mjs';

test('returns null when version is 0 and current is 0', () => {
  assert.equal(versionProblem({ version: 0 }, 0), null);
});

test('returns null when version is 1 and current is 1', () => {
  assert.equal(versionProblem({ version: 1 }, 1), null);
});

test('returns null when version is 2 and current is 5', () => {
  assert.equal(versionProblem({ version: 2 }, 5), null);
});

test('returns upgrade message when version is 6 and current is 5', () => {
  assert.equal(versionProblem({ version: 6 }, 5), 'is version 6, and this cobolwork reads up to version 5; upgrade cobolwork');
});

test('returns upgrade message when version is 100 and current is 99', () => {
  assert.equal(versionProblem({ version: 100 }, 99), 'is version 100, and this cobolwork reads up to version 99; upgrade cobolwork');
});

test('returns not whole number message when version is 1.5', () => {
  assert.equal(versionProblem({ version: 1.5 }, 5), 'has version 1.5, which is not a whole number from 0');
});

test('returns not whole number message when version is -1', () => {
  assert.equal(versionProblem({ version: -1 }, 5), 'has version -1, which is not a whole number from 0');
});

test('returns not whole number message when version is undefined', () => {
  assert.equal(versionProblem({}, 5), null);
});

test('returns not whole number message when version is NaN', () => {
  assert.equal(versionProblem({ version: NaN }, 5), 'has version null, which is not a whole number from 0');
});

test('returns not whole number message when version is Infinity', () => {
  assert.equal(versionProblem({ version: Infinity }, 5), 'has version null, which is not a whole number from 0');
});
