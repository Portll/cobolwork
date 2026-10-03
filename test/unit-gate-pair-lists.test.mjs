// Pairing of base and head lists by fingerprint, scope, and route (lib/gate.mjs pairLists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairLists } from '../lib/gate.mjs';
import './pin-machine.mjs';

test('empty lists return empty arrays', () => {
  const { headOf, baseOf, level } = pairLists([], [], [], []);
  assert.deepEqual(headOf, []);
  assert.deepEqual(baseOf, []);
  assert.deepEqual(level, []);
});

test('fingerprint match pairs base and head at level fingerprint', () => {
  const base = [{ fingerprint: 'fp1' }, { fingerprint: 'fp2' }];
  const head = [{ fingerprint: 'fp1' }, { fingerprint: 'fp2' }];
  const baseKeys = [{ scope: 's1', route: 'r1' }, { scope: 's2', route: 'r2' }];
  const headKeys = [{ scope: 's1', route: 'r1' }, { scope: 's2', route: 'r2' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [0, 1]);
  assert.deepEqual(baseOf, [0, 1]);
  assert.deepEqual(level, ['fingerprint', 'fingerprint']);
});

test('scope match pairs when fingerprints differ', () => {
  const base = [{ fingerprint: 'fp1' }, { fingerprint: 'fp2' }];
  const head = [{ fingerprint: 'fpX' }, { fingerprint: 'fpY' }];
  const baseKeys = [{ scope: 's1', route: 'r1' }, { scope: 's2', route: 'r2' }];
  const headKeys = [{ scope: 's1', route: 'r1' }, { scope: 's2', route: 'r2' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [0, 1]);
  assert.deepEqual(baseOf, [0, 1]);
  assert.deepEqual(level, ['scope', 'scope']);
});

test('route match pairs when fingerprints and scopes differ', () => {
  const base = [{ fingerprint: 'fp1' }, { fingerprint: 'fp2' }];
  const head = [{ fingerprint: 'fpX' }, { fingerprint: 'fpY' }];
  const baseKeys = [{ scope: 's1', route: 'r1' }, { scope: 's2', route: 'r2' }];
  const headKeys = [{ scope: 'sX', route: 'r1' }, { scope: 'sY', route: 'r2' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [0, 1]);
  assert.deepEqual(baseOf, [0, 1]);
  assert.deepEqual(level, ['route', 'route']);
});

test('unmatched items remain -1 in headOf and baseOf', () => {
  const base = [{ fingerprint: 'fp1' }];
  const head = [{ fingerprint: 'fpX' }];
  const baseKeys = [{ scope: 's1', route: 'r1' }];
  const headKeys = [{ scope: 'sX', route: 'rX' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [-1]);
  assert.deepEqual(baseOf, [-1]);
  assert.deepEqual(level, [null]);
});

test('fingerprint takes precedence over scope and route', () => {
  const base = [{ fingerprint: 'fp1' }, { fingerprint: 'fp2' }];
  const head = [{ fingerprint: 'fp1' }, { fingerprint: 'fp2' }];
  const baseKeys = [{ scope: 's1', route: 'r1' }, { scope: 's2', route: 'r2' }];
  const headKeys = [{ scope: 's2', route: 'r2' }, { scope: 's1', route: 'r1' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [0, 1]);
  assert.deepEqual(baseOf, [0, 1]);
  assert.deepEqual(level, ['fingerprint', 'fingerprint']);
});

test('scope takes precedence over route when fingerprint absent', () => {
  const base = [{ fingerprint: null }, { fingerprint: null }];
  const head = [{ fingerprint: null }, { fingerprint: null }];
  const baseKeys = [{ scope: 's1', route: 'r1' }, { scope: 's2', route: 'r2' }];
  const headKeys = [{ scope: 's1', route: 'r2' }, { scope: 's2', route: 'r1' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [0, 1]);
  assert.deepEqual(baseOf, [0, 1]);
  assert.deepEqual(level, ['scope', 'scope']);
});

test('multiple base items with same key pair in order with head items', () => {
  const base = [{ fingerprint: 'fp1' }, { fingerprint: 'fp1' }, { fingerprint: 'fp1' }];
  const head = [{ fingerprint: 'fp1' }, { fingerprint: 'fp1' }];
  const baseKeys = [{ scope: 's1', route: 'r1' }, { scope: 's1', route: 'r1' }, { scope: 's1', route: 'r1' }];
  const headKeys = [{ scope: 's1', route: 'r1' }, { scope: 's1', route: 'r1' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [0, 1, -1]);
  assert.deepEqual(baseOf, [0, 1]);
  assert.deepEqual(level, ['fingerprint', 'fingerprint', null]);
});

test('null fingerprint and null scope fall through to route matching', () => {
  const base = [{ fingerprint: null }];
  const head = [{ fingerprint: null }];
  const baseKeys = [{ scope: null, route: 'r1' }];
  const headKeys = [{ scope: null, route: 'r1' }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [0]);
  assert.deepEqual(baseOf, [0]);
  assert.deepEqual(level, ['route']);
});

test('all keys null result in no pairing', () => {
  const base = [{ fingerprint: null }];
  const head = [{ fingerprint: null }];
  const baseKeys = [{ scope: null, route: null }];
  const headKeys = [{ scope: null, route: null }];
  const { headOf, baseOf, level } = pairLists(base, head, baseKeys, headKeys);
  assert.deepEqual(headOf, [-1]);
  assert.deepEqual(baseOf, [-1]);
  assert.deepEqual(level, [null]);
});
