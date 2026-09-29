// Which rule set's memory grows without bound on a very large repository.
//
//   node diag/memory-probe.mjs <repo> [--heap 1536] [--only cics,jcl]
//
// The source budget in the flow engine bounds how much source text is held. It does not bound the
// graph built from that text, and it does not apply at all to the rule sets that do their own
// reading. A corpus run died twice on one 100,000-program repository with a 32MB source budget and
// an 8GB heap, which told us the budget was not the control we thought it was.
//
// Each set runs in its own process, so one failure does not hide the others, and each reports peak
// resident memory rather than a guess.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const REPO = args.find((a) => !a.startsWith('--'));
const HEAP = args.includes('--heap') ? args[args.indexOf('--heap') + 1] : '1536';
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

if (!REPO) { console.error('usage: node diag/memory-probe.mjs <repo> [--heap MB] [--only a,b]'); process.exit(2); }

// Every registered set, each in its own process with its own heap cap - the point of this probe is
// which set exhausts a heap, so they cannot share one. The table was written by hand and had drifted
// two sets behind the registry, which meant the two newest sets were the two nobody had measured for
// memory. The registry is imported only to learn the names; each child imports the set itself.
const { REGISTRY } = await import('../lib/kernel/registry.mjs');
const SETS = REGISTRY.map(({ name }) => [name, [
  `const m = await import('../lib/kernel/registry.mjs');`,
  `const set = m.REGISTRY.find(s => s.name === ${JSON.stringify(name)});`,
  // The flow set is the one with a source budget worth stating; the rest take the default.
  name === 'flow'
    ? 'const r = set.scan(ROOT, { maxSourceBytes: 32*1024*1024 });'
    : 'const r = set.scan(ROOT);',
].join(' ')]);

console.log(`repository: ${REPO}`);
console.log(`heap cap:   ${HEAP} MB per set\n`);
console.log('set       result        peak MB   seconds  findings');

for (const [name, body] of SETS) {
  if (ONLY && !ONLY.includes(name)) continue;
  const src = `
    const ROOT = process.argv[1];
    const t0 = Date.now();
    ${body}
    const peak = Math.round(process.memoryUsage().rss / 1048576);
    console.log(JSON.stringify({ ok: true, peak, secs: (Date.now() - t0) / 1000, findings: r.findings.length }));
  `;
  const p = spawnSync(process.execPath,
    ['--max-old-space-size=' + HEAP, '--input-type=module', '-e', src, REPO],
    { cwd: HERE, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 900000 });

  let line;
  try { line = JSON.parse((p.stdout || '').trim().split('\n').pop()); } catch { line = null; }
  if (line && line.ok) {
    console.log(`${name.padEnd(10)}${'completed'.padEnd(14)}${String(line.peak).padStart(7)}${line.secs.toFixed(0).padStart(10)}${String(line.findings).padStart(10)}`);
  } else {
    const why = /heap out of memory/.test(p.stderr || '') ? 'OUT OF MEMORY'
      : p.signal === 'SIGTERM' ? 'timed out (15m)'
      : `exit ${p.status}`;
    console.log(`${name.padEnd(10)}${why.padEnd(14)}${'-'.padStart(7)}${'-'.padStart(10)}${'-'.padStart(10)}`);
  }
}
