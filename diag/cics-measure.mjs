import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseSource, buildFileIndex } from '../lib/parser.mjs';
const [root, parseList] = process.argv.slice(2);
const rows = readFileSync(parseList, 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.outcome !== 'not-a-program');
const strata = {};
const idxc = new Map();
for (const r of rows) {
  const abs = join(root, r.file);
  const src = readFileSync(abs, 'latin1');
  if (!/EXEC\s+CICS/i.test(src)) continue;
  // A generated stratum is named by whoever runs the measurement: a path fragment that marks it.
  const generated = process.env.COBOLWORK_GENERATED_STRATUM || '';
  const stratum = generated && r.file.includes(generated) ? 'generated' : 'real';
  if (!idxc.has(r.repo)) idxc.set(r.repo, buildFileIndex(join(root, r.repo)));
  const idx = idxc.get(r.repo);
  let res;
  try { res = parseSource(src, abs, { format: 'auto', includeDirs: idx.copyDirs.slice(0, 80), fileIndex: idx.index, mainDir: dirname(abs), copyFormat: 'auto' }); } catch { continue; }
  const s = (strata[stratum] ||= { programs: 0, repos: new Set(), usesCommarea: 0, commareaWithoutEibcalen: 0, commareaWithoutEibcalenRepos: new Set(), variableTransfer: 0, variableTransferRepos: new Set(), examples: [] });
  for (const p of res.programs) {
    s.programs++; s.repos.add(r.repo);
    const words = new Set([...p.refs.map(x => x.tok.u), ...p.execs.flatMap(e => e.toks.filter(t => t.t === 'word').map(t => t.u))]);
    const commarea = p.items.some(i => i.name === 'DFHCOMMAREA' && i.section === 'LINKAGE');
    const readsCommarea = commarea && [...words].some(w => w === 'DFHCOMMAREA') || p.items.some(i => i.section === 'LINKAGE' && i.name !== 'DFHCOMMAREA' && i.directRefs > 0 && commarea);
    if (commarea) s.usesCommarea++;
    const commareaItem = p.items.find(i => i.name === 'DFHCOMMAREA' && i.section === 'LINKAGE');
    const subtreeRead = (x) => (x.directRefs > 0) || x.children.some(subtreeRead);
    const commareaRead = commareaItem ? subtreeRead(commareaItem) : false;
    if (commareaRead) s.commareaRead = (s.commareaRead || 0) + 1;
    if (commareaRead && !words.has('EIBCALEN')) {
      s.commareaWithoutEibcalen++; s.commareaWithoutEibcalenRepos.add(r.repo);
      if (stratum === 'real' && s.examples.length < 6) s.examples.push(`${r.file}  program ${p.id}`);
    }
    for (const e of p.execs) {
      if (e.kind !== 'CICS') continue;
      const w = e.toks;
      if (!w[0] || !['LINK', 'XCTL'].includes(w[0].u)) continue;
      const k = w.findIndex(t => t.t === 'word' && t.u === 'PROGRAM');
      if (k >= 0 && w[k + 1] && w[k + 1].v === '(' && w[k + 2] && w[k + 2].t === 'word') { s.variableTransfer++; s.variableTransferRepos.add(r.repo); }
    }
  }
}
for (const [k, s] of Object.entries(strata)) console.log(k, JSON.stringify({ programs: s.programs, repos: s.repos.size, withCommarea: s.usesCommarea, commareaRead: s.commareaRead || 0, commareaWithoutEibcalen: s.commareaWithoutEibcalen, repos_: s.commareaWithoutEibcalenRepos.size, variableLinkXctlSites: s.variableTransfer, variableTransferRepos: s.variableTransferRepos.size }), '\n  ', s.examples.join('\n   '));
