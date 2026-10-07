// Lists the names of .json files in a directory, sorted (lib/packs.mjs availablePacks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availablePacks } from '../lib/packs.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns an empty array when the directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    const result = availablePacks(join(dir, 'no-such-dir'));
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an empty array when the directory contains no json files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    writeFileSync(join(dir, 'readme.txt'), 'hello');
    writeFileSync(join(dir, 'data.csv'), 'a,b');
    const result = availablePacks(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the names of json files with the extension removed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    writeFileSync(join(dir, 'alpha.json'), '{}');
    writeFileSync(join(dir, 'beta.json'), '{}');
    const result = availablePacks(dir);
    assert.deepEqual(result, ['alpha', 'beta']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the names sorted alphabetically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    writeFileSync(join(dir, 'zeta.json'), '{}');
    writeFileSync(join(dir, 'alpha.json'), '{}');
    writeFileSync(join(dir, 'mid.json'), '{}');
    const result = availablePacks(dir);
    assert.deepEqual(result, ['alpha', 'mid', 'zeta']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores files that do not end with .json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    writeFileSync(join(dir, 'valid.json'), '{}');
    writeFileSync(join(dir, 'invalid.json.bak'), '{}');
    writeFileSync(join(dir, 'notes.txt'), 'hi');
    writeFileSync(join(dir, 'JSON'), '{}');
    const result = availablePacks(dir);
    assert.deepEqual(result, ['valid']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('removes only the trailing .json extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    writeFileSync(join(dir, 'my.pack.json'), '{}');
    writeFileSync(join(dir, 'a.json.json'), '{}');
    const result = availablePacks(dir);
    assert.deepEqual(result, ['a.json', 'my.pack']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a single element array for one json file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    writeFileSync(join(dir, 'only.json'), '{}');
    const result = availablePacks(dir);
    assert.deepEqual(result, ['only']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles files with dots in the name before the extension', () => {
  const dir = mkdtempSync(join(tmpdir(), 'availablePacks-'));
  try {
    writeFileSync(join(dir, 'v1.2.3.json'), '{}');
    writeFileSync(join(dir, 'simple.json'), '{}');
    const result = availablePacks(dir);
    assert.deepEqual(result, ['simple', 'v1.2.3']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
