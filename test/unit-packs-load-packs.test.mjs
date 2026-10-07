// Loads the named rule packs from a directory and reports which loaded, which were refused, problems and caveats (lib/packs.mjs loadPacks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPacks } from '../lib/packs.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty arrays when no pack names are given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    const result = loadPacks([], { packDir: dir });
    assert.deepEqual(result, { loaded: [], refused: [], problems: [], caveats: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem when a requested pack file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    const result = loadPacks(['missing'], { packDir: dir });
    assert.equal(result.loaded.length, 0);
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /no pack named 'missing'/);
    assert.match(result.problems[0], /available: none/);
    assert.equal(result.caveats.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem when the pack file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not json');
    const result = loadPacks(['bad'], { packDir: dir });
    assert.equal(result.loaded.length, 0);
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /pack 'bad' is not readable as JSON/);
    assert.equal(result.caveats.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a problem when the pack file is a JSON array instead of an object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    writeFileSync(join(dir, 'arr.json'), JSON.stringify([1, 2, 3]));
    const result = loadPacks(['arr'], { packDir: dir });
    assert.equal(result.loaded.length, 0);
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /pack 'arr' is not a JSON object/);
    assert.equal(result.caveats.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a pack with no validation when allowUnvalidated is false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    writeFileSync(join(dir, 'plain.json'), JSON.stringify({ name: 'plain', rules: [] }));
    const result = loadPacks(['plain'], { packDir: dir, allowUnvalidated: false });
    assert.equal(result.loaded.length, 0);
    assert.equal(result.refused.length, 1);
    assert.equal(result.refused[0].name, 'plain');
    assert.match(result.refused[0].why, /neither a corpus measurement nor a practitioner review/);
    assert.match(result.refused[0].why, /allowUnvalidatedPacks/);
    assert.equal(result.problems.length, 0);
    assert.equal(result.caveats.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loads a pack with no validation when allowUnvalidated is true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    writeFileSync(join(dir, 'plain.json'), JSON.stringify({ name: 'plain', rules: [] }));
    const result = loadPacks(['plain'], { packDir: dir, allowUnvalidated: true });
    assert.equal(result.loaded.length, 1);
    assert.equal(result.loaded[0].name, 'plain');
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 0);
    assert.equal(result.caveats.length, 2);
    assert.match(result.caveats[0], /plain: no corpus measurement/);
    assert.match(result.caveats[1], /plain: no practitioner review/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loads a pack with corpus validation and reports the missing practitioner review as a caveat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    const pack = { name: 'corp', rules: [], validation: { corpus: { repositories: 5 } } };
    writeFileSync(join(dir, 'corp.json'), JSON.stringify(pack));
    const result = loadPacks(['corp'], { packDir: dir, allowUnvalidated: false });
    assert.equal(result.loaded.length, 1);
    assert.equal(result.loaded[0].name, 'corp');
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 0);
    assert.equal(result.caveats.length, 1);
    assert.match(result.caveats[0], /corp: no practitioner review/);
    assert.equal(result.loaded[0].validation.corpus.repositories, 5);
    assert.equal(result.loaded[0].validation.practitioner, null);
    assert.equal(result.loaded[0].validation.any, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loads a pack with practitioner validation and reports the missing corpus measurement as a caveat', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    const pack = { name: 'prac', rules: [], validation: { practitioner: { by: 'alice' } } };
    writeFileSync(join(dir, 'prac.json'), JSON.stringify(pack));
    const result = loadPacks(['prac'], { packDir: dir, allowUnvalidated: false });
    assert.equal(result.loaded.length, 1);
    assert.equal(result.loaded[0].name, 'prac');
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 0);
    assert.equal(result.caveats.length, 1);
    assert.match(result.caveats[0], /prac: no corpus measurement/);
    assert.equal(result.loaded[0].validation.corpus, null);
    assert.equal(result.loaded[0].validation.practitioner.by, 'alice');
    assert.equal(result.loaded[0].validation.any, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loads a fully validated pack with no caveats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    const pack = { name: 'full', rules: [], validation: { corpus: { repositories: 3 }, practitioner: { by: 'bob' } } };
    writeFileSync(join(dir, 'full.json'), JSON.stringify(pack));
    const result = loadPacks(['full'], { packDir: dir, allowUnvalidated: false });
    assert.equal(result.loaded.length, 1);
    assert.equal(result.loaded[0].name, 'full');
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 0);
    assert.equal(result.caveats.length, 0);
    assert.equal(result.loaded[0].validation.any, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a pack problem when a rule has an unknown scope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadPacks-'));
  try {
    const pack = { name: 'scop', rules: [{ id: 'r1', pattern: 'x', appliesTo: ['bogus'] }], validation: { corpus: { repositories: 1 } } };
    writeFileSync(join(dir, 'scop.json'), JSON.stringify(pack));
    const result = loadPacks(['scop'], { packDir: dir, allowUnvalidated: false });
    assert.equal(result.loaded.length, 0);
    assert.equal(result.refused.length, 0);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /scop:r1: unknown scope 'bogus'/);
    assert.equal(result.caveats.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
