// The z worklist holds 187 classified rows and twelve rule designs, and the study in
// docs/spec/z-sibling-rules.md makes arithmetic claims about them. Until this file existed nothing
// connected the three: the link from a design name to the rules that shipped for it lived only in a
// markdown table, so renaming a rule made the spec silently wrong, and building one left the
// worklist still saying the defect was uncovered.
//
// One of those claims had already rotted. Section 6 read "Three of the twelve" above a table
// listing five, because the table grew and the sentence above it did not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_RULES } from '../lib/scan.mjs';
import { checkWorklist } from '../diag/check-worklist.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKLIST = JSON.parse(readFileSync(join(HERE, '..', 'feed', 'worklists', 'z-attack-classes.json'), 'utf8'));
const SPEC = readFileSync(join(HERE, '..', 'docs', 'spec', 'z-sibling-rules.md'), 'utf8');

const ADVISORIES = WORKLIST.advisories;
const TECHNIQUES = WORKLIST.techniques;
const DESIGNS = WORKLIST.proposedRules;
const count = (list, verdict) => list.filter((r) => r.verdict === verdict).length;

test('every rule the worklist says shipped is a rule the engine has', () => {
  // This is the link the markdown table used to carry alone. A rename now fails here.
  for (const [design, r] of Object.entries(DESIGNS)) {
    for (const id of r.builtAs) {
      assert.ok(ALL_RULES[id], `${design} claims ${id}, which is not in ALL_RULES`);
    }
  }
});

test('the study and the worklist agree on how many designs are built', () => {
  const built = Object.values(DESIGNS).filter((r) => r.builtAs.length).length;
  const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  const claimed = /\*\*Built\.\*\*\s+(\w+) of the twelve/.exec(SPEC);
  assert.ok(claimed, 'section 6 states how many are built');
  assert.equal(claimed[1], WORDS[built], `the worklist says ${built} designs have shipped rules`);
});

test('the study and the worklist agree on every headline number', () => {
  const covered = count(ADVISORIES, 'covered') + count(TECHNIQUES, 'covered');
  const fresh = count(ADVISORIES, 'new') + count(TECHNIQUES, 'new');
  const none = count(ADVISORIES, 'patch') + count(TECHNIQUES, 'none');
  const total = ADVISORIES.length + TECHNIQUES.length;
  assert.equal(total, 187);
  assert.equal(covered + fresh + none, total, 'every row has a verdict the tally recognises');
  for (const n of [String(total), String(fresh), String(covered), String(none)]) {
    assert.ok(SPEC.includes(n), `the study states ${n}`);
  }
  assert.match(SPEC, new RegExp(`\\*\\*${total} publicly named z vulnerabilities`));
  assert.match(SPEC, new RegExp(`\\| \\*\\*${ADVISORIES.length}\\*\\* \\| \\*\\*${TECHNIQUES.length}\\*\\* \\| \\*\\*${total}\\*\\* \\|`));
});

test('every design named by a row is a design the worklist declares', () => {
  const per = {};
  for (const r of [...ADVISORIES, ...TECHNIQUES]) {
    if (r.verdict !== 'new') continue;
    assert.ok(DESIGNS[r.rule], `a row is assigned to ${r.rule}, which proposedRules does not declare`);
    per[r.rule] = (per[r.rule] || 0) + 1;
  }
  // Section 4 gives each design a defect count in its heading. Those must be these counts.
  for (const [design, n] of Object.entries(per)) {
    const heading = new RegExp(`### ${design} - ${n} defects?`);
    assert.match(SPEC, heading, `section 4 heads ${design} with ${n}`);
  }
  assert.equal(Object.values(per).reduce((a, b) => a + b, 0), count(ADVISORIES, 'new') + count(TECHNIQUES, 'new'));
});

test('a design with no rows is not carried, and every design is reachable', () => {
  const used = new Set([...ADVISORIES, ...TECHNIQUES].filter((r) => r.verdict === 'new').map((r) => r.rule));
  assert.deepEqual([...Object.keys(DESIGNS)].filter((d) => !used.has(d)), [],
    'a design nothing is assigned to is a design nothing would ever build');
  assert.equal(Object.keys(DESIGNS).length, 12);
});

