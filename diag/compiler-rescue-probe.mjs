// Retries every program the compiler probe refused, one with embedded SQL or CICS through the
// translator first, then through the precompiler stand-in, each under the other dialects and formats
// too, and records the first way the compiler accepts it. A rescued program is graded with the
// compiler reading the translation or the stand-in and the parser reading the file as written.
//
//   node diag/compiler-rescue-probe.mjs <root> <parse.ndjson> <rescue.ndjson> [--sample N]
//
// --sample N retries at most N programs a repository, for a quick look; without it every refused
// program is retried. COBOLWORK_JOBS sets how many compilers run at once (default 8).
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { prepareForWitness, writeStandInCopybooks, writeRepositoryMaps } from './precompiler.mjs';
import { parseSource } from '../lib/parser.mjs';
import { precompile } from '../lib/precompile.mjs';

const args = process.argv.slice(2);
const SAMPLE = args.includes('--sample') ? Number(args[args.indexOf('--sample') + 1]) : Infinity;
const [ROOT, IN, OUT] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--sample');
const tmp = mkdtempSync(join(tmpdir(), 'cobrescue-'));
const standInDir = writeStandInCopybooks(join(tmp, 'stand-in'));
const mapsByRepo = {};
const mapsOf = (repo) => (mapsByRepo[repo] ??= writeRepositoryMaps(join(ROOT, repo), join(tmp, 'maps', repo)));

function walkDirs(dir, acc) {
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of es) { if (e.name === '.git' || e.name.startsWith('._')) continue; const p = join(dir, e.name); if (e.isDirectory()) walkDirs(p, acc); else if (/\.(cpy|cbl|cob)$/i.test(e.name)) acc.add(dir); }
  return acc;
}

function cobc(file, argv, cwd) {
  return new Promise(res => {
    const ch = spawn('cobc', ['-fsyntax-only', '-frelax-syntax-checks', ...argv, file], { cwd });
    let err = ''; ch.stderr.on('data', d => { if (err.length < 50000) err += d; });
    const t = setTimeout(() => { ch.kill('SIGKILL'); res({ code: -1, err }); }, 30000);
    ch.on('close', code => { clearTimeout(t); res({ code, err }); });
  });
}

const rows = readFileSync(IN, 'utf8').trim().split('\n').map(JSON.parse).filter(r => r.outcome.startsWith('fail') || r.outcome === 'timeout');
const byRepo = {};
for (const r of rows) (byRepo[r.repo] ||= []).push(r);
const jobs = [];
for (const rs of Object.values(byRepo)) {
  const sample = rs.length > SAMPLE ? rs.filter((_, i) => i % Math.ceil(rs.length / SAMPLE) === 0) : rs;
  jobs.push(...sample);
}
const dirsByRepo = {};
const results = [];
let next = 0, n = 0;
async function worker(id) {
  while (next < jobs.length) {
    const r = jobs[next++];
    const abs = join(ROOT, r.file);
    const repoDirs = [...(dirsByRepo[r.repo] ||= [...walkDirs(join(ROOT, r.repo), new Set())].sort())].slice(0, 60);
    const extra = [standInDir, ...(mapsOf(r.repo).dir ? [mapsOf(r.repo).dir] : [])];
    const inc = [...repoDirs, ...extra].flatMap(d => ['-I', d]);
    const src = readFileSync(abs, 'latin1');
    const own = r.format || 'fixed';
    const other = own === 'free' ? 'fixed' : 'free';
    // The stand-in writes the EIB block it injects in the format it is compiled in.
    const prepared = {};
    const standIn = (fmt) => {
      if (!prepared[fmt]) { prepared[fmt] = join(tmp, `${id}-${n++}${extname(abs)}`); writeFileSync(prepared[fmt], prepareForWitness(src, fmt), 'latin1'); }
      return prepared[fmt];
    };
    // The translation, with the copybooks it supplies, in each format; null where it cannot be made.
    const translated = {};
    const translator = (fmt) => {
      if (translated[fmt] !== undefined) return translated[fmt];
      try {
        const items = parseSource(src, abs, { format: fmt, includeDirs: repoDirs }).programs.flatMap((p) => p.items);
        const tx = precompile(src, { format: fmt, items });
        const dir = join(tmp, `${id}-${n++}-copy`);
        mkdirSync(dir);
        for (const [name, body] of Object.entries(tx.copybooks)) writeFileSync(join(dir, `${name}.cpy`), body);
        const file = join(tmp, `${id}-${n++}${extname(abs)}`);
        writeFileSync(file, prepareForWitness(tx.text, fmt), 'latin1');
        translated[fmt] = { file, inc: [...repoDirs, dir, ...extra].flatMap(d => ['-I', d]) };
      } catch { translated[fmt] = null; }
      return translated[fmt];
    };
    const variants = [
      ['', own, 'default'], ['+ibm', own, 'ibm'], ['+mf', own, 'mf'],
      ['+flip', other, 'default'], ['+flip+ibm', other, 'ibm'], ['+flip+mf', other, 'mf'],
      ['+terminal', 'terminal', 'default'], ['+terminal+ibm', 'terminal', 'ibm'], ['+variable+ibm', 'variable', 'ibm'],
    ];
    const tries = [
      ...(/EXEC\s+(SQL|CICS)\b/i.test(src) ? variants.map(([v, fmt, std]) => [`translator${v}`, fmt, std, () => translator(fmt)]) : []),
      ...variants.map(([v, fmt, std]) => [`stand-in${v}`, fmt, std, () => ({ file: standIn(fmt), inc })]),
    ];
    let rescued = null, format = null, firstErr = null;
    for (const [name, fmt, std, input] of tries) {
      const it = input();
      if (!it) continue;
      const out = await cobc(it.file, [`-std=${std}`, `-fformat=${fmt}`, ...it.inc], dirname(abs));
      if (out.code === 0) { rescued = name; format = fmt; break; }
      firstErr ??= (out.err.match(/error: ([^\n]*)/) || [])[1] || '';
    }
    for (const p of Object.values(prepared)) rmSync(p, { force: true });
    for (const t of Object.values(translated)) if (t) rmSync(t.file, { force: true });
    results.push({ repo: r.repo, file: r.file, was: r.outcome, rescued, ...(rescued ? { format } : { firstErr: firstErr.replace(/'[^']*'/g, "'_'").slice(0, 100) }) });
  }
}
await Promise.all(Array.from({ length: Number(process.env.COBOLWORK_JOBS || 8) }, (_, i) => worker(i)));
rmSync(tmp, { recursive: true, force: true });
results.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(OUT, results.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`attempted=${jobs.length} rescued=${results.filter(r => r.rescued).length}`);
