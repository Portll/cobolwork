// Load a baseline file, validating its version and entries (lib/baseline.mjs loadBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBaseline } from '../lib/baseline.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when use is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const result = loadBaseline(dir, { use: false });
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when file is absent and not explicit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const result = loadBaseline(dir, {});
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty entries with problem when explicit file is absent and mayBeAbsent is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const explicitPath = join(dir, 'cobolwork.baseline.json');
    const result = loadBaseline(dir, { explicit: explicitPath });
    assert.equal(result.path, explicitPath);
    assert.equal(result.source, 'explicit');
    assert.deepEqual(result.entries, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /does not exist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty entries without problem when explicit file is absent and mayBeAbsent is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const explicitPath = join(dir, 'cobolwork.baseline.json');
    const result = loadBaseline(dir, { explicit: explicitPath, mayBeAbsent: true });
    assert.equal(result.path, explicitPath);
    assert.equal(result.source, 'explicit');
    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problem when file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const filePath = join(dir, 'cobolwork.baseline.json');
    writeFileSync(filePath, 'not json');
    const result = loadBaseline(dir, {});
    assert.equal(result.path, filePath);
    assert.equal(result.source, 'tree');
    assert.deepEqual(result.entries, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /not readable as JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problem when version is not an integer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const filePath = join(dir, 'cobolwork.baseline.json');
    writeFileSync(filePath, JSON.stringify({ version: 1.5, entries: [] }));
    const result = loadBaseline(dir, {});
    assert.equal(result.path, filePath);
    assert.equal(result.source, 'tree');
    assert.deepEqual(result.entries, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /not a whole number/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problem when version is greater than BASELINE_VERSION', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const filePath = join(dir, 'cobolwork.baseline.json');
    writeFileSync(filePath, JSON.stringify({ version: 2, entries: [] }));
    const result = loadBaseline(dir, {});
    assert.equal(result.path, filePath);
    assert.equal(result.source, 'tree');
    assert.deepEqual(result.entries, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /upgrade cobolwork/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problem when entries is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const filePath = join(dir, 'cobolwork.baseline.json');
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: 'not an array' }));
    const result = loadBaseline(dir, {});
    assert.equal(result.path, filePath);
    assert.equal(result.source, 'tree');
    assert.deepEqual(result.entries, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /no entries array/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns valid entries and no problems for a well-formed baseline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const filePath = join(dir, 'cobolwork.baseline.json');
    const entry = {
      fingerprint: 'a'.repeat(32),
      rule: 'TEST-RULE',
      action: 'note',
      reason: 'test reason',
      who: 'tester',
      at: '2027-01-31T00:00:00Z'
    };
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: [entry] }));
    const result = loadBaseline(dir, {});
    assert.equal(result.path, filePath);
    assert.equal(result.source, 'tree');
    assert.equal(result.version, 1);
    assert.equal(result.entries.length, 1);
    assert.deepEqual(result.entries[0], entry);
    assert.deepEqual(result.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problem for entry with missing required fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadBaseline-'));
  try {
    const filePath = join(dir, 'cobolwork.baseline.json');
    const badEntry = { fingerprint: 'b'.repeat(32) };
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: [badEntry] }));
    const result = loadBaseline(dir, {});
    assert.equal(result.path, filePath);
    assert.equal(result.source, 'tree');
    assert.equal(result.entries.length, 0);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /entry 1/);
    assert.match(result.problems[0], /missing rule/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
