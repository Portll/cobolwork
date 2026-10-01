// Asks GnuCOBOL whether it accepts each program in a corpus, and in which format, for the grade.
//   node diag/compiler-probe.mjs <corpus-root> <out.ndjson>
// A program is what the scanner reads as one, .sqb, .pco and an extensionless member included: the
// probe listed .cbl, .cob and .cobol alone, and 4,434 programs of one corpus were never graded.
import { spawn } from 'node:child_process';
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { isProgram, isCopybook } from '../lib/sources.mjs';
import { detectFormat as parserFormat } from '../lib/parser.mjs';

const ROOT = process.argv[2];
const OUT = process.argv[3];
const COPY_EXT = new Set(['.cpy', '.cbl', '.cob']);

function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name === '.git' || e.name.startsWith('._')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

// The format the scanner would read the program in, so the grade compares like with like.
function detectFormat(src) {
  if (/>>\s*SOURCE\s+(FORMAT\s+)?(IS\s+)?FREE/i.test(src) || /\$SET\s+SOURCEFORMAT\s*(?:\(\s*)?"?FREE/i.test(src)) return 'free';
  return parserFormat(src) === 'free' ? 'free' : 'fixed';
}

function classify(stderr, code, timedOut, src) {
  if (timedOut) return 'timeout';
  if (code === 0) return 'ok';
  const s = stderr.split('\n').filter(l => / error: /.test(l)).join('\n');
  if (/error: [^:\n]+: No such file or directory/.test(s)) return 'fail-copybook-missing';
  if (/EXEC\s+(SQL|CICS|DLI)/i.test(src)) return 'fail-exec-preprocessor';
  if (/is not defined|not defined/i.test(s)) return 'fail-undefined-name';
  if (/syntax error|unexpected/i.test(s)) return 'fail-syntax';
  if (/reserved word|is a reserved/i.test(s)) return 'fail-dialect-reserved';
  return 'fail-other';
}

function run(file, includeDirs, format) {
  return new Promise(res => {
    const args = ['-fsyntax-only', '-std=default', '-frelax-syntax-checks', format === 'free' ? '-fformat=free' : '-fformat=fixed', '-Wall', ...includeDirs.flatMap(d => ['-I', d]), file];
    const ch = spawn('cobc', args, { cwd: dirname(file) });
    let err = '';
    ch.stderr.on('data', d => { if (err.length < 200000) err += d; });
    ch.stdout.on('data', d => { if (err.length < 200000) err += d; });
    const t = setTimeout(() => { ch.kill('SIGKILL'); res({ code: -1, err, timedOut: true }); }, 30000);
    ch.on('close', code => { clearTimeout(t); res({ code, err, timedOut: false }); });
  });
}

const repos = readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();
const jobs = [];
for (const repo of repos) {
  const files = walk(join(ROOT, repo), []);
  const copyDirs = [...new Set(files.filter(f => COPY_EXT.has(extname(f).toLowerCase()) || isCopybook(f)).map(dirname))].sort();
  for (const f of files) if (isProgram(f)) jobs.push({ repo, file: f, copyDirs });
}

const results = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    let src = '';
    try { src = readFileSync(j.file, 'latin1'); } catch {}
    if (!/PROCEDURE\s+DIVISION|IDENTIFICATION\s+DIVISION|ID\s+DIVISION|PROGRAM-ID/i.test(src)) { results.push({ repo: j.repo, file: j.file.slice(ROOT.length + 1), outcome: 'not-a-program' }); continue; }
    let format = detectFormat(src);
    const dirs = j.copyDirs.length > 40 ? j.copyDirs.filter(d => d.startsWith(dirname(j.file)) || dirname(j.file).startsWith(d)).concat(j.copyDirs.slice(0, 40)) : j.copyDirs;
    let r = await run(j.file, [...new Set(dirs)], format);
    // A program refused in one format may be the other's: code past column 72 written for -free.
    // A missing copybook or an EXEC block is refused either way, so those are not retried.
    let formatRetried = false;
    const first = classify(r.err, r.code, r.timedOut, src);
    if (first !== 'ok' && first !== 'timeout' && first !== 'fail-copybook-missing' && first !== 'fail-exec-preprocessor') {
      const other = format === 'free' ? 'fixed' : 'free';
      const r2 = await run(j.file, [...new Set(dirs)], other);
      if (r2.code === 0) { r = r2; format = other; formatRetried = true; }
    }
    const warnings = {};
    for (const m of r.err.matchAll(/warning: .*\[(-W[a-z-]+)\]/g)) warnings[m[1]] = (warnings[m[1]] || 0) + 1;
    const firstError = (r.err.match(/error: ([^\n]*)/) || [])[1] || '';
    results.push({ repo: j.repo, file: j.file.slice(ROOT.length + 1), format, ...(formatRetried ? { formatRetried } : {}), outcome: classify(r.err, r.code, r.timedOut, src), warnings, firstError: firstError.replace(/'[^']*'/g, "'_'").slice(0, 120) });
  }
}
const start = Date.now();
await Promise.all(Array.from({ length: 8 }, worker));
results.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(OUT, results.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`jobs=${jobs.length} secs=${Math.round((Date.now() - start) / 1000)}`);
