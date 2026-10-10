// SPDX-License-Identifier: AGPL-3.0-or-later
// Precision per rule and per exploitability verdict, from machine labels (docs/spec/reach.md §9.6).
//
//   node bench/precision.mjs <labels.json>... [--corpus <root>] [--assumptions <register.json>]
//        [--out file] [--md file]
//
// Each file is what bench/label.mjs (source `execution`), bench/seed.mjs (source `planted`),
// bench/negatives.mjs --labels (source `generated`, programs built with a known answer) or
// bench/label-review.mjs labels (source `model`) wrote. Every number names its label source. An unknown is never counted as right or wrong: a
// rule's precision is the range from every unknown being false to every unknown being true, and is
// one number only where nothing is unknown. Execution labels are joined to their findings'
// verdicts by fingerprint, by scanning each labelled repository under --corpus again. With
// --assumptions, ironwork's register as `ironwork assumptions --json` writes it, each count also
// says how many of the labels that record their runs' assumptions rest on one ironwork chose rather
// than took from IBM's manuals. Every error-severity rule no label measures is named as unmeasured.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { scanAll } from '../lib/scan.mjs';
import { ALL_RULES } from '../lib/kernel/registry.mjs';
import { LEVEL } from '../lib/sarif.mjs';

// The stratum a label is counted in: its source, and how it was labelled where that is not the
// program as written (labelledOn: rewritten), which is never pooled with the source's own.
const stratumOf = (l) => (l.labelledOn ? `${l.source}-${l.labelledOn}` : l.source);

// What a label says of a reported finding: right, wrong, or unknown; and of a planted flaw or a
// generated positive nobody reported, that it was missed. A near-miss or a generated negative nobody
// reported says nothing about precision. A model label is the judge's or the operator's answer:
// reaches is right, does-not-reach wrong.
export function outcomeOf(l) {
  if (l.source === 'model') return l.label === 'reaches' ? 'right' : l.label === 'does-not-reach' ? 'wrong' : 'unknown';
  if (l.source === 'generated') {
    if (l.reported) return l.label === 'reaches' ? 'right' : 'wrong';
    return l.label === 'reaches' ? 'missed' : null;
  }
  if (l.source === 'planted') {
    if (l.reported) return l.label === 'flaw' ? 'right' : 'wrong';
    return l.label === 'flaw' ? 'missed' : null;
  }
  return l.label === 'confirmed' ? 'right' : l.label === 'refuted' ? 'wrong' : 'unknown';
}

const empty = () => ({ labelled: 0, right: 0, wrong: 0, unknown: 0, missed: 0, recorded: 0, onChosen: 0 });
const ratio = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null);

// The range of precision the counts allow, and recall where planting made every flaw known.
export function measure(c, source, { register = false } = {}) {
  const reported = c.right + c.wrong + c.unknown;
  const out = { ...c, precision: reported ? { low: ratio(c.right, reported), high: ratio(c.right + c.unknown, reported) } : null,
    unknownShare: ratio(c.unknown, reported), onChosen: register ? c.onChosen : null, onChosenShare: register ? ratio(c.onChosen, c.recorded) : null };
  if (source === 'planted' || source === 'generated') out.recall = ratio(c.right, c.right + c.missed);
  return out;
}

function tally(into, key, source, outcome, l, onChosen) {
  const bySource = (into[key] ??= {});
  const c = (bySource[source] ??= empty());
  c.labelled++;
  c[outcome]++;
  if (Array.isArray(l.assumptions)) c.recorded++;
  if (onChosen) c.onChosen++;
}

// Labels a fresh scan can join to their findings by fingerprint.
const joinable = (l) => (l.source === 'execution' || l.source === 'model') && l.fingerprint;

// The verdict of each finding the labels name, by repository and fingerprint.
function verdicts(corpus, labels) {
  const out = new Map();
  for (const repo of new Set(labels.filter(joinable).map((l) => l.repo ?? ''))) {
    const root = repo ? join(corpus, repo) : corpus;
    let report;
    try { report = scanAll(root, { only: ['flow'] }); } catch { continue; }
    for (const f of report.findings) if (f.fingerprint && f.exploitability) out.set(`${repo}|${f.fingerprint}`, f.exploitability.verdict);
  }
  return out;
}