test('every advisory is identified the way a reader could look it up', () => {
  for (const a of ADVISORIES) {
    assert.match(a.id, /^CVE-\d{4}-\d{4,}$/, `${a.id} is shaped like a CVE identifier`);
    assert.ok(['covered', 'new', 'patch'].includes(a.verdict), `${a.id} has a verdict`);
    if (a.verdict === 'new') assert.ok(a.rule, `${a.id} names the design that would report it`);
  }
});

test('every technique says where it was published', () => {
  // These are the half of the record that never became a CVE, so the source IS the identifier.
  for (const t of TECHNIQUES) {
    assert.ok(t.source && t.source.length > 5, `${t.name} says where it came from`);
    assert.ok(['covered', 'new', 'none'].includes(t.verdict), `${t.name} has a verdict`);
  }
});

test('the study, the worklist and the engine agree, computed rather than re-added', () => {
  // Three reviewers re-added 70/83/34 by hand in one week, which is the diagnostic rather than the
  // reassurance. diag/check-worklist.mjs does the arithmetic once, against the file and the live
  // catalogue, and reports every disagreement instead of repairing one.
  const r = checkWorklist(WORKLIST, SPEC, ALL_RULES);
  assert.deepEqual(r.problems, []);
  assert.equal(r.totals.rows, 187);
  assert.equal(r.totals.covered + r.totals.new + r.totals.none, r.totals.rows);
  assert.equal(r.claims.every((c) => c.ok), true, 'every numeric claim in the study matches the file');
});

test('how much of the public record this engine reaches is a number, not an estimate', () => {
  // The one question the study could not answer about itself: of the 187, how many does the engine
  // report a sibling for today? It was 70 when the study was written and nothing recomputed it.
  const r = checkWorklist(WORKLIST, SPEC, ALL_RULES);
  assert.equal(r.designsBuilt, Object.values(r.built).filter(Boolean).length);
  assert.ok(r.nowReported > 0 && r.nowReported <= r.totals.new);
  const reached = r.totals.covered + r.nowReported;
  assert.ok(reached > r.totals.covered, 'building rules moved the number');
  assert.ok(reached <= r.totals.rows);
});

test('every row no rule reports says why, in a vocabulary of three', () => {
  // "Coverable by a new rule" was judged from a CVE description before any design was measured,
  // and for 33 rows the measurement disproved it. A row that just sits unreported hides that.
  const r = checkWorklist(WORKLIST, SPEC, ALL_RULES);
  assert.equal(r.why.unexplained, 0, 'no row is unreported without saying why');
  assert.equal(r.why.extension + r.why['estate-fact'] + r.why['no-sibling'], r.totals.new - r.nowReported);
  assert.ok(r.why['no-sibling'] > 0, 'and the optimistic verdicts are counted rather than quietly kept');
});

test('a reason has to be a reason, not a cross-reference', () => {
  // Six rows first said "as CVE-2022-34309", which reads as an answer and is not one. The check
  // caught all six.
  const short = { ...WORKLIST, advisories: WORKLIST.advisories.map((a) => (a.whyNotReported
    ? { ...a, whyNotReported: { ...a.whyNotReported, why: 'as above' } } : a)) };
  const r = checkWorklist(short, SPEC, ALL_RULES);
  assert.ok(r.problems.some((p) => /gives a kind without a reason/.test(p)));
});

test('the sweep can still find every source the worklist was built from', () => {
  // diag/sweep-z.mjs reads these to re-run the sweep. An empty list would make a clean sweep
  // result meaningless, which is the failure this project exists to refuse.
  assert.ok(WORKLIST.sources.cpe.length > 0);
  assert.ok(WORKLIST.sources.keyword.length > 0);
  assert.ok(WORKLIST.sources.cpe.some((c) => c.includes('z\\/os')), 'the z/OS CPE keeps its backslash');
});
