// Programs edited, added, deleted, or with changed copybooks (lib/equivalence.mjs changedPrograms).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedPrograms } from '../lib/equivalence.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty array when both directories are empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    mkdirSync(join(dir, 'base'));
    mkdirSync(join(dir, 'head'));
    const result = changedPrograms(join(dir, 'base'), join(dir, 'head'));
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports deleted program when present in base but not head', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    const base = join(dir, 'base');
    const head = join(dir, 'head');
    mkdirSync(base);
    mkdirSync(head);
    writeFileSync(join(base, 'PROG1.cbl'), 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG1.');
    const result = changedPrograms(base, head);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'PROG1.cbl');
    assert.equal(result[0].deleted, true);
    assert.equal(result[0].head, null);
    assert.ok(result[0].base);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports added program when present in head but not base', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    const base = join(dir, 'base');
    const head = join(dir, 'head');
    mkdirSync(base);
    mkdirSync(head);
    writeFileSync(join(head, 'PROG2.cbl'), 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG2.');
    const result = changedPrograms(base, head);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'PROG2.cbl');
    assert.equal(result[0].base, null);
    assert.ok(result[0].head);
    assert.equal(result[0].deleted, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports modified program when source differs between base and head', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    const base = join(dir, 'base');
    const head = join(dir, 'head');
    mkdirSync(base);
    mkdirSync(head);
    writeFileSync(join(base, 'PROG3.cbl'), 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG3.');
    writeFileSync(join(head, 'PROG3.cbl'), 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG3.\n* changed');
    const result = changedPrograms(base, head);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'PROG3.cbl');
    assert.ok(result[0].base);
    assert.ok(result[0].head);
    assert.notEqual(result[0].base, result[0].head);
    assert.equal(result[0].deleted, undefined);
    assert.equal(result[0].via, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty when program is identical in base and head with no copies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    const base = join(dir, 'base');
    const head = join(dir, 'head');
    mkdirSync(base);
    mkdirSync(head);
    const src = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG4.';
    writeFileSync(join(base, 'PROG4.cbl'), src);
    writeFileSync(join(head, 'PROG4.cbl'), src);
    const result = changedPrograms(base, head);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('respects allow set to filter which head programs are considered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    const base = join(dir, 'base');
    const head = join(dir, 'head');
    mkdirSync(base);
    mkdirSync(head);
    writeFileSync(join(head, 'PROG5.cbl'), 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG5.');
    writeFileSync(join(head, 'PROG6.cbl'), 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG6.');
    const allow = new Set([join(head, 'PROG5.cbl')]);
    const result = changedPrograms(base, head, allow);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'PROG5.cbl');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports via copybooks when program unchanged but copybook digest differs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    const base = join(dir, 'base');
    const head = join(dir, 'head');
    mkdirSync(base);
    mkdirSync(head);
    mkdirSync(join(base, 'copy'));
    mkdirSync(join(head, 'copy'));
    const progSrc = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG7.\nCOPY COPY1.';
    writeFileSync(join(base, 'PROG7.cbl'), progSrc);
    writeFileSync(join(head, 'PROG7.cbl'), progSrc);
    writeFileSync(join(base, 'copy', 'COPY1.cpy'), 'COPYBOOK ONE');
    writeFileSync(join(head, 'copy', 'COPY1.cpy'), 'COPYBOOK ONE CHANGED');
    const result = changedPrograms(base, head);
    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'PROG7.cbl');
    assert.ok(result[0].via);
    assert.ok(result[0].via.includes('copy/COPY1.cpy'));
    assert.ok(result[0].viaDigests);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('does not report via when copybook is unchanged between base and head', () => {
  const dir = mkdtempSync(join(tmpdir(), 'changedPrograms-'));
  try {
    const base = join(dir, 'base');
    const head = join(dir, 'head');
    mkdirSync(base);
    mkdirSync(head);
    mkdirSync(join(base, 'copy'));
    mkdirSync(join(head, 'copy'));
    const progSrc = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. PROG8.\nCOPY COPY2.';
    writeFileSync(join(base, 'PROG8.cbl'), progSrc);
    writeFileSync(join(head, 'PROG8.cbl'), progSrc);
    writeFileSync(join(base, 'copy', 'COPY2.cpy'), 'SAME CONTENT');
    writeFileSync(join(head, 'copy', 'COPY2.cpy'), 'SAME CONTENT');
    const result = changedPrograms(base, head);
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
