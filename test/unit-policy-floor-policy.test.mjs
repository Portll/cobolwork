// The policy floor file, or a refusal when it is missing or inside the repo (lib/policy.mjs floorPolicy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorPolicy } from '../lib/policy.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('returns a no-such-file problem when the policy file is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const file = join(dir, 'no-policy.json');
    const out = floorPolicy(file, dir);
    assert.deepEqual(out, {
      path: resolve(file),
      raw: null,
      problems: [`--policy ${resolve(file)}: no such file`],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an inside-the-repository problem when the policy file is inside the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const file = join(dir, 'inside.json');
    writeFileSync(file, '{}');
    const out = floorPolicy(file, dir);
    assert.deepEqual(out, {
      path: resolve(file),
      raw: null,
      problems: [`--policy ${resolve(file)} is inside the repository; a floor the change can edit is not a floor`],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns an inside-the-repository problem when the policy file is in a subdirectory of the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    const file = join(sub, 'x.json');
    writeFileSync(file, '{}');
    const out = floorPolicy(file, dir);
    assert.deepEqual(out, {
      path: resolve(file),
      raw: null,
      problems: [`--policy ${resolve(file)} is inside the repository; a floor the change can edit is not a floor`],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a no-such-file problem when the policy file is outside the repo but absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  const outside = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const file = join(outside, 'missing.json');
    const out = floorPolicy(file, dir);
    assert.deepEqual(out, {
      path: resolve(file),
      raw: null,
      problems: [`--policy ${resolve(file)}: no such file`],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('returns a not-readable-as-JSON problem when the policy file outside the repo is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  const outside = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const file = join(outside, 'bad.json');
    writeFileSync(file, '{ not json');
    const out = floorPolicy(file, dir);
    assert.equal(out.path, resolve(file));
    assert.equal(out.raw, null);
    assert.equal(out.problems.length, 1);
    assert.match(out.problems[0], new RegExp(`^${resolve(file)} is not readable as JSON: `));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('returns the parsed raw object and validation problems when the policy file outside the repo is valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  const outside = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const file = join(outside, 'ok.json');
    const raw = { policyVersion: 1, block: 'block' };
    writeFileSync(file, JSON.stringify(raw));
    const out = floorPolicy(file, dir);
    assert.equal(out.path, resolve(file));
    assert.deepEqual(out.raw, raw);
    assert.equal(out.problems.length, 1);
    assert.equal(out.problems[0], `${resolve(file)}: block must be one of info, low, med, high, crit, known-exploitable`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('returns a policyVersion problem when the policy file outside the repo is an empty object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  const outside = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const file = join(outside, 'empty.json');
    writeFileSync(file, '{}');
    const out = floorPolicy(file, dir);
    assert.equal(out.path, resolve(file));
    assert.deepEqual(out.raw, {});
    assert.deepEqual(out.problems, [`${resolve(file)}: policyVersion must be 1`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('returns an inside-the-repository problem when the policy path is the repo directory itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorPolicy-'));
  try {
    const out = floorPolicy(dir, dir);
    assert.deepEqual(out, {
      path: resolve(dir),
      raw: null,
      problems: [`--policy ${resolve(dir)} is inside the repository; a floor the change can edit is not a floor`],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
