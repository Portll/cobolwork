import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSource, buildFileIndex } from '../lib/parser.mjs';
const [file, repo, group, fmt] = process.argv.slice(2);
const idx = buildFileIndex(repo);
const inc = idx.copyDirs.slice(0, 80);
// The compiler writes its listing here and the read below takes it straight back, so this is the
// script's own scratch space and nothing outside it names the path. It is created because cobc
// will not create it, and the read would otherwise fail with ENOENT and no clue why.
const lstDir = join(tmpdir(), 'cobolwork-rowdiff');
mkdirSync(lstDir, { recursive: true });
const lst = join(lstDir, 'rowdiff.lst');
spawnSync('cobc', ['-fsyntax-only', '-frelax-syntax-checks', `-fformat=${fmt}`, '-t', lst, '-Xref', '-ftsymbols', ...inc.flatMap(d => ['-I', d]), file], { cwd: dirname(file) });
const L = readFileSync(lst, 'latin1').split('\n');
const re = new RegExp(`\\s${group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|,|$)`, 'i');
const start = L.findIndex(l => /^\d{5,}\s/.test(l) && re.test(l));
const w = [];
for (let i = start; i >= 0 && i < L.length && w.length < 600; i++) {
  if (/^(SIZE|GnuCOBOL)/.test(L[i]) || !L[i].trim()) continue;
  const m = /^(\d{5,}|\s{5})\s+\S+.*?\s(\d\d)\s+(\S+)/.exec(L[i]);
  if (!m) break;
  if (i > start && m[2] === '01') break;
  w.push({ size: Number(m[1].trim() || 0), lvl: m[2], name: m[3].toUpperCase().replace(/,$/, '') });
}
const r = parseSource(readFileSync(file, 'latin1'), file, { format: fmt, includeDirs: inc, fileIndex: idx.index, mainDir: dirname(file), copyFormat: fmt, systemDirs: [process.env.COBOLWORK_SYSTEM_COPY_DIR || '/opt/homebrew/Cellar/gnucobol/3.2_1/share/gnucobol/copy'] });
const m = [];
for (const p of r.programs) for (const it of p.items) if (it.name === group.toUpperCase() && !m.length) { const walk = x => { if (x.level !== 88 && x.level !== 78 && x.level !== 66) m.push(x); x.children.forEach(walk); }; walk(it); }
let shown = 0;
for (let i = 0; i < Math.max(w.length, m.length) && shown < 10; i++) {
  const a = w[i], b = m[i];
  if (!a || !b || a.size !== b.size) {
    shown++;
    console.log(`#${i} witness=${a ? `${a.size} ${a.lvl} ${a.name}` : '-'}  mine=${b ? `${b.size} ${b.level} ${b.name} line=${b.line} pic=${b.picture || ''} vals=${b.values.map(v => v.t === 'lit' ? `'${v.v}'` : v.v).join(' ')}` : '-'}`);
  }
}
console.log(`rows witness=${w.length} mine=${m.length}`);
