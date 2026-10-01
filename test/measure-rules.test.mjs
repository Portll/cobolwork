// diag/measure-rules.mjs is how a change to the engine is measured, so it is tested the way it is
// used: spawned over a corpus, here three repositories copied from the benchmark cases, two of them
// byte for byte the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, readFileSync, writeFileSync, statSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'diag', 'measure-rules.mjs');
const CASES = join(HERE, '..', 'bench', 'cases');
const measure = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

function inCorpus(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-measure-'));
  const corpus = join(dir, 'corpus');
  const copy = (name, repo) => {
    mkdirSync(join(corpus, repo), { recursive: true });
    for (const f of readdirSync(join(CASES, name))) copyFileSync(join(CASES, name, f), join(corpus, repo, f));
  };
  copy('001-argv-reaches-os-command', 'copyA');
  copy('001-argv-reaches-os-command', 'copyB');
  copy('037-a-job-parameter-reaches-an-os-command', 'jobparm');
  try { return fn(corpus, dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const ran = (r) => assert.equal(r.status, 0, r.stderr);

test('--only runs the named sets alone, and --out records every finding by fingerprint and every repository as read or not', () => inCorpus((corpus, dir) => {
  const out = join(dir, 'run.json');
  ran(measure(corpus, '--only', 'flow', '--out', out));
  const run = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(run.settings.ruleSets, ['flow']);
  // jcl-parm-is-an-entry-point is the jcl set's, and fires on the same job when that set runs.
  assert.deepEqual(Object.keys(run.strata.real.byRule).sort(), ['argv-or-env-to-os-command', 'jcl-parm-to-os-command']);
  const { copyA, copyB, jobparm } = run.repos;
  assert.deepEqual([copyA, copyB, jobparm].map(({ listing, ...r }) => r), Array(3).fill({ stratum: 'real', complete: true }));
  // Each repository's listing: the copies list the same names, the job repository others.
  assert.deepEqual(copyA.listing, copyB.listing);
  assert.equal(copyA.listing.files, 3);
  assert.notEqual(jobparm.listing.sha1, copyA.listing.sha1);
  assert.match(run.device.device, /^\d+$/);
  assert.equal(run.device.changed, undefined);
  assert.equal(run.findings.length, 3);
  for (const f of run.findings) {
    assert.match(f.fingerprint, /^[0-9a-f]{32}$/);
    assert.match(f.content, /^[0-9a-f]{40}$/);
    assert.equal(f.set, 'flow');
  }
  const [a, b] = run.findings.filter((f) => f.rule === 'argv-or-env-to-os-command');
  assert.deepEqual([a.repo, b.repo], ['copyA', 'copyB']);
  assert.equal(a.content, b.content, 'the two copies are one file content');
  // The two ends of the trace, and how many hops lie between them.
  assert.deepEqual(a.trace.map((h) => h.elided ?? `${h.program} ${h.item}`), ['P1 WS-IN', 2, 'P2 WS-LOCAL']);

  const refused = measure(corpus, '--only', 'flw');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--only takes flow,/);
}));

test('--list prints each finding of a rule once per file content, with its trace', () => inCorpus((corpus) => {
  const r = measure(corpus, '--only', 'flow', '--list', 'argv-or-env-to-os-command');
  ran(r);
  assert.match(r.stdout, /argv-or-env-to-os-command: 2 finding\(s\) in 2 repositories, 1 distinct by file content/);
  assert.equal(r.stdout.match(/^ {2}copy[AB]\/P2\.cbl:10 {2}crit/gm).length, 1, 'the copy is listed once');
  assert.match(r.stdout, /^ {2}copyA\/P2\.cbl:10 {2}crit {2}[0-9a-f]{32}$/m);
  assert.match(r.stdout, /ACCEPT \.\.\. FROM COMMAND-LINE at P1\.cbl:8 reaches CALL 'SYSTEM' USING WS-LOCAL/);
  assert.match(r.stdout, /^ {6}P1 WS-IN {2}P1\.cbl {2}source$/m);
  assert.match(r.stdout, /^ {6}\.\.\. 2 hop\(s\) not listed$/m);
  assert.match(r.stdout, /^ {6}P2 WS-LOCAL {2}P2\.cbl {2}MOVE at P2\.cbl:9$/m);
  assert.match(r.stdout, /the same file, byte for byte, also at copyB\/P2\.cbl:10/);
}));

test('--baseline reports what a change removed, only in repositories both runs read completely', () => inCorpus((corpus, dir) => {
  const before = join(dir, 'before.json');
  const after = join(dir, 'after.json');
  ran(measure(corpus, '--only', 'flow', '--out', before));
  const removed = JSON.parse(readFileSync(before, 'utf8')).findings.find((f) => f.rule === 'jcl-parm-to-os-command');

  const runcmd = join(corpus, 'jobparm', 'RUNCMD.cbl');
  writeFileSync(runcmd, readFileSync(runcmd, 'latin1').replace("CALL 'SYSTEM' USING WS-CMD", 'DISPLAY WS-CMD'), 'latin1');
  // A source budget that reads P1 and not P2 in both copies, and all of RUNCMD: the copies lose
  // their finding for a reason that is not the change, and must not report it as removed.
  const size = (repo, f) => statSync(join(corpus, repo, f)).size;
  const budget = size('copyA', 'P1.cbl') + size('copyA', 'P2.cbl') - 1;
  assert.ok(size('jobparm', 'RUNCMD.cbl') <= budget);
  const r = measure(corpus, '--only', 'flow', '--max-source-bytes', String(budget), '--baseline', before, '--out', after);
  ran(r);
  const run = JSON.parse(readFileSync(after, 'utf8'));
  assert.equal(run.repos.jobparm.complete, true);
  assert.equal(run.repos.copyA.complete, false);
  assert.equal(run.repos.copyA.short.flow.filesOverBudget, 1);

  const c = run.baseline;
  assert.equal(c.sets.flow.compared, 1);
  assert.deepEqual(c.sets.flow.excluded, {
    copyA: 'this run: 1 file(s) past the source budget',
    copyB: 'this run: 1 file(s) past the source budget',
  });
  assert.deepEqual(c.byRule['jcl-parm-to-os-command'].removed.map((f) => [f.repo, f.path, f.line, f.fingerprint]),
    [['jobparm', 'RUNCMD.cbl', 12, removed.fingerprint]]);
  assert.equal(c.byRule['jcl-parm-to-os-command'].added, undefined);
  assert.equal(c.byRule['argv-or-env-to-os-command'], undefined, 'the copies were left out, so their lost findings are not a change');
  assert.deepEqual(c.settingsDiffer.maxSourceBytes.now, budget);

  assert.match(r.stdout, /flow: 1 of 3 repositories compared, left out:\n {4}copyA: this run: 1 file\(s\) past the source budget/);
  assert.match(r.stdout, /^ +1 +0 +\+0 +-1 {2}jcl-parm-to-os-command$/m);
  assert.match(r.stdout, new RegExp(`- jobparm/RUNCMD\\.cbl:12 {2}${removed.fingerprint}`));
}));

// A drive that answers one run's walk with less looks, finding by finding, like the engine losing
// findings. Neither run reports a problem reading, so the listing is what tells them apart.
test('--baseline leaves out a repository the two runs listed differently, and totals what each listed', () => inCorpus((corpus, dir) => {
  const before = join(dir, 'before.json');
  ran(measure(corpus, '--only', 'flow', '--out', before));
  rmSync(join(corpus, 'copyB', 'P2.cbl'));
  const r = measure(corpus, '--only', 'flow', '--baseline', before, '--out', join(dir, 'after.json'));
  ran(r);
  const c = JSON.parse(readFileSync(join(dir, 'after.json'), 'utf8')).baseline;
  assert.deepEqual(c.sets.flow.excluded, { copyB: 'listed differently: 3 file(s) then, 2 now' });
  assert.deepEqual(c.listed, { then: 9, now: 8 });
  assert.deepEqual(c.byRule['argv-or-env-to-os-command'], { before: 1, after: 1 }, 'copyB lost its finding with its file, which is not a change');
  assert.match(r.stdout, /files listed: 9 then, 8 now - the runs did not see the same corpus/);
}));

test('a directory the walk cannot list leaves the repository read in part by every set', { skip: process.platform === 'win32' && 'mode bits do not stop a listing on Windows' }, () => inCorpus((corpus, dir) => {
  const locked = join(corpus, 'copyB', 'sub');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  try {
    const out = join(dir, 'run.json');
    const r = measure(corpus, '--only', 'flow,cics', '--out', out);
    ran(r);
    const { copyB } = JSON.parse(readFileSync(out, 'utf8')).repos;
    assert.equal(copyB.complete, false);
    for (const set of ['flow', 'cics']) assert.equal(copyB.short[set].why, '1 directory could not be listed, the first sub');
    assert.match(r.stderr, /copyB\n {8}\^ read in part: flow: 1 directory could not be listed/);
  } finally { chmodSync(locked, 0o755); }
}));

test('--baseline refuses, before scanning, a file that records no findings', () => inCorpus((corpus, dir) => {
  const old = join(dir, 'old.json');
  writeFileSync(old, JSON.stringify({ root: corpus, strata: {} }, null, 1));
  const r = measure(corpus, '--baseline', old);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /records no findings/);
  assert.doesNotMatch(r.stderr, /copyA/, 'it stopped before reading any repository');
}));

// The temporary directory stands in for the drive, and the manifest lists the corpus as it was made.
function manifestOf(corpus, dir) {
  const lines = readdirSync(corpus, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
    .map((d) => { const p = join(d.parentPath, d.name); return `F\t${p.slice(dir.length + 1)}\t${statSync(p).size}\t0`; });
  const file = join(dir, 'manifest.tsv');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return ['--manifest', file, '--manifest-root', dir];
}

test('the corpus is checked against the drive manifest first: a difference warns, and --require-manifest refuses the run', () => inCorpus((corpus, dir) => {
  const drive = manifestOf(corpus, dir);
  const out = join(dir, 'run.json');
  const agreed = measure(corpus, '--only', 'flow', ...drive, '--require-manifest', '--out', out);
  ran(agreed);
  const m = JSON.parse(readFileSync(out, 'utf8')).manifest;
  assert.deepEqual([m.under, m.files, m.matched, m.agrees], ['corpus', 9, 9, true]);
  assert.match(agreed.stdout, /^drive manifest: of the 9 files it lists under corpus, 9 are on disk at its size, 0 missing, 0 of another size; 0 on disk are not in it$/m);
  assert.doesNotMatch(agreed.stderr, /warning/);

  rmSync(join(corpus, 'copyB', 'P2.cbl'));
  const warned = measure(corpus, '--only', 'flow', ...drive, '--out', out);
  ran(warned);
  assert.match(warned.stderr, /^measure-rules: warning: drive manifest: of the 9 files it lists under corpus, 8 are on disk at its size, 1 missing, .*; the first missing copyB\/P2\.cbl$/m);
  assert.match(warned.stdout, /^drive manifest: .* 1 missing, .*; the first missing copyB\/P2\.cbl$/m);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).manifest.first, { missing: ['copyB/P2.cbl'] });

  const refused = measure(corpus, '--only', 'flow', ...drive, '--require-manifest');
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--require-manifest: drive manifest: .* 1 missing/);
  assert.doesNotMatch(refused.stderr, /copyA/, 'it stopped before reading any repository');

  const elsewhere = measure(corpus, '--only', 'flow', '--manifest-root', join(dir, 'none'), '--require-manifest');
  assert.equal(elsewhere.status, 2);
  assert.match(elsewhere.stderr, /--require-manifest: drive manifest not checked: the corpus root is not on /);
  const noted = measure(corpus, '--only', 'flow', '--manifest-root', join(dir, 'none'));
  ran(noted);
  assert.match(noted.stdout, /^drive manifest not checked: the corpus root is not on .*none$/m);
}));

test('--skip naming a repository skips that one alone; a value naming none is a substring', () => inCorpus((corpus, dir) => {
  mkdirSync(join(corpus, 'copyAB'));
  for (const f of readdirSync(join(corpus, 'copyA'))) copyFileSync(join(corpus, 'copyA', f), join(corpus, 'copyAB', f));
  const out = join(dir, 'run.json');
  ran(measure(corpus, '--only', 'flow', '--skip', 'copyA', '--out', out));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(out, 'utf8')).repos).sort(), ['copyAB', 'copyB', 'jobparm']);
  ran(measure(corpus, '--only', 'flow', '--skip', 'copy', '--out', out));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(out, 'utf8')).repos).sort(), ['jobparm']);
}));
