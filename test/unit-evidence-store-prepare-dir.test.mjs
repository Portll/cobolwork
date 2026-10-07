// Creates evidence directory tree and refuses paths inside read roots (lib/evidence/store.mjs prepareDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDir } from '../lib/evidence/store.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync, lstatSync, statSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('creates directory with runs and seals subdirectories', () => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const dir = join(base, 'evidence');
    const result = prepareDir(dir);
    assert.equal(result, realpathSync(dir));
    assert.ok(existsSync(join(dir, 'runs')));
    assert.ok(existsSync(join(dir, 'seals')));
    assert.ok(statSync(dir).isDirectory());
    assert.ok(statSync(join(dir, 'runs')).isDirectory());
    assert.ok(statSync(join(dir, 'seals')).isDirectory());
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('returns existing directory path when it already exists', () => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const dir = join(base, 'existing');
    mkdirSync(dir, { recursive: true });
    const result = prepareDir(dir);
    assert.equal(result, realpathSync(dir));
    assert.ok(existsSync(join(dir, 'runs')));
    assert.ok(existsSync(join(dir, 'seals')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('refuses when evidence directory is inside a read root', () => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const root = join(base, 'data');
    mkdirSync(root, { recursive: true });
    const dir = join(root, 'evidence');
    assert.throws(() => prepareDir(dir, [root]), (err) => {
      assert.equal(err.code, 'EEVIDENCE');
      assert.match(err.message, /inside/);
      return true;
    });
    assert.ok(!existsSync(dir));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('refuses when evidence directory equals a read root', () => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const root = join(base, 'data');
    mkdirSync(root, { recursive: true });
    assert.throws(() => prepareDir(root, [root]), (err) => {
      assert.equal(err.code, 'EEVIDENCE');
      assert.match(err.message, /inside/);
      return true;
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('allows evidence directory that is a sibling of a read root', () => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const root = join(base, 'data');
    mkdirSync(root, { recursive: true });
    const dir = join(base, 'evidence');
    const result = prepareDir(dir, [root]);
    assert.equal(result, realpathSync(dir));
    assert.ok(existsSync(join(dir, 'runs')));
    assert.ok(existsSync(join(dir, 'seals')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('refuses when runs subdirectory is a symbolic link', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const dir = join(base, 'evidence');
    mkdirSync(dir, { recursive: true });
    const realRuns = join(base, 'real-runs');
    mkdirSync(realRuns, { recursive: true });
    const runsLink = join(dir, 'runs');
    try { symlinkSync(realRuns, runsLink); } catch (e) { t.skip(`this platform will not create a symbolic link here (${e.code})`); return; }
    assert.throws(() => prepareDir(dir), (err) => {
      assert.equal(err.code, 'EEVIDENCE');
      assert.match(err.message, /symbolic link/);
      return true;
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('refuses when seals subdirectory is a symbolic link', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const dir = join(base, 'evidence');
    mkdirSync(dir, { recursive: true });
    const realSeals = join(base, 'real-seals');
    mkdirSync(realSeals, { recursive: true });
    const sealsLink = join(dir, 'seals');
    try { symlinkSync(realSeals, sealsLink); } catch (e) { t.skip(`this platform will not create a symbolic link here (${e.code})`); return; }
    assert.throws(() => prepareDir(dir), (err) => {
      assert.equal(err.code, 'EEVIDENCE');
      assert.match(err.message, /symbolic link/);
      return true;
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('skips non-existent roots in the roots array', () => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const dir = join(base, 'evidence');
    const missingRoot = join(base, 'missing');
    const result = prepareDir(dir, [missingRoot]);
    assert.equal(result, realpathSync(dir));
    assert.ok(existsSync(join(dir, 'runs')));
    assert.ok(existsSync(join(dir, 'seals')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('handles nested directory creation with multiple missing levels', () => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const dir = join(base, 'a', 'b', 'c');
    const result = prepareDir(dir);
    assert.equal(result, realpathSync(dir));
    assert.ok(existsSync(join(dir, 'runs')));
    assert.ok(existsSync(join(dir, 'seals')));
    assert.ok(existsSync(join(base, 'a', 'b')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('refuses when evidence directory path resolves inside a read root via symlink', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'prepareDir-'));
  try {
    const root = join(base, 'data');
    mkdirSync(root, { recursive: true });
    const realDir = join(base, 'real');
    mkdirSync(realDir, { recursive: true });
    const linkPath = join(base, 'link');
    try { symlinkSync(root, linkPath); } catch (e) { t.skip(`this platform will not create a symbolic link here (${e.code})`); return; }
    const dir = join(linkPath, 'evidence');
    assert.throws(() => prepareDir(dir, [root]), (err) => {
      assert.equal(err.code, 'EEVIDENCE');
      assert.match(err.message, /inside/);
      return true;
    });
    assert.ok(!existsSync(dir));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
