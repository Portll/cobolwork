// SPDX-License-Identifier: AGPL-3.0-or-later
// Recomputes what the z study claims, from the worklist and the engine.
//
//   node diag/check-worklist.mjs [--json]
//
// docs/spec/z-sibling-rules.md says 187 publicly named z vulnerabilities, 83 of them coverable by
// twelve new rules, 70 already covered, 34 with nothing in a repository to see. Those four numbers
// were arrived at by adding up feed/worklists/z-attack-classes.json, and for a week the only way to
// check one was to add it up again - three separate reviewers did exactly that by hand, which is
// the diagnostic rather than the reassurance.
//
// This is the arithmetic, done once, against the file and the live rule catalogue. It answers the
// question the study exists to produce and cannot answer for itself: of the 187, how many does this
// engine now actually report a sibling for?
//
// Exit 0 when every claim holds, 1 when one does not. It asserts nothing the file does not say:
// where a row's verdict or a design's builtAs is wrong, this reports it rather than repairing it.
import { readFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_RULES } from '../lib/scan.mjs';

const WORKLIST = new URL('../feed/worklists/z-attack-classes.json', import.meta.url);
const SPEC = new URL('../docs/spec/z-sibling-rules.md', import.meta.url);

export function checkWorklist(worklist, spec, rules) {
  const advisories = worklist.advisories || [];
  const techniques = worklist.techniques || [];
  const designs = worklist.proposedRules || {};
  const rows = [...advisories, ...techniques];
  const problems = [];

  const count = (list, v) => list.filter((r) => r.verdict === v).length;
  const totals = {
    rows: rows.length,
    advisories: advisories.length,
    techniques: techniques.length,
    covered: count(advisories, 'covered') + count(techniques, 'covered'),
    new: count(advisories, 'new') + count(techniques, 'new'),
    none: count(advisories, 'patch') + count(techniques, 'none'),
  };
  if (totals.covered + totals.new + totals.none !== totals.rows) {
    problems.push(`${totals.rows - (totals.covered + totals.new + totals.none)} row(s) carry a verdict the tally does not recognise`);
  }

  // Duplicate identifiers would inflate every number above without changing any of them visibly.
  const seen = new Set();
  for (const a of advisories) {
    if (seen.has(a.id)) problems.push(`${a.id} appears more than once`);
    seen.add(a.id);
  }

  // The number the study cannot compute for itself: rows whose design has shipped rules, and rows
  // already covered. A row is reported today when the rule its verdict names exists in the engine.
  const built = {};
  for (const [design, d] of Object.entries(designs)) {
    const ids = d.builtAs || [];
    const missing = ids.filter((id) => !rules[id]);
    for (const id of missing) problems.push(`${design} claims ${id}, which the engine does not have`);
    built[design] = ids.length > 0 && missing.length === 0;
  }
  const perDesign = {};
  const reportedPerDesign = {};
  let nowReported = 0;
  let inBuiltDesign = 0;
  for (const r of rows) {
    if (r.verdict !== 'new') continue;
    if (!designs[r.rule]) { problems.push(`a row is assigned to ${r.rule}, which proposedRules does not declare`); continue; }
    perDesign[r.rule] = (perDesign[r.rule] || 0) + 1;
    if (built[r.rule]) inBuiltDesign++;
    // A design that shipped a rule has not thereby covered every row it carries. N-PRIV holds 18
    // rows and five rules, and nothing reports a started task holding more access than its steps
    // use. Counting designs said 39 where counting rows says 26, so rows are what is counted.
    const by = r.reportedBy || [];
    for (const id of by) {
      if (!rules[id]) problems.push(`${r.id || r.name} says ${id} reports it, which the engine does not have`);
      else if (!(designs[r.rule].builtAs || []).includes(id)) {
        problems.push(`${r.id || r.name} says ${id} reports it, but ${r.rule} does not list ${id} in builtAs`);
      }
    }
    if (by.length) { nowReported++; reportedPerDesign[r.rule] = (reportedPerDesign[r.rule] || 0) + 1; }
    else if (!built[r.rule]) continue;
  }
  const designsBuilt = Object.values(built).filter(Boolean).length;

  // Why each row a new rule would report is not reported. "new" was a judgement made before any
  // design was measured, and for a third of these rows the measurement has since falsified it:
  // there is no customer artefact, so the row belongs with the ones nothing can see.
  const KINDS = ['extension', 'estate-fact', 'no-sibling'];
  const why = { extension: 0, 'estate-fact': 0, 'no-sibling': 0, unexplained: 0 };
  for (const r of rows) {
    if (r.verdict !== 'new' || (r.reportedBy || []).length) continue;
    const k = r.whyNotReported && r.whyNotReported.kind;
    if (!k) { why.unexplained++; problems.push((r.id || r.name) + ' is unreported and says nothing about why'); continue; }
    if (!KINDS.includes(k)) { problems.push((r.id || r.name) + ' gives an unknown whyNotReported kind: ' + k); continue; }
    if (!r.whyNotReported.why || r.whyNotReported.why.length < 20) problems.push((r.id || r.name) + ' gives a kind without a reason');
    why[k]++;
  }

  // What the document says about itself, read rather than trusted.
  const claims = [];
  const claim = (what, found, want) => { claims.push({ what, found, want, ok: String(found) === String(want) }); };
  const head = /\*\*(\d+) publicly named z vulnerabilities/.exec(spec);
  claim('total in the study', head ? head[1] : '(not stated)', totals.rows);
  const table = new RegExp(`\\| \\*\\*(\\d+)\\*\\* \\| \\*\\*(\\d+)\\*\\* \\| \\*\\*(\\d+)\\*\\* \\|`).exec(spec);
  claim('advisories in the table', table ? table[1] : '(not stated)', totals.advisories);
  claim('techniques in the table', table ? table[2] : '(not stated)', totals.techniques);
  const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  const b = /\*\*Built\.\*\*\s+(\w+) of the twelve/.exec(spec);
  claim('designs built', b ? b[1] : '(not stated)', WORDS[designsBuilt]);
  for (const [design, n] of Object.entries(perDesign)) {
    const h = new RegExp(`### ${design} - (\\d+) defects?`).exec(spec);
    claim(`${design} heading`, h ? h[1] : '(no heading)', n);
  }
  for (const c of claims) if (!c.ok) problems.push(`the study says ${c.what} is ${c.found}; the worklist says ${c.want}`);

  return { totals, designsBuilt, nowReported, inBuiltDesign, perDesign, reportedPerDesign, built, why, claims, problems };
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const r = checkWorklist(JSON.parse(readFileSync(WORKLIST, 'utf8')), readFileSync(SPEC, 'utf8'), ALL_RULES);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 1));
  } else {
    const { totals } = r;
    console.log(`${totals.rows} publicly named z vulnerabilities: ${totals.advisories} advisories, ${totals.techniques} techniques`);
    console.log(`  ${totals.covered} already covered, ${totals.new} coverable by a new rule, ${totals.none} with nothing in a repository to see\n`);
    console.log(`${r.designsBuilt} of ${Object.keys(r.built).length} designs have shipped rules.`);
    console.log('Shipping a rule for a design does not report every row it carries:\n');
    console.log(`  ${'design'.padEnd(12)} ${'rows'.padStart(5)} ${'reported'.padStart(9)}`);
    for (const [design, ok] of Object.entries(r.built)) {
      const carried = r.perDesign[design] || 0;
      const done = r.reportedPerDesign[design] || 0;
      const bar = done === carried && carried ? 'all' : done ? `${done}/${carried}` : '-';
      console.log(`  ${design.padEnd(12)} ${String(carried).padStart(5)} ${String(bar).padStart(9)}  ${ok ? '' : '(no rule shipped)'}`);
    }
    // The one number nobody could compute before: how much of the record this engine now reaches.
    console.log(`\n${r.nowReported} of the ${totals.new} rows a new rule would report are reported today`);
    console.log(`(counting designs rather than rows would say ${r.inBuiltDesign}, which is the overstatement this replaced),`);
    console.log(`so ${totals.covered + r.nowReported} of ${totals.rows} (${Math.round((100 * (totals.covered + r.nowReported)) / totals.rows)}%) of the public z record now has a sibling this engine reports.`);
    // The other half of the answer: of the rows no rule reports, what it would take to report them.
    console.log(`\nOf the ${totals.new - r.nowReported} rows a new rule would report and none does:`);
    console.log(`  ${String(r.why.extension).padStart(3)} an existing rule reaches with a known change`);
    console.log(`  ${String(r.why['estate-fact']).padStart(3)} need a fact only the estate can supply`);
    console.log(`  ${String(r.why['no-sibling']).padStart(3)} have no customer artefact at all, measured - so the verdict was optimistic for these`);
    console.log(`\nSo of ${totals.rows}: ${totals.covered + r.nowReported} reported, ${r.why.extension + r.why['estate-fact']} reachable, ${totals.none + r.why['no-sibling']} with nothing in a repository to see.`);
    console.log(`\n${r.claims.filter((c) => c.ok).length} of ${r.claims.length} claims in the study match the worklist.`);
    for (const p of r.problems) console.log(`  PROBLEM: ${p}`);
    if (!r.problems.length) console.log('  no disagreement between the study, the worklist and the engine.');
  }
  process.exit(r.problems.length ? 1 : 0);
}
