// lib/words.mjs is the one file in this repository whose licence depends on where its contents came
// from, so where they came from is a tested property rather than a claim in a comment.
// provenance/words.json records which document attests each word, and the generated file must match
// what the provenance produces, so a word cannot enter the parser's vocabulary without a source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './pin-machine.mjs';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RESERVED_WORDS, SPECIAL_REGISTERS, SYSTEM_NAMES, INTRINSIC_FUNCTIONS,
  CONTEXT_SENSITIVE_WORDS, DIRECTIVE_WORDS, EXCEPTION_CONDITIONS,
  EIB_LAYOUT, EIB_FIELDS, DIB_FIELDS, SQLCA_FIELDS,
} from '../lib/words.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROV = join(ROOT, 'provenance', 'words.json');
const prov = JSON.parse(readFileSync(PROV, 'utf8'));

const SETS = [
  ['reserved', RESERVED_WORDS, 'RESERVED_WORDS'],
  ['register', SPECIAL_REGISTERS, 'SPECIAL_REGISTERS'],
  ['systemName', SYSTEM_NAMES, 'SYSTEM_NAMES'],
  ['function', INTRINSIC_FUNCTIONS, 'INTRINSIC_FUNCTIONS'],
  ['contextSensitive', CONTEXT_SENSITIVE_WORDS, 'CONTEXT_SENSITIVE_WORDS'],
  ['directive', DIRECTIVE_WORDS, 'DIRECTIVE_WORDS'],
  ['condition', EXCEPTION_CONDITIONS, 'EXCEPTION_CONDITIONS'],
];

const everyWord = () => SETS.flatMap(([, set]) => [...set]);

test('every word the parser knows has a document that attests it', () => {
  for (const [kind, set, name] of SETS) {
    const unattested = [...set].filter((w) => !prov.words[w] || !prov.words[w].kinds.includes(kind));
    assert.deepEqual(unattested, [], `${name}: no provenance for ${unattested.slice(0, 10).join(', ')}`);
    for (const w of set) {
      assert.ok(prov.words[w].sources.length > 0, `${w} names no source`);
      for (const s of prov.words[w].sources) assert.ok(prov.sources[s], `${w} cites unknown source ${s}`);
    }
  }
});

test('every source is citable: a title, a publisher, a document with a URL and a retrieval date', () => {
  const ids = Object.keys(prov.sources);
  assert.ok(ids.length >= 3, `${ids.length} sources`);
  for (const [id, s] of Object.entries(prov.sources)) {
    assert.ok(s.title && s.title.length > 10, `${id}: title too thin to cite`);
    assert.ok(s.publisher, `${id}: no publisher`);
    assert.ok(s.method && s.method.length > 20, `${id}: no repeatable method`);
    assert.ok(Array.isArray(s.documents) && s.documents.length > 0, `${id}: no documents`);
    // A text rendering of a cited PDF is not a separate source and has no URL of its own; it must say
    // that it is derived, so nothing can pass as fetched without an address to check it against.
    const fetched = s.documents.filter((d) => !/^\(derived/.test(d.url || ''));
    assert.ok(fetched.length > 0, `${id}: every document is derived, so nothing was actually fetched`);
    for (const d of fetched) {
      assert.match(d.url || '', /^https?:\/\//, `${id}: document without a URL`);
      assert.match(d.retrieved || '', /^\d{4}-\d{2}-\d{2}$/, `${id}: document without a retrieval date`);
    }
  }
});

// The generated file matching its generator is what makes the provenance binding rather than
// decorative: a word hand-added to lib/words.mjs fails here instead of quietly entering the
// vocabulary with no source behind it.
test('lib/words.mjs is exactly what the provenance generates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-words-'));
  try {
    const out = join(dir, 'words.mjs');
    execFileSync(process.execPath, [join(ROOT, 'diag', 'generate-words.mjs'), PROV, out], { stdio: 'pipe' });
    const want = readFileSync(out, 'utf8').replace(/\r\n/g, '\n');
    const have = readFileSync(join(ROOT, 'lib', 'words.mjs'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(have, want, 'lib/words.mjs differs from the provenance: regenerate it, or add the source');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// COUNT-LEADLING is a misspelling no standard or vendor manual contains.
test('a misspelling no manual contains is not a word', () => {
  const all = new Set(everyWord());
  assert.ok(!all.has('COUNT-LEADLING'), 'COUNT-LEADLING is not a COBOL word');
  assert.ok(!Object.keys(prov.words).includes('COUNT-LEADLING'), 'and nothing attests it');
});

test('no word is malformed, lowercase, or a parse artefact', () => {
  const all = everyWord();
  for (const w of all) {
    assert.equal(w, w.toUpperCase(), `${w} is not uppercase`);
    // LC_ALL through LC_TIME are the standard's locale category names and carry an underscore.
    assert.match(w, /^[A-Z0-9][A-Z0-9_-]*$/, `${w} is not a COBOL word`);
    assert.ok(!w.endsWith('-'), `${w} ends in a hyphen`);
    assert.ok(w.length <= 40, `${w} is too long`);
    assert.ok(/[A-Z]/.test(w), `${w} has no letter, so the parser would skip it anyway`);
  }
  // "X" as a bare word is a real Micro Focus picture-ish reserved word, but it is also what a marker
  // column in IBM's reserved-word table contains, so it has to be attested by more than one source
  // or by a source that is not a marker table.
  if (RESERVED_WORDS.has('X')) {
    assert.ok(prov.words.X.sources.length >= 1, 'X needs a source that is not a marker column');
  }
});

test('the interface blocks are declared the way a translator would declare them', () => {
  assert.equal(EIB_FIELDS.size, EIB_LAYOUT.length, 'every EIB field comes from the layout');
  for (const [name, pic] of EIB_LAYOUT) {
    assert.match(name, /^EIB[A-Z0-9]+$/, `${name} is not an EIB field`);
    assert.match(pic, /^[SX9]+(\(\d+\))?(\s+COMP(-\d+)?)?$/i, `${name}: ${pic} is not a PICTURE the precompiler can write`);
  }
  for (const f of DIB_FIELDS) assert.match(f, /^DIB[A-Z0-9]+$/);
  for (const f of SQLCA_FIELDS) assert.match(f, /^SQL[A-Z0-9]+$/);
});
