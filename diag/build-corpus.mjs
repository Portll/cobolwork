// Runs the build gate over a corpus one repository at a time, in absolute mode with no compiler, and
// writes one line per repository: the verdict, which check kept it from being decided, and where the
// repository could have told the gate its compiler options. What it measures is how far the gate is
// from a decided verdict on code nobody configured for it, and which reader would close the gap.
//   node diag/build-corpus.mjs <corpus-root> [--out rows.ndjson] [--from <repo>] [--limit n]
//                              [--repos <list.tsv>]
// --repos names a sample: a TSV whose `folder` column, or first column, holds the directory names.
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { build } from '../lib/build.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { isProgram, isJcl, readSource } from '../lib/sources.mjs';
import { optionCards } from '../lib/options.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const root = resolve(args.find((a, i) => !a.startsWith('--') && !['--out', '--from', '--limit', '--repos'].includes(args[i - 1])) || '.');
const sample = flag('--repos');
const out = resolve(flag('--out') || 'build-corpus.ndjson');
const from = flag('--from');
const limit = Number(flag('--limit') || Infinity);

// Build scripts that could name cobc's options: a Makefile, a shell or batch script, a CI workflow.
const SCRIPT = /(^|\/)(makefile|gnumakefile|[^/]*\.(mk|sh|bash|bat|cmd|ps1|ya?ml|json|groovy|gradle|xml))$/i;
const COBC = /(^|[\s"'/])cobc(\.exe)?(\s|$)/m;
const IBM_COMPILE = /\bEXEC\s+(?:PGM=IGYCRCTL|PROC=IGYWC\w*|IGYWC\w*)\b/i;

// Where a repository could tell the gate how its programs are compiled.
function optionSources(repo) {
  const tree = directoryTree(repo);
  const files = [...new Set(tree.list())];
  let cards = 0, cardPrograms = 0, cobcScripts = 0, compileJcl = 0, programs = 0;
  for (const f of files) {
    const rel = f.slice(repo.length + 1);
    try {
      if (isProgram(f)) {
        programs++;
        const n = optionCards(readSource(f).text).length;
        cards += n;
        if (n) cardPrograms++;
      } else if (isJcl(f)) {
        if (IBM_COMPILE.test(readSource(f).text)) compileJcl++;
      } else if (SCRIPT.test(rel) || !extname(f)) {
        if (statSync(f).size < 1 << 20 && COBC.test(readSource(f).text)) cobcScripts++;
      }
    } catch { /* unreadable: the scan already counts it */ }
  }
  return { programs, cardPrograms, cards, cobcScripts, compileJcl };
}

const setsOf = (report) => (report.summary.setsIncomplete || []).map((s) => ({ set: s.set, kind: s.kind, why: String(s.why || '').slice(0, 200) }));

function sampleNames(file) {
  const [head, ...rows] = readFileSync(file, 'utf8').trim().split(/\r?\n/).map((l) => l.split('\t'));
  const col = Math.max(0, head.indexOf('folder'));
  return rows.map((r) => r[col]).filter(Boolean);
}
const repos = sample
  ? sampleNames(resolve(sample)).filter((n) => { try { return statSync(join(root, n)).isDirectory(); } catch { return false; } }).sort()
  : readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
const start = from ? Math.max(0, repos.indexOf(from)) : 0;
if (!from) writeFileSync(out, '');
let n = 0;
for (const name of repos.slice(start)) {
  if (n++ >= limit) break;
  const repo = join(root, name);
  const t0 = Date.now();
  const row = { repo: name };
  try {
    const { doc, report } = build(repo, { now: '2026-09-27T00:00:00.000Z' });
    const because = {};
    for (const f of doc.blocking) because[f.because] = (because[f.because] || 0) + 1;
    const blockingByTier = {};
    for (const f of doc.blocking) blockingByTier[f.tier] = (blockingByTier[f.tier] || 0) + 1;
    Object.assign(row, {
      verdict: doc.verdict,
      checks: doc.checks,
      byTier: doc.summary.byTier,
      blocking: doc.blocking.length,
      blockingByTier,
      because,
      blockingRules: [...new Set(doc.blocking.map((f) => f.rule))].sort(),
      coverage: { incomplete: doc.summary.coverageIncomplete, copiesMissing: report.summary.copiesMissing || 0, filesUnreadable: report.summary.filesUnreadable || 0, sets: setsOf(report) },
      optionReasons: doc.reasons.filter((r) => /option|SSRANGE|compilerOptions|cobc/.test(r)).slice(0, 3),
      files: report.summary.filesScanned,
      sources: optionSources(repo),
    });
  } catch (e) {
    Object.assign(row, { verdict: 'error', error: String(e && e.message ? e.message : e).slice(0, 300), code: e && e.code });
  }
  row.secs = Math.round((Date.now() - t0) / 100) / 10;
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  process.stderr.write(`${basename(repo)} ${row.verdict} ${row.secs}s\n`);
}
