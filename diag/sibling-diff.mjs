// Runs the data-flow pass twice over each repository, once with the pre-fix group edges (up then
// down allowed) and once as shipped, and classifies every finding only the old rule produced:
//   sibling     up then immediately down — a field no statement wrote from the source
//   positional  up, a whole-group move, then down — the value may really sit in that child
// The second class is what the fix gives up, and this is where its size is measured.
//
//   node diag/sibling-diff.mjs <corpus-root> [--out file.json]
import { readdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../lib/dataflow.mjs';

const [root] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : null;
const repos = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();

const key = (f) => `${f.rule}|${f.source.file}:${f.source.line}|${f.sink.file}:${f.sink.line}`;
function classify(path) {
  let up = false;
  let moved = false;
  for (const hop of path) {
    if (hop.dir === 'up') { up = true; moved = false; continue; }
    if (hop.dir === 'down' && up) return moved ? 'positional' : 'sibling';
    if (up && hop.via && hop.via !== 'group') moved = true;
  }
  return 'other';
}

const totals = { repos: 0, legacy: 0, shipped: 0, dropped: 0, added: 0, byClass: {}, byRule: {} };
const rows = [];
for (const repo of repos) {
  const legacy = analyze(root, { repos: [repo], legacyGroupEdges: true });
  const shipped = analyze(root, { repos: [repo] });
  totals.repos++;
  totals.legacy += legacy.findings.length;
  totals.shipped += shipped.findings.length;
  const now = new Set(shipped.findings.map(key));
  const before = new Set(legacy.findings.map(key));
  for (const f of shipped.findings) if (!before.has(key(f))) totals.added++;
  for (const f of legacy.findings) {
    if (now.has(key(f))) continue;
    const cls = classify(f.path);
    totals.dropped++;
    totals.byClass[cls] = (totals.byClass[cls] || 0) + 1;
    totals.byRule[`${f.rule}|${cls}`] = (totals.byRule[`${f.rule}|${cls}`] || 0) + 1;
    rows.push({ repo, rule: f.rule, cls, source: f.source, sink: f.sink, path: f.path.map(h => `${h.program}.${h.item}${h.dir ? `[${h.dir}]` : ''} <- ${h.via}`) });
  }
}
console.log(JSON.stringify(totals, null, 1));
if (out) writeFileSync(out, JSON.stringify({ totals, rows }, null, 1));
