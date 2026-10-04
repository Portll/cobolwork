// SPDX-License-Identifier: AGPL-3.0-or-later
// Interface labels: each finding from a subprogram fuzzed at its interface (ironwork fuzz
// --interface), confirmed where a caller reproduces it. The same corpus run fuzzes every main
// program with -L on the repository's program directories, so a caller that CALLs the subprogram
// runs it with its own data; a main-program finding at the same rule, file and line is that caller
// reproducing the abend. Anything else is unknown with its reason, never refuted: no caller run
// reaching the abend shows only that these runs did not (docs/spec/reach.md §9.6).
//
//   node bench/label-interface.mjs <corpus-run-dir> [--scan scan-results.json] [--out file]
//
// The run directory is what the corpus runner writes: a scan file (each repository's abend findings,
// with abend.inputFrom; scan-results.json unless --scan names another in it), fuzz-results*.jsonl (a
// row per distinct program) and, per program, its fuzz directory and DIR.interface beside it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, posix } from 'node:path';

export const SOURCE = 'execution-interface';

const key = (f) => `${f.rule}|${f.path}|${f.line}`;
const fuzzDir = (file) => file.replace(/[\\/]/g, '__');
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

function rows(run) {
  const out = [];
  for (const name of readdirSync(run).filter((n) => /^fuzz-results.*\.jsonl$/.test(n)).sort()) {
    for (const line of readFileSync(join(run, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* a line cut short by a stopped run */ }
    }
  }
  return out;
}

// Why a caller program did not run the subprogram, or null when it ran: its row's skip reason, that
// no row names it, that it has no main-program manifest (a program fuzzed only at its interface), or
// that its manifest counts every run refused.
function callerRan(run, byProgram, repo, file) {
  const row = byProgram.get(`${repo}|${file}`);
  if (!row) return 'no fuzz run of it';
  if (row.skipped) return `not fuzzed: ${row.skipped}`;
  const counts = readJson(join(run, repo, fuzzDir(file), 'manifest.json'))?.counts;
  if (!counts) return 'not fuzzed as a main program';
  return counts.runs > 0 && counts.refused === counts.runs ? 'every run of it refused' : null;
}

// Whether any of a caller's runs started its CALL line, from the coverage its fuzz run added up
// (the manifest's runCoverage), which names each file from the innermost of the manifest's roots;
// null where the manifest names no coverage.
function callStarted(run, repo, caller) {
  const dir = join(run, repo, fuzzDir(caller.file));
  const manifest = readJson(join(dir, 'manifest.json'));
  const coverage = manifest?.runCoverage ? readJson(join(dir, manifest.runCoverage)) : null;
  if (!Array.isArray(coverage?.statements)) return null;
  const roots = (Array.isArray(manifest.roots) ? manifest.roots : []).filter((r) => typeof r === 'string');
  const isCaller = (file) => file === caller.file || roots.some((r) => posix.join(r.replace(/\\/g, '/'), file) === caller.file);
  return coverage.statements.some((s) => s.line === caller.line && s.runs > 0 && isCaller(s.file));
}

export function labelInterface(run, { scan = 'scan-results.json' } = {}) {
  const scans = readJson(join(run, scan)) || [];
  const byProgram = new Map(rows(run).map((r) => [`${r.repo}|${r.program}`, r]));
  const interfaceRuns = new Map();
  for (const s of scans) {
    let entries = [];
    try { entries = readdirSync(join(run, s.repo)).filter((n) => n.endsWith('.interface')); } catch { continue; }
    for (const name of entries) {
      const manifest = readJson(join(run, s.repo, name, 'manifest.json'));
      if (manifest?.program?.file) interfaceRuns.set(`${s.repo}|${manifest.program.file}`, manifest);
    }
  }
  const labels = [];
  for (const s of scans) {
    const findings = s.findings || [];
    const reproduced = new Set(findings.filter((f) => (f.inputFrom ?? 'entry') === 'entry').map(key));
    for (const f of findings.filter((x) => x.inputFrom === 'interface')) {
      const base = { source: SOURCE, rule: f.rule, repo: s.repo, path: f.path, line: f.line };
      if (reproduced.has(key(f))) { labels.push({ ...base, label: 'confirmed' }); continue; }
      const manifest = interfaceRuns.get(`${s.repo}|${f.path}`);
      const callers = Array.isArray(manifest?.callers) ? manifest.callers : null;
      const stem = basename(f.path, extname(f.path)).toUpperCase();
      let why;
      if (!callers) why = 'the abend is not in the fuzzed subprogram\'s own source';
      else if (!callers.length) why = 'no program ironwork compiles CALLs it';
      // ironwork -L finds a CALLed program by its file name, so a caller's CALL of a PROGRAM-ID
      // that names a different file ends S806 and never runs it.
      else if (String(manifest.program.id || '').toUpperCase() !== stem) why = `its callers CALL ${manifest.program.id}, which -L does not find in ${basename(f.path)}`;
      else {
        const notRun = callers.map((c) => callerRan(run, byProgram, s.repo, c.file));
        const started = callers.filter((c, i) => !notRun[i]).map((c) => callStarted(run, s.repo, c));
        if (notRun.every(Boolean)) why = `no caller ran: ${[...new Set(notRun)].join('; ')}`;
        else if (started.includes(true)) why = 'a caller ran the CALL and did not end there';
        else if (started.every((x) => x === false)) why = 'no caller run reached the CALL';
        else why = 'a caller ran and did not end there';
      }
      labels.push({ ...base, label: 'unknown', why });
    }
  }
  const counts = { confirmed: labels.filter((l) => l.label === 'confirmed').length, unknown: {} };
  for (const l of labels) if (l.why) counts.unknown[l.why] = (counts.unknown[l.why] || 0) + 1;
  return { tool: 'cobolwork-label-interface', source: SOURCE, run: basename(run), labels, counts };
}

function main(argv) {
  const option = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const run = argv.find((a, i) => !a.startsWith('--') && !['--out', '--scan'].includes(argv[i - 1]));
  const scan = option('--scan') ?? 'scan-results.json';
  if (!run || !existsSync(join(run, scan))) {
    process.stderr.write('usage: node bench/label-interface.mjs <corpus-run-dir> [--scan scan-results.json] [--out file]\n');
    return 2;
  }
  const text = `${JSON.stringify(labelInterface(run, { scan }), null, 1)}\n`;
  if (option('--out')) writeFileSync(option('--out'), text); else process.stdout.write(text);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
