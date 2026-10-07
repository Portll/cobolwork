// Lists sealed evidence files in a directory, sorted by sequence number (lib/evidence/seal.mjs sealFiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealFiles } from '../lib/evidence/seal.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when seals directory does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    const result = sealFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws EvidenceRefusal when seals path is a symbolic link', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    const target = join(dir, 'target');
    mkdirSync(target);
    const link = join(dir, 'seals');
    try { symlinkSync(target, link); } catch (e) { t.skip(`this platform will not create a symbolic link here (${e.code})`); return; }
    assert.throws(() => sealFiles(dir), /is a symbolic link/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty array when seals directory exists but is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    mkdirSync(join(dir, 'seals'));
    const result = sealFiles(dir);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns single sealed file with correct seq, name, and path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    const sealsDir = join(dir, 'seals');
    mkdirSync(sealsDir);
    writeFileSync(join(sealsDir, '1.dsse.json'), '{}');
    const result = sealFiles(dir);
    assert.deepEqual(result, [{ seq: 1, name: '1.dsse.json', path: join(sealsDir, '1.dsse.json') }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores files that do not match the expected pattern', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    const sealsDir = join(dir, 'seals');
    mkdirSync(sealsDir);
    writeFileSync(join(sealsDir, '1.dsse.json'), '{}');
    writeFileSync(join(sealsDir, '1.dsse'), '{}');
    writeFileSync(join(sealsDir, '1.json'), '{}');
    writeFileSync(join(sealsDir, '1.dsse.jsonx'), '{}');
    writeFileSync(join(sealsDir, 'x.dsse.json'), '{}');
    writeFileSync(join(sealsDir, '1.dsse.json.bak'), '{}');
    const result = sealFiles(dir);
    assert.deepEqual(result, [{ seq: 1, name: '1.dsse.json', path: join(sealsDir, '1.dsse.json') }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts multiple sealed files by sequence number', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    const sealsDir = join(dir, 'seals');
    mkdirSync(sealsDir);
    writeFileSync(join(sealsDir, '10.dsse.json'), '{}');
    writeFileSync(join(sealsDir, '2.dsse.json'), '{}');
    writeFileSync(join(sealsDir, '1.dsse.json'), '{}');
    const result = sealFiles(dir);
    assert.deepEqual(result, [
      { seq: 1, name: '1.dsse.json', path: join(sealsDir, '1.dsse.json') },
      { seq: 2, name: '2.dsse.json', path: join(sealsDir, '2.dsse.json') },
      { seq: 10, name: '10.dsse.json', path: join(sealsDir, '10.dsse.json') }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles zero sequence number correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    const sealsDir = join(dir, 'seals');
    mkdirSync(sealsDir);
    writeFileSync(join(sealsDir, '0.dsse.json'), '{}');
    writeFileSync(join(sealsDir, '1.dsse.json'), '{}');
    const result = sealFiles(dir);
    assert.deepEqual(result, [
      { seq: 0, name: '0.dsse.json', path: join(sealsDir, '0.dsse.json') },
      { seq: 1, name: '1.dsse.json', path: join(sealsDir, '1.dsse.json') }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles large sequence numbers correctly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sealFiles-'));
  try {
    const sealsDir = join(dir, 'seals');
    mkdirSync(sealsDir);
    writeFileSync(join(sealsDir, '1000.dsse.json'), '{}');
    writeFileSync(join(sealsDir, '99.dsse.json'), '{}');
    const result = sealFiles(dir);
    assert.deepEqual(result, [
      { seq: 99, name: '99.dsse.json', path: join(sealsDir, '99.dsse.json') },
      { seq: 1000, name: '1000.dsse.json', path: join(sealsDir, '1000.dsse.json') }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
