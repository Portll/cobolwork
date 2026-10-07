// Reads a named pack file from a directory, returning its parsed contents or a problem message (lib/packs.mjs readPack).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPack } from '../lib/packs.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the parsed pack object with name and empty problems for a valid pack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    writeFileSync(join(dir, 'alpha.json'), JSON.stringify({ version: 1, rules: [] }));
    const result = readPack('alpha', dir);
    assert.deepEqual(result, { version: 1, rules: [], name: 'alpha', problems: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem message when the pack name contains an invalid character', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    writeFileSync(join(dir, 'bad name.json'), JSON.stringify({}));
    const result = readPack('bad name', dir);
    assert.equal(result.name, 'bad name');
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /^no pack named 'bad name'; available: bad name$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem message when the pack file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    writeFileSync(join(dir, 'other.json'), JSON.stringify({}));
    const result = readPack('missing', dir);
    assert.equal(result.name, 'missing');
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /^no pack named 'missing'; available: other$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem message when the pack file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    writeFileSync(join(dir, 'broken.json'), '{invalid');
    const result = readPack('broken', dir);
    assert.equal(result.name, 'broken');
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /^pack 'broken' is not readable as JSON: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem message when the pack file contains a JSON array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    writeFileSync(join(dir, 'list.json'), JSON.stringify([1, 2, 3]));
    const result = readPack('list', dir);
    assert.equal(result.name, 'list');
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0], "pack 'list' is not a JSON object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem message when the pack file contains a JSON string', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    writeFileSync(join(dir, 'str.json'), JSON.stringify('hello'));
    const result = readPack('str', dir);
    assert.equal(result.name, 'str');
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0], "pack 'str' is not a JSON object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem message listing available packs when the directory is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    const result = readPack('nothing', dir);
    assert.equal(result.name, 'nothing');
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0], "no pack named 'nothing'; available: none");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a pack name with digits and hyphens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readPack-'));
  try {
    writeFileSync(join(dir, 'pack-123.json'), JSON.stringify({ ok: true }));
    const result = readPack('pack-123', dir);
    assert.deepEqual(result, { ok: true, name: 'pack-123', problems: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
