// The seeding harness over this repository's own fixtures: every operator must find hosts, plant
// only flaws its rule can see, and leave nothing behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed, OPERATORS } from '../bench/seed.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('every operator plants a flaw its rule finds, in hosts it did not write', () => {
  const corpus = mkdtempSync(join(tmpdir(), 'cobolwork-seed-corpus-'));
  try {
    cpSync(join(FIXTURES, 'cics'), join(corpus, 'cics'), { recursive: true });
    cpSync(join(FIXTURES, 'callsize'), join(corpus, 'calls'), { recursive: true });
    const before = readdirSync(tmpdir()).filter(n => n.startsWith('cobolwork-seed-') && !corpus.endsWith(n)).length;
    const out = seed(corpus, { perOperator: 2 });
    assert.deepEqual(Object.keys(out.operators), Object.keys(OPERATORS));
    for (const [op, r] of Object.entries(out.operators)) {
      assert.ok(r.planted >= 1, `${op} found no host`);
      assert.equal(r.found, r.planted, `${op} missed ${r.missed.join(', ')}`);
    }
    // A host that declares its communication area and never reads it is refused, not counted.
    assert.equal(out.operators['drop-length-check'].skipped['does not read a communication area'], 1);
    const after = readdirSync(tmpdir()).filter(n => n.startsWith('cobolwork-seed-') && !corpus.endsWith(n)).length;
    assert.equal(after, before, 'the working directory is removed');
  } finally {
    rmSync(corpus, { recursive: true, force: true });
  }
});
