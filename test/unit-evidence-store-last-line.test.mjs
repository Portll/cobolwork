// Returns the last line of a chain file read from its tail and whether it was cut short, or a null line for a missing or empty file (lib/evidence/store.mjs lastLine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastLine } from '../lib/evidence/store.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, openSync, closeSync, ftruncateSync, fsyncSync, writeSync, readSync, statSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null line and false torn for a non-existent path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const result = lastLine(join(dir, 'missing.txt'));
    assert.deepEqual(result, { line: null, torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null line and false torn for an empty file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const p = join(dir, 'empty.txt');
    writeFileSync(p, '');
    const result = lastLine(p);
    assert.deepEqual(result, { line: null, torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last line and false torn when file ends with newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const p = join(dir, 'lines.txt');
    writeFileSync(p, 'first\nsecond\nthird\n');
    const result = lastLine(p);
    assert.deepEqual(result, { line: 'third', torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the partial last line and true torn when file does not end with newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const p = join(dir, 'torn.txt');
    writeFileSync(p, 'first\nsecond\nthird');
    const result = lastLine(p);
    assert.deepEqual(result, { line: 'third', torn: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the entire content as line and false torn for a single line with newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const p = join(dir, 'single.txt');
    writeFileSync(p, 'onlyline\n');
    const result = lastLine(p);
    assert.deepEqual(result, { line: 'onlyline', torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the entire content as line and true torn for a single line without newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const p = join(dir, 'single-torn.txt');
    writeFileSync(p, 'onlyline');
    const result = lastLine(p);
    assert.deepEqual(result, { line: 'onlyline', torn: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last line correctly for a file larger than 65536 bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const p = join(dir, 'big.txt');
    const filler = 'x'.repeat(70000);
    const content = filler + '\nlastline\n';
    writeFileSync(p, content);
    const result = lastLine(p);
    assert.deepEqual(result, { line: 'lastline', torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the last line correctly for a file with many lines exceeding the initial window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lastLine-'));
  try {
    const p = join(dir, 'many.txt');
    const lines = [];
    for (let i = 0; i < 10000; i++) {
      lines.push('line' + i);
    }
    writeFileSync(p, lines.join('\n') + '\n');
    const result = lastLine(p);
    assert.deepEqual(result, { line: 'line9999', torn: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
