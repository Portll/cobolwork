// Locates the COBOL compiler executable, preferring an explicit path over PATH search (lib/gate.mjs findCobc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCobc } from '../lib/gate.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

test('returns null path when explicit is null and cobc is not on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const env = { PATH: join(dir, 'empty') };
    const result = findCobc({ explicit: null, repo, env, platform: 'linux' });
    assert.equal(result.path, null);
    assert.match(result.why, /no cobc on PATH outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null path when explicit path is inside the repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const explicit = join(repo, 'cobc');
    writeFileSync(explicit, '');
    const env = { PATH: join(dir, 'empty') };
    const result = findCobc({ explicit, repo, env, platform: 'linux' });
    assert.equal(result.path, null);
    assert.match(result.why, /is not a file outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null path when explicit path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const explicit = join(dir, 'nonexistent-cobc');
    const env = { PATH: join(dir, 'empty') };
    const result = findCobc({ explicit, repo, env, platform: 'linux' });
    assert.equal(result.path, null);
    assert.match(result.why, /is not a file outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the explicit path when it is a file outside the repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const explicit = join(dir, 'cobc');
    writeFileSync(explicit, '');
    const env = { PATH: join(dir, 'empty') };
    const result = findCobc({ explicit, repo, env, platform: 'linux' });
    assert.equal(result.path, resolve(explicit));
    assert.equal(result.why, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finds cobc on PATH when explicit is null and cobc exists outside the repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const cobcPath = join(binDir, 'cobc');
    writeFileSync(cobcPath, '');
    const env = { PATH: binDir };
    const result = findCobc({ explicit: null, repo, env, platform: 'linux' });
    assert.equal(result.path, cobcPath);
    assert.equal(result.why, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips PATH entries inside the repository when searching for cobc', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    const insideBin = join(repo, 'bin');
    const outsideBin = join(dir, 'outside-bin');
    mkdirSync(insideBin, { recursive: true });
    mkdirSync(outsideBin, { recursive: true });
    writeFileSync(join(insideBin, 'cobc'), '');
    writeFileSync(join(outsideBin, 'cobc'), '');
    const env = { PATH: [insideBin, outsideBin].join(delimiter) };
    const result = findCobc({ explicit: null, repo, env, platform: 'linux' });
    assert.equal(result.path, join(outsideBin, 'cobc'));
    assert.equal(result.why, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null path when cobc is only available inside the repository on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    const insideBin = join(repo, 'bin');
    mkdirSync(insideBin, { recursive: true });
    writeFileSync(join(insideBin, 'cobc'), '');
    const env = { PATH: insideBin };
    const result = findCobc({ explicit: null, repo, env, platform: 'linux' });
    assert.equal(result.path, null);
    assert.match(result.why, /no cobc on PATH outside the repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses .exe extension when searching on Windows platform', () => {
  const dir = mkdtempSync(join(tmpdir(), 'findCobc-'));
  try {
    const repo = join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    const binDir = join(dir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const cobcExe = join(binDir, 'cobc.exe');
    writeFileSync(cobcExe, '');
    const env = { PATH: binDir };
    const result = findCobc({ explicit: null, repo, env, platform: 'win32' });
    assert.equal(result.path, cobcExe);
    assert.equal(result.why, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
