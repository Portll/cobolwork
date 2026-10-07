// Whether a path is still under root once every link in it is followed (lib/kernel/source-tree.mjs resolvesInside).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvesInside } from '../lib/kernel/source-tree.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';

test('returns true when the path is the root itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    assert.equal(resolvesInside(root, root), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when the path is a file directly inside the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    const file = join(root, 'a.txt');
    writeFileSync(file, 'x');
    assert.equal(resolvesInside(root, file), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when the path is in a nested directory inside the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(join(root, 'sub', 'deep'), { recursive: true });
    const file = join(root, 'sub', 'deep', 'b.txt');
    writeFileSync(file, 'y');
    assert.equal(resolvesInside(root, file), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the path is a sibling of the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    const sibling = join(dir, 'sibling');
    mkdirSync(root);
    mkdirSync(sibling);
    assert.equal(resolvesInside(root, sibling), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the path is a prefix of the root name but not inside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    const prefix = join(dir, 'rootX');
    mkdirSync(root);
    mkdirSync(prefix);
    assert.equal(resolvesInside(root, prefix), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    const missing = join(root, 'nope.txt');
    assert.equal(resolvesInside(root, missing), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when the root does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'no-root');
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'z');
    assert.equal(resolvesInside(root, file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns true when a symlink inside the root points to a file inside the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    mkdirSync(root);
    const target = join(root, 'real.txt');
    writeFileSync(target, 'data');
    const link = join(root, 'link.txt');
    symlinkSync(target, link);
    assert.equal(resolvesInside(root, link), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when a symlink inside the root points outside the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const root = join(dir, 'root');
    const outside = join(dir, 'outside.txt');
    mkdirSync(root);
    writeFileSync(outside, 'secret');
    const link = join(root, 'escape.txt');
    symlinkSync(outside, link);
    assert.equal(resolvesInside(root, link), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns false when a symlink in the root path itself points outside', () => {
  const dir = mkdtempSync(join(tmpdir(), 'resolvesInside-'));
  try {
    const realRoot = join(dir, 'real-root');
    const outside = join(dir, 'outside');
    mkdirSync(realRoot);
    mkdirSync(outside);
    const fakeRoot = join(dir, 'fake-root');
    symlinkSync(outside, fakeRoot);
    const file = join(realRoot, 'f.txt');
    writeFileSync(file, 'q');
    assert.equal(resolvesInside(fakeRoot, file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
