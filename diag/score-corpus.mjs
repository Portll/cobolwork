// Scores each exploitability verdict against machine labels: the execution labels bench/label.mjs
// wrote, joined by fingerprint to the verdicts of a fresh scan of --corpus.
//
//   node diag/score-corpus.mjs <labels.json>... --corpus <root> [--json out.json]
//
// A verdict is scored on the labels of its findings. An unknown label is neither right nor wrong,
// so each verdict carries the range its unknowns allow and a 95% Wilson interval over the labels
// that decided it. Every row names its label source.
import { writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { precision } from '../bench/precision.mjs';
import { EXPLOITABILITY } from '../lib/kernel/findings.mjs';

const round = (x) => Math.round(x * 1000) / 1000;

// A 95% Wilson interval. The normal approximation leaves [0, 1] and narrows to nothing at a
// precision of 1 over a handful of labels, which is where a verdict's figure usually is.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))];
}

// One row per verdict and label source, from the precision document's byVerdict table.
export function scoreVerdicts(doc) {
  const rows = [];
  for (const verdict of Object.keys(EXPLOITABILITY)) {
    for (const [source, m] of Object.entries(doc.byVerdict?.[verdict] ?? {})) {
      const decided = m.right + m.wrong;
      rows.push({ verdict, source, labelled: m.labelled, right: m.right, wrong: m.wrong, unknown: m.unknown,
        precision: m.precision, decided, interval: wilson(m.right, decided) });
    }
  }
  return rows;
}

export const NOT_COVERED = [
  'An execution label confirms a finding or leaves it unknown and never refutes one, so a verdict\'s wrong count is zero and its range is set by the unknowns.',
  'A label covers the findings a run could reach: sources the labeller does not feed yet, and sinks ironwork does not trace, are unknown.',
  'A verdict with no label has no row, which is not a score of zero.',
];

const pct = (x) => (x == null ? '-' : `${Math.round(x * 1000) / 10}%`);

export function report(doc, rows) {
  const out = [`${doc.labels} machine labels from ${doc.sources.map((s) => `${s.file} (${s.sources.join(', ')})`).join(', ')}`];
  if (!rows.length) return [...out, '', 'no label matched a finding of the scan, so no verdict is scored'].join('\n');
  out.push('', 'verdict            source      labels  right  wrong  unknown  precision (unknowns as wrong to right)   Wilson over decided');
  for (const r of rows) {
    const p = r.precision ? `${pct(r.precision.low)} to ${pct(r.precision.high)}` : '-';
    const w = r.interval ? `[${r.interval[0].toFixed(2)}, ${r.interval[1].toFixed(2)}] of ${r.decided}` : '-';
    out.push(`${r.verdict.padEnd(19)}${r.source.padEnd(12)}${[r.labelled, r.right, r.wrong, r.unknown].map((x) => String(x).padStart(6)).join(' ')}   ${p.padEnd(38)} ${w}`);
  }
  out.push('', 'What these figures do not cover:', ...NOT_COVERED.map((n) => `  - ${n}`));
  return out.join('\n');
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--corpus', '--json'].includes(args[i - 1])));
  if (!files.length || !val('--corpus')) {
    process.stderr.write('usage: node diag/score-corpus.mjs <labels.json>... --corpus <root> [--json out.json]\n');
    process.exit(2);
  }
  let doc;
  try { doc = precision(files, { corpus: val('--corpus') }); } catch (e) {
    process.stderr.write(`score-corpus: ${e.message}\n`);
    process.exit(2);
  }
  const rows = scoreVerdicts(doc);
  if (val('--json')) writeFileSync(val('--json'), JSON.stringify({ ...doc, verdicts: rows }, null, 1));
  process.stdout.write(`${report(doc, rows)}\n`);
}
