// SPDX-License-Identifier: AGPL-3.0-or-later
// Precision per rule and per exploitability verdict, from machine labels (docs/spec/reach.md §9.6).
//
//   node bench/precision.mjs <labels.json>... [--corpus <root>] [--out file] [--md file]
//
// Each file is what bench/label.mjs (source `execution`) or bench/seed.mjs (source `planted`)
// wrote. Every number names its label source. An unknown is never counted as right or wrong: a
// rule's precision is the range from every unknown being false to every unknown being true, and is
// one number only where nothing is unknown. Execution labels are joined to their findings'
// verdicts by fingerprint, by scanning each labelled repository under --corpus again.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { scanAll } from '../lib/scan.mjs';

// What a label says of a reported finding: right, wrong, or unknown; and of a planted flaw nobody
// reported, that it was missed. A near-miss nobody reported says nothing about precision.
export function outcomeOf(l) {
  if (l.source === 'planted') {
    if (l.reported) return l.label === 'flaw' ? 'right' : 'wrong';
    return l.label === 'flaw' ? 'missed' : null;
  }
  return l.label === 'confirmed' ? 'right' : l.label === 'refuted' ? 'wrong' : 'unknown';
}

const empty = () => ({ labelled: 0, right: 0, wrong: 0, unknown: 0, missed: 0 });
const ratio = (n, d) => (d ? Math.round((n / d) * 1000) / 1000 : null);

// The range of precision the counts allow, and recall where planting made every flaw known.
export function measure(c, source) {
  const reported = c.right + c.wrong + c.unknown;
  const out = { ...c, precision: reported ? { low: ratio(c.right, reported), high: ratio(c.right + c.unknown, reported) } : null };
  if (source === 'planted') out.recall = ratio(c.right, c.right + c.missed);
  return out;
}

function tally(into, key, source, outcome) {
  const bySource = (into[key] ??= {});
  const c = (bySource[source] ??= empty());
  c.labelled++;
  c[outcome]++;
}

// The verdict of each finding the labels name, by repository and fingerprint.
function verdicts(corpus, labels) {
  const out = new Map();
  for (const repo of new Set(labels.filter((l) => l.source === 'execution' && l.fingerprint).map((l) => l.repo ?? ''))) {
    const root = repo ? join(corpus, repo) : corpus;
    let report;
    try { report = scanAll(root, { only: ['flow'] }); } catch { continue; }
    for (const f of report.findings) if (f.fingerprint && f.exploitability) out.set(`${repo}|${f.fingerprint}`, f.exploitability.verdict);
  }
  return out;
}

export function precision(files, { corpus = null } = {}) {
  const sources = [];
  const labels = [];
  for (const file of files) {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(doc.labels) ? doc.labels : [];
    const kinds = [...new Set(list.map((l) => l.source))];
    sources.push({ file: basename(file), labels: list.length, sources: kinds });
    labels.push(...list);
  }
  const verdictOf = corpus ? verdicts(resolve(corpus), labels) : new Map();
  const byRule = {};
  const byVerdict = {};
  let unjoined = 0;
  for (const l of labels) {
    const outcome = outcomeOf(l);
    if (!outcome || !l.rule || !l.source) continue;
    tally(byRule, l.rule, l.source, outcome);
    if (l.source !== 'execution' || !corpus) continue;
    const verdict = verdictOf.get(`${l.repo ?? ''}|${l.fingerprint}`);
    if (verdict) tally(byVerdict, verdict, l.source, outcome); else unjoined++;
  }
  const finish = (table) => Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, bySource]) => [k, Object.fromEntries(Object.entries(bySource).map(([s, c]) => [s, measure(c, s)]))]));
  return {
    tool: 'cobolwork-precision', sources, labels: labels.length,
    byRule: finish(byRule),
    ...(corpus ? { byVerdict: finish(byVerdict), unjoined } : {}),
  };
}

const pct = (x) => (x == null ? '-' : `${Math.round(x * 1000) / 10}%`);
const range = (p) => (!p ? '-' : p.low === p.high ? pct(p.low) : `${pct(p.low)} to ${pct(p.high)}`);

export function markdown(doc) {
  const table = (title, rows) => [
    `| ${title} | Labels | Right | Wrong | Unknown | Precision | Recall |`,
    '|---|---|---|---|---|---|---|',
    ...Object.entries(rows).flatMap(([k, bySource]) => Object.entries(bySource).map(([s, m]) =>
      `| \`${k}\` | ${s} ${m.labelled} | ${m.right} | ${m.wrong} | ${m.unknown} | ${range(m.precision)} | ${m.recall == null ? '-' : pct(m.recall)} |`)),
  ].join('\n');
  return [
    `From ${doc.labels} machine labels in ${doc.sources.map((s) => `${s.file} (${s.sources.join(', ')})`).join(', ')}.`,
    '',
    table('Rule', doc.byRule),
    ...(doc.byVerdict ? ['', table('Verdict', doc.byVerdict), '', `${doc.unjoined} execution labels matched no finding of a fresh scan and are not in the verdict table.`] : []),
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
    else files.push(a);
  }
  if (!files.length) {
    process.stderr.write('usage: node bench/precision.mjs <labels.json>... [--corpus <root>] [--out file] [--md file]\n');
    return 2;
  }
  const doc = precision(files, opts);
  const text = `${JSON.stringify(doc, null, 1)}\n`;
  if (opts.out) writeFileSync(opts.out, text); else process.stdout.write(text);
  if (opts.md) writeFileSync(opts.md, markdown(doc));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
