// SPDX-License-Identifier: AGPL-3.0-or-later
// How much of a PL/I corpus the reader parses, by statement kind, with the statements it does not
// parse named and sampled.
//
//   node diag/pli-measure.mjs <dir> [--synthetic repoA,repoB] [--samples out.json] [--per-kind 40]
//
// <dir> holds one directory per repository. A repository named in --synthetic is reported apart,
// and the repository-balanced rate weighs each repository once, so one generated estate cannot
// stand in for the population.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { readPli, sourceText } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';

const PLI = /\.(pli|pl1|plx|inc|pcx)$/i;

function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (PLI.test(e)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const blank = () => ({ files: 0, statements: 0, parsed: 0, unbuilt: 0, unparsed: 0, unknown: 0, crashes: 0, lexErrors: 0 });

export function measure(root, { synthetic = [], perKind = 40, statusMap = null } = {}) {
  const byKind = {};
  const byRepo = {};
  const samples = {};
  const sampled = {};
  const reasons = {};
  const seen = new Set();
  let duplicates = 0;
  for (const f of files(root)) {
    const rel = relative(root, f);
    const repo = rel.split('/')[0];
    const buf = readFileSync(f);
    const hash = createHash('sha256').update(buf).digest('hex');
    if (seen.has(hash)) { duplicates++; continue; }
    seen.add(hash);
    const r = (byRepo[repo] ||= blank());
    r.files++;
    const text = sourceText(buf);
    const lines = text.split(/\r?\n/);
    const { statements, diags } = readPli(text, { file: rel });
    r.lexErrors += diags.filter((d) => d.sev === 'error').length;
    for (const st of statements) {
      const res = parseStatement(st);
      const k = (byKind[res.kind] ||= { statements: 0, parsed: 0, unbuilt: 0, unparsed: 0, unknown: 0, crashes: 0 });
      k.statements++; k[res.status]++; r.statements++; r[res.status]++;
      if (res.crash) { k.crashes++; r.crashes++; }
      if (statusMap) statusMap[`${rel}:${st.line}`] = res.status;
      if (res.status !== 'parsed') {
        if (res.status !== 'unbuilt') {
          const why = `${res.kind}: ${String(res.reason).replace(/'[^']*'/g, "'…'")}`;
          reasons[why] = (reasons[why] || 0) + 1;
        }
        const list = (samples[res.kind] ||= []);
        const text = lines.slice(st.line - 1, Math.min(st.endLine, st.line + 7)).join('\n');
        const shape = text.trim().replace(/\s+/g, ' ').slice(0, 24).toUpperCase();
        const shapes = (sampled[res.kind] ||= new Set());
        if (list.length < perKind && !synthetic.includes(repo) && !shapes.has(shape)) {
          shapes.add(shape);
          list.push({ file: rel, line: st.line, status: res.status, reason: res.reason || null, text });
        }
      }
    }
  }
  const sum = (pick) => Object.entries(byRepo).filter(([n]) => pick(n)).reduce((a, [, r]) => { for (const k of Object.keys(a)) a[k] += r[k]; return a; }, blank());
  const rate = (t) => (t.statements ? +(t.parsed / t.statements).toFixed(4) : null);
  const natural = Object.entries(byRepo).filter(([n]) => !synthetic.includes(n));
  const balanced = natural.length ? +(natural.reduce((a, [, r]) => a + (r.statements ? r.parsed / r.statements : 0), 0) / natural.length).toFixed(4) : null;
  const all = sum(() => true);
  const nat = sum((n) => !synthetic.includes(n));
  const topReasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 40);
  return {
    summary: { repos: Object.keys(byRepo).length, duplicateFilesSkipped: duplicates, all: { ...all, rate: rate(all) }, natural: { ...nat, rate: rate(nat) }, repoBalancedRate: balanced, synthetic },
    byKind: Object.fromEntries(Object.entries(byKind).sort((a, b) => b[1].statements - a[1].statements)),
    byRepo: Object.fromEntries(Object.entries(byRepo).sort()),
    topReasons,
    samples,
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
  const dir = args.find((a, k) => !a.startsWith('--') && !(k > 0 && args[k - 1].startsWith('--')));
  const synthetic = String(flag('synthetic', '')).split(',').filter(Boolean);
  const out = measure(dir, { synthetic, perKind: Number(flag('per-kind', 40)) });
  const samplesFile = flag('samples', null);
  if (samplesFile) writeFileSync(samplesFile, JSON.stringify({ samples: out.samples, topReasons: out.topReasons }, null, 1));
  const { samples, ...rest } = out;
  void samples;
  process.stdout.write(JSON.stringify(rest, null, 1) + '\n');
}
