// Resolves a command to an absolute executable path outside the repository (lib/gate.mjs findExecutable).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExecutable } from '../lib/gate.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('returns null for absolute path inside repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const script = join(repo, 'script.sh');
    writeFileSync(script, '#!/bin/sh\n');
    chmodSync(script, 0o755);
    const result = findExecutable(script, { repo });
    assert.equal(result.path, null);
    assert.match(result.why, /is not a file outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns path for absolute path outside repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const script = join(dir, 'script.sh');
    writeFileSync(script, '#!/bin/sh\n');
    chmodSync(script, 0o755);
    const result = findExecutable(script, { repo });
    assert.equal(result.path, script);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null for absolute path that does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const missing = join(dir, 'missing.sh');
    const result = findExecutable(missing, { repo });
    assert.equal(result.path, null);
    assert.match(result.why, /is not a file outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns path for bare name found on PATH outside repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, 'mytool');
    writeFileSync(exe, '#!/bin/sh\n');
    chmodSync(exe, 0o755);
    const env = { PATH: binDir };
    const result = findExecutable('mytool', { repo, env, platform: 'linux' });
    assert.equal(result.path, exe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when bare name not found on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const env = { PATH: '' };
    const result = findExecutable('nonexistent-tool', { repo, env, platform: 'linux' });
    assert.equal(result.path, null);
    assert.match(result.why, /no nonexistent-tool on PATH outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips PATH entries inside repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const repoBin = join(repo, 'bin');
    mkdirSync(repoBin, { recursive: true });
    const exe = join(repoBin, 'mytool');
    writeFileSync(exe, '#!/bin/sh\n');
    chmodSync(exe, 0o755);
    const env = { PATH: repoBin };
    const result = findExecutable('mytool', { repo, env, platform: 'linux' });
    assert.equal(result.path, null);
    assert.match(result.why, /no mytool on PATH outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tries .exe and .com extensions on win32', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, 'mytool.exe');
    writeFileSync(exe, 'MZ');
    chmodSync(exe, 0o755);
    const env = { PATH: binDir };
    const result = findExecutable('mytool', { repo, env, platform: 'win32' });
    assert.equal(result.path, exe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips relative PATH entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findExecutable-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, 'mytool');
    writeFileSync(exe, '#!/bin/sh\n');
    chmodSync(exe, 0o755);
    const env = { PATH: 'relative-path' };
    const result = findExecutable('mytool', { repo, env, platform: 'linux' });
    assert.equal(result.path, null);
    assert.match(result.why, /no mytool on PATH outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
