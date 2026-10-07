// Reads and validates the repository's own cobolwork.policy.json from a tree on disk (lib/policy.mjs treePolicy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treePolicy } from '../lib/policy.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the policy file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    assert.equal(treePolicy(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a valid policy object when the file is present and valid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1 }));
    const result = treePolicy(dir);
    assert.deepEqual(result, {
      path: join(dir, 'cobolwork.policy.json'),
      raw: { policyVersion: 1 },
      problems: []
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when the policy file contains invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), '{ not valid json');
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.equal(result.raw, null);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /is not readable as JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when the policy has an unknown key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, unknownKey: true }));
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.deepEqual(result.raw, { policyVersion: 1, unknownKey: true });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /is not a policy key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when policyVersion is not 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 2 }));
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.deepEqual(result.raw, { policyVersion: 2 });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /policyVersion must be 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when block is not a valid tier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, block: 'invalid' }));
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.deepEqual(result.raw, { policyVersion: 1, block: 'invalid' });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /block must be one of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when classes contains an invalid class', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, classes: ['invalid'] }));
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.deepEqual(result.raw, { policyVersion: 1, classes: ['invalid'] });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /classes must be a list drawn from/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when coverage is not block or warn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, coverage: 'invalid' }));
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.deepEqual(result.raw, { policyVersion: 1, coverage: 'invalid' });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /coverage must be block or warn/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when rules contains an unknown rule id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, rules: { unknownRule: 'block' } }));
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.deepEqual(result.raw, { policyVersion: 1, rules: { unknownRule: 'block' } });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /is not a rule cobolwork declares/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns problems when waivers is not a valid object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'treePolicy-'));
  try {
    writeFileSync(join(dir, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, waivers: { maxDays: 0 } }));
    const result = treePolicy(dir);
    assert.equal(result.path, join(dir, 'cobolwork.policy.json'));
    assert.deepEqual(result.raw, { policyVersion: 1, waivers: { maxDays: 0 } });
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /waivers must be/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
