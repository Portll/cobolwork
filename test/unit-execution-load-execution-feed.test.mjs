// reads a JSON execution feed and validates its program/paragraph structure (lib/execution.mjs loadExecutionFeed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExecutionFeed } from '../lib/execution.mjs';
import './pin-machine.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns a feed with no programs when the file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const feed = loadExecutionFeed(join(dir, 'nope.json'));
    assert.equal(feed.file, 'nope.json');
    assert.equal(feed.problem, 'could not be read (ENOENT)');
    assert.equal(feed.programs.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a non-JSON file as not JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'bad.json');
    writeFileSync(p, 'not json');
    const feed = loadExecutionFeed(p);
    assert.equal(feed.file, 'bad.json');
    assert.match(feed.problem, /^is not JSON \(/);
    assert.equal(feed.programs.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a document without a programs array as holding no programs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'no-programs.json');
    writeFileSync(p, JSON.stringify({ hello: 1 }));
    const feed = loadExecutionFeed(p);
    assert.equal(feed.problem, 'holds no programs');
    assert.equal(feed.programs.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a program whose detail is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'bad-detail.json');
    writeFileSync(p, JSON.stringify({ programs: [{ program: 'MAIN', detail: 'nope' }] }));
    const feed = loadExecutionFeed(p);
    assert.equal(feed.problem, "a program's paragraphs are not { name, line, entered }");
    assert.equal(feed.programs.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a paragraph missing a string name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'bad-name.json');
    writeFileSync(p, JSON.stringify({ programs: [{ program: 'MAIN', detail: [{ name: 1, line: 1, entered: 0 }] }] }));
    const feed = loadExecutionFeed(p);
    assert.equal(feed.problem, "a program's paragraphs are not { name, line, entered }");
    assert.equal(feed.programs.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a paragraph whose line is not an integer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'bad-line.json');
    writeFileSync(p, JSON.stringify({ programs: [{ program: 'MAIN', detail: [{ name: 'P', line: 1.5, entered: 0 }] }] }));
    const feed = loadExecutionFeed(p);
    assert.equal(feed.problem, "a program's paragraphs are not { name, line, entered }");
    assert.equal(feed.programs.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a paragraph whose entered is negative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'neg-entered.json');
    writeFileSync(p, JSON.stringify({ programs: [{ program: 'MAIN', detail: [{ name: 'P', line: 1, entered: -1 }] }] }));
    const feed = loadExecutionFeed(p);
    assert.equal(feed.problem, "a program's paragraphs are not { name, line, entered }");
    assert.equal(feed.programs.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a paragraph whose entered is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'zero-entered.json');
    writeFileSync(p, JSON.stringify({ programs: [{ program: 'MAIN', detail: [{ name: 'P', line: 1, entered: 0 }] }] }));
    const feed = loadExecutionFeed(p);
    assert.equal(feed.problem, null);
    assert.equal(feed.programs.size, 1);
    assert.deepEqual(feed.programs.get('MAIN'), [{ name: 'P', line: 1, entered: 0 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uppercases the program id when storing it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadExecutionFeed-'));
  try {
    const p = join(dir, 'lower.json');
    writeFileSync(p, JSON.stringify({ programs: [{ program: 'main', detail: [{ name: 'P', line: 2, entered: 3 }] }] }));
    const feed = loadExecutionFeed(p);
    assert.equal(feed.problem, null);
    assert.equal(feed.programs.has('MAIN'), true);
    assert.deepEqual(feed.programs.get('MAIN'), [{ name: 'P', line: 2, entered: 3 }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
