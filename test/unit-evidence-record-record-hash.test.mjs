// Computes a SHA-256 hex digest of the canonical form of a record body (lib/evidence/record.mjs recordHash).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordHash } from '../lib/evidence/record.mjs';
import './pin-machine.mjs';

test('hashes an empty record body', () => {
  assert.equal(recordHash({}), '15feea4dcfd4c94fafa6f95dfa6a1eb71c45a26f7f4d69131a86cc759c3e5daf');
});

test('hashes a record with a single string field', () => {
  assert.equal(recordHash({ name: 'test' }), 'bca9456fd7904e65cac14b3286e869f32fbcda34a9812296406b9fcf3b6d745e');
});

test('hashes a record with an integer field', () => {
  assert.equal(recordHash({ count: 42 }), '8480b330d4c72a0622c3abd36133f9ef62c9e73cff897915dd4ee58510d66f88');
});

test('hashes a record with a boolean field', () => {
  assert.equal(recordHash({ active: true }), '447d220e5f070bc54781582459fbf5d27fad120e4b855c60d4ac1aee06e51d5f');
});

test('hashes a record with a null field', () => {
  assert.equal(recordHash({ value: null }), '675416bb1cb45ff488107eeb6e610f7c93b5552623cd9b64c63277a8d7d01bf2');
});

test('hashes a record with an array field', () => {
  assert.equal(recordHash({ items: [1, 2, 3] }), '9431ba7ee236aa447c1526cf206dd6df90bdce71ae3f81fdb7858756706b53e5');
});

test('hashes a record with a nested object field', () => {
  assert.equal(recordHash({ meta: { key: 'value' } }), '3808fae94441b1d7533d8203e7aa41c10f4467ca487a181b0f94d0323f0048ed');
});

test('ignores the hash field when computing the digest', () => {
  const record = { name: 'test', hash: 'ignored' };
  assert.equal(recordHash(record), recordHash({ name: 'test' }));
});

test('produces different hashes for different record bodies', () => {
  assert.notEqual(recordHash({ a: 1 }), recordHash({ a: 2 }));
});

test('sorts object keys in the canonical form', () => {
  assert.equal(recordHash({ b: 2, a: 1 }), recordHash({ a: 1, b: 2 }));
});
