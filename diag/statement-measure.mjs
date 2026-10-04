// SPDX-License-Identifier: AGPL-3.0-or-later
// How much of a corpus a statement reader parses, by statement kind, with what it does not parse
// named and sampled. Each language supplies which files are its own, how to read them into
// statements and how to parse one; diag/ims-measure.mjs and diag/db2-measure.mjs are the two.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const blank = () => ({ files: 0, statements: 0, parsed: 0, unbuilt: 0, unparsed: 0, unknown: 0, crashes: 0 });

function files(dir, accept) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (accept(p)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// UTF-8 where the bytes are valid UTF-8, else Latin-1.
const decode = (buf) => { const t = buf.toString('utf8'); return t.includes('�') ? buf.toString('latin1') : t; };

export function measureStatements(root, { accept, read, parse, synthetic = [], perKind = 40, statusMap = null }) {
  const byKind = {};
  const byRepo = {};
  const samples = {};
  const sampled = {};
  const reasons = {};
  const seen = new Set();
  let duplicates = 0;
  for (const f of files(root, accept)) {
    const rel = relative(root, f);
    const repo = rel.split('/')[0];
    const buf = readFileSync(f);
    const hash = createHash('sha256').update(buf).digest('hex');
    if (seen.has(hash)) { duplicates++; continue; }
    seen.add(hash);
    const r = (byRepo[repo] ||= blank());
    r.files++;
    const text = decode(buf);
    const lines = text.split(/\r?\n/);
    for (const st of read(text)) {
      const res = parse(st);
      const k = (byKind[res.kind] ||= { statements: 0, parsed: 0, unbuilt: 0, unparsed: 0, unknown: 0, crashes: 0 });
      k.statements++; k[res.status]++; r.statements++; r[res.status]++;
      if (res.crash) { k.crashes++; r.crashes++; }
      if (statusMap) statusMap[`${rel}:${st.line}`] = res.status;
      if (res.status === 'parsed') continue;
      if (res.status !== 'unbuilt') {
        const why = `${res.kind}: ${String(res.reason).replace(/'[^']*'/g, "'…'")}`;
        reasons[why] = (reasons[why] || 0) + 1;
      }
      const list = (samples[res.kind] ||= []);
      const src = lines.slice(st.line - 1, Math.min(st.endLine ?? st.line, st.line + 7)).join('\n');
      const shape = src.trim().replace(/\s+/g, ' ').slice(0, 24).toUpperCase();
      const shapes = (sampled[res.kind] ||= new Set());
      if (list.length < perKind && !synthetic.includes(repo) && !shapes.has(shape)) {
        shapes.add(shape);
        list.push({ file: rel, line: st.line, status: res.status, reason: res.reason || null, text: src });
      }
    }
  }
  const sum = (pick) => Object.entries(byRepo).filter(([n]) => pick(n)).reduce((a, [, r]) => { for (const k of Object.keys(a)) a[k] += r[k]; return a; }, blank());
  const rate = (t) => (t.statements ? +(t.parsed / t.statements).toFixed(4) : null);
  const natural = Object.entries(byRepo).filter(([n]) => !synthetic.includes(n));
  const all = sum(() => true);
  const nat = sum((n) => !synthetic.includes(n));
  return {
    summary: {
      repos: Object.keys(byRepo).length, duplicateFilesSkipped: duplicates,
      all: { ...all, rate: rate(all) }, natural: { ...nat, rate: rate(nat) },
      repoBalancedRate: natural.length ? +(natural.reduce((a, [, r]) => a + (r.statements ? r.parsed / r.statements : 0), 0) / natural.length).toFixed(4) : null,
      synthetic,
    },
    byKind: Object.fromEntries(Object.entries(byKind).sort((a, b) => b[1].statements - a[1].statements)),
    byRepo: Object.fromEntries(Object.entries(byRepo).sort()),
    topReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 40),
    samples,
  };
}

// The command line both languages share: <dir> [--synthetic a,b] [--samples out.json] [--per-kind n].
export function cli(measure) {
  const args = process.argv.slice(2);
  const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
  const dir = args.find((a, k) => !a.startsWith('--') && !(k > 0 && args[k - 1].startsWith('--')));
  const out = measure(dir, { synthetic: String(flag('synthetic', '')).split(',').filter(Boolean), perKind: Number(flag('per-kind', 40)) });
  const samplesFile = flag('samples', null);
  if (samplesFile) import('node:fs').then(({ writeFileSync }) => writeFileSync(samplesFile, JSON.stringify({ samples: out.samples, topReasons: out.topReasons }, null, 1)));
  const { samples, ...rest } = out;
  void samples;
  process.stdout.write(JSON.stringify(rest, null, 1) + '\n');
}
