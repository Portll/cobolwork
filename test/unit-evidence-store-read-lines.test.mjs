// Lines of a file without newlines and whether the last line was cut short (lib/evidence/store.mjs readLines).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLines } from '../lib/evidence/store.mjs';
import './pin-machine.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty lines and torn false for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '');
    assert.deepEqual(readLines(p), { lines: [], torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a single line without newline and torn true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'one.txt');
    writeFileSync(p, 'hello');
    assert.deepEqual(readLines(p), { lines: ['hello'], torn: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a single line with trailing newline and torn false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'one-nl.txt');
    writeFileSync(p, 'hello\n');
    assert.deepEqual(readLines(p), { lines: ['hello'], torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns multiple lines with trailing newline and torn false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'multi.txt');
    writeFileSync(p, 'a\nb\nc\n');
    assert.deepEqual(readLines(p), { lines: ['a', 'b', 'c'], torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns multiple lines without trailing newline and torn true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'multi-torn.txt');
    writeFileSync(p, 'a\nb\nc');
    assert.deepEqual(readLines(p), { lines: ['a', 'b', 'c'], torn: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a single empty line for a file containing only a newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'nl-only.txt');
    writeFileSync(p, '\n');
    assert.deepEqual(readLines(p), { lines: [''], torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns two empty lines for a file containing two newlines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'two-nl.txt');
    writeFileSync(p, '\n\n');
    assert.deepEqual(readLines(p), { lines: ['', ''], torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a line with an empty middle segment for a file with consecutive newlines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'readLines-'));
  try {
    const p = join(dir, 'consecutive.txt');
    writeFileSync(p, 'a\n\nb\n');
    assert.deepEqual(readLines(p), { lines: ['a', '', 'b'], torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
