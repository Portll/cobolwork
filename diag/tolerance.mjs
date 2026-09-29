import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseSource, buildFileIndex, normalize, tokenize, detectFormat } from '../lib/parser.mjs';

const [ROOT, PARSE, OUT] = process.argv.slice(2);
const SYSTEM_COPY_DIR = process.env.COBOLWORK_SYSTEM_COPY_DIR || '/opt/homebrew/Cellar/gnucobol/3.2_1/share/gnucobol/copy';
const rows = readFileSync(PARSE, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.outcome !== 'not-a-program');

const regexExecCount = (src) => src.split(/\r?\n/)
  .filter(l => !(l.length > 6 && '*/'.includes(l[6])) && !/^\s*\*/.test(l))
  .reduce((n, l) => n + (l.match(/\bEXEC\s+(SQL|CICS|DLI)\b/gi) || []).length, 0);

const indexCache = new Map();
const agg = { files: 0, threw: 0, byOutcome: {}, execAgree: 0, execFiles: 0, execDisagree: [], perRepo: {}, hazards: {}, copyStatus: {}, missingCopyNames: {}, systemCopyNames: {}, msTotal: 0, msMax: 0, slowest: null };
const hz = (k, repo, file) => { const h = (agg.hazards[k] ||= { sites: 0, repos: new Set(), files: new Set() }); h.sites++; h.repos.add(repo); h.files.add(file); };
const SYSTEM_ROUTINE = /^(SYSTEM|C\$SYSTEM|CBL_EXEC_RUN_UNIT|CBL_GC_HOSTED)$/i;

for (const r of rows) {
  const abs = join(ROOT, r.file);
  if (!indexCache.has(r.repo)) indexCache.set(r.repo, buildFileIndex(join(ROOT, r.repo)));
  const idx = indexCache.get(r.repo);
  const src = readFileSync(abs, 'latin1');
  const bucket = (agg.byOutcome[r.outcome] ||= { files: 0, structured: 0, copyComplete: 0, withProcedure: 0 });
  const rp = (agg.perRepo[r.repo] ||= { files: 0, structured: 0, cobcOk: 0, execFiles: 0, copyComplete: 0 });
  bucket.files++; rp.files++; agg.files++;
  if (r.outcome === 'ok') rp.cobcOk++;
  let res;
  const t0 = process.hrtime.bigint();
  try {
    res = parseSource(src, abs, { format: 'auto', includeDirs: idx.copyDirs.slice(0, 80), systemDirs: [SYSTEM_COPY_DIR], fileIndex: idx.index, mainDir: dirname(abs), copyFormat: 'auto' });
  } catch (e) {
    agg.threw++; (agg.threwSamples ||= []).length < 20 && agg.threwSamples.push({ file: r.file, err: String(e.stack || e).split('\n').slice(0, 2).join(' | ') });
    continue;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  agg.msTotal += ms;
  if (ms > agg.msMax) { agg.msMax = ms; agg.slowest = r.file; }
  const progs = res.programs;
  const withProc = progs.length > 0 && progs.every(p => !p.diags.some(d => d.kind === 'no-procedure-division'));
  const unrecognised = progs.reduce((n, p) => n + p.diags.filter(d => d.kind === 'unrecognised-data-sentence').length, 0);
  const structured = withProc && unrecognised === 0;
  const missing = res.copies.filter(c => c.status === 'missing' || c.status === 'recursive');
  if (withProc) bucket.withProcedure++;
  if (structured) { bucket.structured++; rp.structured++; }
  if (!missing.length) { bucket.copyComplete++; rp.copyComplete++; }
  for (const c of res.copies) {
    agg.copyStatus[c.status] = (agg.copyStatus[c.status] || 0) + 1;
    if (c.status === 'missing') agg.missingCopyNames[c.name.toUpperCase()] = (agg.missingCopyNames[c.name.toUpperCase()] || 0) + 1;
    if (c.status === 'system') agg.systemCopyNames[c.name.toUpperCase()] = (agg.systemCopyNames[c.name.toUpperCase()] || 0) + 1;
  }

  const fmt = detectFormat(src);
  const parserExec = tokenize(normalize(src, fmt), abs).tokens.filter(t => t.t === 'exec').length;
  const regexExec = regexExecCount(src);
  if (regexExec || parserExec) {
    agg.execFiles++; rp.execFiles++;
    if (regexExec === parserExec) agg.execAgree++;
    else if (agg.execDisagree.length < 40) agg.execDisagree.push({ file: r.file, regex: regexExec, parser: parserExec, format: fmt });
  }

  for (const p of progs) {
    for (const c of p.calls) {
      if (c.kind === 'I') hz('dynamic-call-target', r.repo, r.file);
      if (c.kind === 'L' && SYSTEM_ROUTINE.test(c.name) && c.using.some(u => u.word && !/^(BY|REFERENCE|CONTENT|VALUE)$/.test(u.word))) hz('system-call-with-variable-command', r.repo, r.file);
    }
    for (const a of p.accepts) if (/^(ENVIRONMENT|COMMAND-LINE|ARGUMENT-VALUE|ENVIRONMENT-VALUE)$/.test(a.from || '')) hz('accept-from-environment-or-command-line', r.repo, r.file);
    for (const e of p.execs) {
      const w = e.toks;
      if (e.kind === 'CICS' && w[0] && ['LINK', 'XCTL', 'START', 'LOAD'].includes(w[0].u)) {
        const k = w.findIndex(x => x.t === 'word' && (x.u === 'PROGRAM' || x.u === 'TRANSID'));
        if (k >= 0 && w[k + 1] && w[k + 1].v === '(' && w[k + 2] && w[k + 2].t === 'word') hz('cics-transfer-to-variable-program', r.repo, r.file);
      }
      if (e.kind === 'SQL' && w.some((x, i) => x.u === 'PREPARE' || (x.u === 'EXECUTE' && w[i + 1] && w[i + 1].u === 'IMMEDIATE'))) hz('dynamic-sql', r.repo, r.file);
      if (e.kind === 'CICS' && w[0] && ['RECEIVE', 'WEB', 'CONVERSE'].includes(w[0].u)) hz('cics-terminal-or-web-input', r.repo, r.file);
    }
  }
}

for (const h of Object.values(agg.hazards)) { h.repos = h.repos.size; h.files = h.files.size; }
agg.topMissingCopies = Object.entries(agg.missingCopyNames).sort((a, b) => b[1] - a[1]).slice(0, 15);
agg.topSystemCopies = Object.entries(agg.systemCopyNames).sort((a, b) => b[1] - a[1]).slice(0, 15);
delete agg.missingCopyNames; delete agg.systemCopyNames;
writeFileSync(OUT, JSON.stringify(agg, null, 1));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
console.log(`files=${agg.files} threw=${agg.threw} avgMs=${(agg.msTotal / agg.files).toFixed(1)} maxMs=${agg.msMax.toFixed(0)} (${agg.slowest})`);
for (const [k, b] of Object.entries(agg.byOutcome).sort((a, b) => b[1].files - a[1].files)) console.log(`${k.padEnd(24)} files=${b.files} structured=${pct(b.structured, b.files)} copyComplete=${pct(b.copyComplete, b.files)}`);
console.log(`exec extraction agrees with regex count in ${pct(agg.execAgree, agg.execFiles)} of ${agg.execFiles} files`);
console.log('copies', JSON.stringify(agg.copyStatus));
console.log('hazards', JSON.stringify(agg.hazards));