// Error-severity rules (SARIF error) with no label that is right or wrong in any stratum.
export function unmeasured(byRule) {
  const measured = (bySource) => Object.values(bySource || {}).some((c) => c.right + c.wrong > 0);
  return Object.keys(ALL_RULES).filter((id) => LEVEL[ALL_RULES[id].sev] === 'error' && !measured(byRule[id])).sort();
}

export function precision(files, { corpus = null, assumptions = null } = {}) {
  const sources = [];
  const labels = [];
  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(doc.labels) ? doc.labels : [];
    const kinds = [...new Set(list.map(stratumOf))];
    sources.push({ file: basename(file), labels: list.length, sources: kinds });
    labels.push(...list);
  }
  const verdictOf = corpus ? verdicts(resolve(corpus), labels) : new Map();
  const register = assumptions ? JSON.parse(readFileSync(assumptions, 'utf8')) : null;
  const chosen = new Set((register || []).filter((a) => a.basis === 'chosen').map((a) => a.id));
  const onChosen = (l) => (l.assumptions || []).some((id) => chosen.has(id));
  const byRule = {};
  const byVerdict = {};
  let unjoined = 0;
  for (const l of labels) {
    const outcome = outcomeOf(l);
    if (!outcome || !l.rule || !l.source) continue;
    tally(byRule, l.rule, stratumOf(l), outcome, l, onChosen(l));
    if (!joinable(l) || !corpus) continue;
    const verdict = verdictOf.get(`${l.repo ?? ''}|${l.fingerprint}`);
    if (verdict) tally(byVerdict, verdict, stratumOf(l), outcome, l, onChosen(l)); else unjoined++;
  }
  const finish = (table) => Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, bySource]) => [k, Object.fromEntries(Object.entries(bySource).map(([s, c]) => [s, measure(c, s, { register: !!register })]))]));
  return {
    tool: 'cobolwork-precision', sources, labels: labels.length,
    byRule: finish(byRule),
    unmeasured: unmeasured(byRule),
    ...(register ? { assumptions: { file: basename(assumptions), chosen: chosen.size } } : {}),
    ...(corpus ? { byVerdict: finish(byVerdict), unjoined } : {}),
  };
}

const pct = (x) => (x == null ? '-' : `${Math.round(x * 1000) / 10}%`);
const range = (p) => (!p ? '-' : p.low === p.high ? pct(p.low) : `${pct(p.low)} to ${pct(p.high)}`);

export function markdown(doc) {
  const table = (title, rows) => [
    `| ${title} | Labels | Right | Wrong | Unknown | Unknown share | On chosen assumptions | Precision | Recall |`,
    '|---|---|---|---|---|---|---|---|---|',
    ...Object.entries(rows).flatMap(([k, bySource]) => Object.entries(bySource).map(([s, m]) =>
      `| \`${k}\` | ${s} ${m.labelled} | ${m.right} | ${m.wrong} | ${m.unknown} | ${pct(m.unknownShare)} | ${m.onChosenShare == null ? '-' : `${pct(m.onChosenShare)} of ${m.recorded}`} | ${range(m.precision)} | ${m.recall == null ? '-' : pct(m.recall)} |`)),
  ].join('\n');
  return [
    `From ${doc.labels} labels in ${doc.sources.map((s) => `${s.file} (${s.sources.join(', ')})`).join(', ')}.`,
    '',
    table('Rule', doc.byRule),
    ...(doc.byVerdict ? ['', table('Verdict', doc.byVerdict), '', `${doc.unjoined} labels with a fingerprint matched no finding of a fresh scan and are not in the verdict table.`] : []),
    '', doc.unmeasured.length ? `Unmeasured: ${doc.unmeasured.length} error-severity rules have no label that is right or wrong: ${doc.unmeasured.map((r) => `\`${r}\``).join(', ')}.` : 'Every error-severity rule has a label that is right or wrong.',
    '',
  ].join('\n');
}

function main(argv) {
  const files = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus') opts.corpus = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--md') opts.md = argv[++i];
    else if (a === '--assumptions') opts.assumptions = argv[++i];
    else files.push(a);
  }
  if (!files.length) {
    process.stderr.write('usage: node bench/precision.mjs <labels.json>... [--corpus <root>] [--assumptions <register.json>] [--out file] [--md file]\n');
    return 2;
  }
  const doc = precision(files, opts);
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  if (opts.out) writeFileSync(opts.out, text); else process.stdout.write(text);
  if (opts.md) writeFileSync(opts.md, markdown(doc));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
