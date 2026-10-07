// Annotate findings with the paragraph and entered count from feeds that cover their program (lib/execution.mjs applyExecution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyExecution } from '../lib/execution.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null byExecution when no feed is good', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    const findings = [{ path: 'a.cob', line: 5 }];
    const feeds = [{ problem: 'bad' }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves finding untouched when path is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    const findings = [{ line: 5 }];
    const feeds = [{ programs: new Map([['A', [{ name: 'P1', line: 1, entered: 1 }]]]) }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 0, 'never-entered': 0 } });
    assert.equal(findings[0].executed, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves finding untouched when line is not an integer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    const findings = [{ path: 'a.cob', line: '5' }];
    const feeds = [{ programs: new Map([['A', [{ name: 'P1', line: 1, entered: 1 }]]]) }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 0, 'never-entered': 0 } });
    assert.equal(findings[0].executed, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves finding untouched when no program in source covers the line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    writeFileSync(join(dir, 'a.cob'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n');
    const findings = [{ path: 'a.cob', line: 1 }];
    const feeds = [{ programs: new Map([['A', [{ name: 'P1', line: 2, entered: 1 }]]]) }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 0, 'never-entered': 0 } });
    assert.equal(findings[0].executed, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves finding untouched when no feed covers the owning program', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    writeFileSync(join(dir, 'a.cob'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n');
    const findings = [{ path: 'a.cob', line: 2 }];
    const feeds = [{ programs: new Map([['B', [{ name: 'P1', line: 1, entered: 1 }]]]) }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 0, 'never-entered': 0 } });
    assert.equal(findings[0].executed, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('leaves finding untouched when no feed detail is within the program range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    writeFileSync(join(dir, 'a.cob'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n');
    const findings = [{ path: 'a.cob', line: 2 }];
    const feeds = [{ programs: new Map([['A', [{ name: 'P1', line: 10, entered: 1 }]]]) }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 0, 'never-entered': 0 } });
    assert.equal(findings[0].executed, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('annotates finding with paragraph and entered count when feed covers it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    writeFileSync(join(dir, 'a.cob'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n');
    const findings = [{ path: 'a.cob', line: 2 }];
    const feeds = [{ programs: new Map([['A', [{ name: 'P1', line: 2, entered: 3 }]]]) }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 1, 'never-entered': 0 } });
    assert.deepEqual(findings[0].executed, { paragraph: 'P1', entered: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts never-entered when entered is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    writeFileSync(join(dir, 'a.cob'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n');
    const findings = [{ path: 'a.cob', line: 2 }];
    const feeds = [{ programs: new Map([['A', [{ name: 'P1', line: 2, entered: 0 }]]]) }];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 0, 'never-entered': 1 } });
    assert.deepEqual(findings[0].executed, { paragraph: 'P1', entered: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sums entered across multiple good feeds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    writeFileSync(join(dir, 'a.cob'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n');
    const findings = [{ path: 'a.cob', line: 2 }];
    const feeds = [
      { programs: new Map([['A', [{ name: 'P1', line: 2, entered: 2 }]]]) },
      { programs: new Map([['A', [{ name: 'P1', line: 2, entered: 3 }]]]) },
    ];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 1, 'never-entered': 0 } });
    assert.deepEqual(findings[0].executed, { paragraph: 'P1', entered: 5 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores feeds with problem when computing execution', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applyExecution-'));
  try {
    writeFileSync(join(dir, 'a.cob'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n');
    const findings = [{ path: 'a.cob', line: 2 }];
    const feeds = [
      { problem: 'bad', programs: new Map([['A', [{ name: 'P1', line: 2, entered: 10 }]]]) },
      { programs: new Map([['A', [{ name: 'P1', line: 2, entered: 1 }]]]) },
    ];
    const result = applyExecution(findings, dir, feeds);
    assert.deepEqual(result, { byExecution: { entered: 1, 'never-entered': 0 } });
    assert.deepEqual(findings[0].executed, { paragraph: 'P1', entered: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
