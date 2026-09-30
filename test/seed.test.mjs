// The seeding harness over this repository's own fixtures: every operator must find hosts, plant
// every flaw and near-miss into each of them, label each planted program, and leave nothing behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed, OPERATORS, NEAR_MISS } from '../bench/seed.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// The rule takes any mention of EIBCALEN for a test of it, so a copy nothing tests hides the flaw.
const KNOWN_MISSES = new Set(['length-copied-never-tested']);

test('every operator plants its flaws and near-misses into the same hosts and labels each program', () => {
  const corpus = mkdtempSync(join(tmpdir(), 'cobolwork-seed-corpus-'));
  try {
    cpSync(join(FIXTURES, 'cics'), join(corpus, 'cics'), { recursive: true });
    cpSync(join(FIXTURES, 'callsize'), join(corpus, 'calls'), { recursive: true });
    const before = readdirSync(tmpdir()).filter(n => n.startsWith('cobolwork-seed-') && !corpus.endsWith(n)).length;
    const out = seed(corpus, { perOperator: 2 });
    assert.deepEqual(Object.keys(out.operators), Object.keys(OPERATORS));
    for (const [op, r] of Object.entries(out.operators)) {
      assert.ok(r.hosts.length >= 1, `${op} found no host`);
      assert.ok(Object.values(r.variants).some(s => s.label === NEAR_MISS), `${op} has no near-miss`);
      for (const [v, s] of Object.entries(r.variants)) {
        assert.equal(s.planted, r.hosts.length, `${op} planted ${v} in only some hosts`);
        if (s.label === NEAR_MISS) assert.equal(s.reported, 0, `${op} reported ${r.falseAlarms.join(', ')}`);
        else if (!KNOWN_MISSES.has(v)) assert.equal(s.reported, s.planted, `${op} missed ${r.missed.join(', ')}`);
      }
    }
    // A host that declares its communication area and never reads it is refused, not counted.
    assert.equal(out.operators['drop-length-check'].skipped['does not read a communication area'], 1);

    const planted = Object.values(out.operators).reduce((n, r) => n + r.planted + r.nearMisses, 0);
    assert.equal(out.labels.length, planted);
    for (const l of out.labels) {
      assert.equal(l.source, 'planted');
      assert.equal(l.label, OPERATORS[l.operator].variants[l.variant].label);
      assert.equal(typeof l.reported, 'boolean');
      assert.ok(out.operators[l.operator].hosts.includes(l.host));
    }

    const after = readdirSync(tmpdir()).filter(n => n.startsWith('cobolwork-seed-') && !corpus.endsWith(n)).length;
    assert.equal(after, before, 'the working directory is removed');
  } finally {
    rmSync(corpus, { recursive: true, force: true });
  }
});
