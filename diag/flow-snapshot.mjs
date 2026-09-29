// Writes every data-flow finding over a corpus as one sorted key per line — rule, source, sink and
// the path taken — so two versions of the analysis can be compared with diff. Used to show that a
// change to how the graph is built changed nothing it was not meant to.
//
//   node diag/flow-snapshot.mjs <corpus-root> <out.txt>
import { readdirSync, writeFileSync } from 'node:fs';
import { analyze } from '../lib/dataflow.mjs';

const [root, out] = process.argv.slice(2);
const repos = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();
const lines = [];
const t0 = Date.now();
let files = 0;
for (const repo of repos) {
  const r = analyze(root, { repos: [repo] });
  files += r.stats.files;
  for (const f of r.findings) {
    lines.push([repo, f.rule, `${f.source.file}:${f.source.line}`, `${f.sink.file}:${f.sink.line}`, f.crossProgram ? 'x' : '-',
      f.path.map(h => `${h.program}.${h.item}<${h.via}`).join(' ')].join('\t'));
  }
}
lines.sort();
writeFileSync(out, lines.join('\n') + '\n');
console.log(`repos=${repos.length} files=${files} findings=${lines.length} secs=${Math.round((Date.now() - t0) / 1000)}`);
