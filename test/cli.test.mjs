// Exit codes are part of the contract: 0 the command ran, 2 it could not. A caller that cannot
// tell those apart reads a refusal as a clean result.
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { RULE_SETS } from '../lib/kernel/registry.mjs';
import { fileURLToPath } from 'node:url';
import { TRACE_MAX, TRACE_KEEP } from '../lib/dataflow.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'cobolwork.mjs');
const FIXTURES = join(HERE, 'fixtures');
// Built from its code point so the literal cannot be eaten by whatever writes this file.
const BACKSLASH = String.fromCharCode(92);
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('scan runs every rule set and reports what it read', () => {
  const r = run('scan', join(FIXTURES, 'dataflow'), '--repos', '--quiet');
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.tool, 'cobolwork');
  assert.equal(report.summary.filesScanned, 8);
  // Three data-flow findings, plus the CICS rules firing on the same fixture: the program that
  // receives the communication area neither checks its length nor names its transfer target.
  assert.equal(report.summary.findings, 5);
  assert.deepEqual(Object.keys(report.summary.byRule).sort(), [
    'argv-or-env-to-os-command', 'cics-commarea-without-length-check',
    'cics-terminal-to-cics-dynamic-transfer', 'cics-transfer-to-variable-program', 'cics-web-to-dynamic-sql',
  ]);
});

test('every rule set keys its own counts, so no set reports under an undefined name', () => {
  const r = run('scan', join(FIXTURES, 'dataflow'), '--quiet');
  assert.equal(r.status, 0);
  const bySet = JSON.parse(r.stdout).summary.bySet;
  // The flow set was renamed once while the tool-name map was not, and its file counts went out
  // under the key `undefined` in every report. The map is gone - lib/registry.mjs derives the key
  // from the set's own name - so what this asserts is that every registered set reported, and that
  // nothing reported which is not registered. Enumerating the ten by hand made this the ninth edit
  // a new rule set cost.
  assert.deepEqual(Object.keys(bySet).sort(), [...RULE_SETS, 'inventory'].sort());
  assert.ok(bySet.flow.filesScanned > 0, 'the flow set reports what it read');
});

test('--only limits the run to the rule sets named', () => {
  const r = run('scan', join(FIXTURES, 'dataflow'), '--repos', '--only', 'flow', '--quiet');
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.summary.findings, 3);
  assert.deepEqual(report.summary.ruleSets, ['flow']);
});

test('scan of a tree with no COBOL exits 0 and declares the void', () => {
  const empty = mkdtempSync(join(tmpdir(), 'cobolwork-cli-'));
  const r = run('scan', empty, '--quiet');
  rmSync(empty, { recursive: true, force: true });
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.equal(report.summary.filesScanned, 0);
  assert.equal(report.summary.nosrc, true);
});

test('an unknown command or option exits 2', () => {
  assert.equal(run('frobnicate', FIXTURES).status, 2);
  assert.equal(run('scan', FIXTURES, '--nope').status, 2);
  assert.equal(run().status, 2);
});

test('a path that does not exist exits 2 rather than reporting an empty scan', () => {
  const r = run('parse', join(FIXTURES, 'parser', 'no-such-file.cbl'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cobolwork:/);
});

test('SARIF output carries rule identifiers and locations', () => {
  const r = run('scan', join(FIXTURES, 'dataflow'), '--repos', '--format', 'sarif');
  assert.equal(r.status, 0);
  const sarif = JSON.parse(r.stdout);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.name, 'cobolwork');
  assert.equal(sarif.runs[0].results.length, 5);
  for (const result of sarif.runs[0].results) {
    assert.ok(result.ruleId);
    assert.ok(result.locations[0].physicalLocation.artifactLocation.uri);
    assert.ok(result.locations[0].physicalLocation.region.startLine > 0);
  }
});

test('findings carry no source text', () => {
  const r = run('scan', join(FIXTURES, 'dataflow'), '--repos');
  const report = JSON.parse(r.stdout);
  for (const f of report.findings) {
    assert.ok(!/'[^']*'/.test(f.detail.replace(/'[A-Z0-9_$-]+'/g, '')), `detail should name rules and items, not quote source: ${f.detail}`);
  }
});

// A pipe is asynchronous and a file is not, so only a read through a pipe of more than one pipe
// buffer shows a document cut short behind exit 0.
test('a report larger than a pipe buffer arrives whole through a pipe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-pipe-'));
  const src = readFileSync(join(FIXTURES, 'dataflow', 'pos', 'S1.cbl'), 'latin1');
  for (let i = 0; i < 400; i++) writeFileSync(join(dir, `P${i}.cbl`), src.replace(/PROGRAM-ID\.\s+\S+/i, `PROGRAM-ID. P${i}.`));
  // spawnSync gives stdout a real pipe, which is the condition that matters: a writer that exits
  // before the pipe drains loses whatever is still buffered. Going through a shell instead would
  // put a native path inside a command string, where a Windows separator reads as an escape.
  const r = spawnSync(process.execPath, [CLI, 'scan', dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  rmSync(dir, { recursive: true, force: true });
  assert.ok(r.stdout.length > 65536, `fixture too small to cross a pipe buffer: ${r.stdout.length}`);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
});

// A trace past the cap keeps its two ends so a chain-shaped program cannot make the report
// quadratic. --full-trace is the way to get the hops in between when following one chain.
test('--full-trace lists every hop, where the default keeps the two ends and says what it left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-trace-'));
  try {
    const n = 90;
    const decl = Array.from({ length: n }, (_, i) => `       01 WS-F${String(i).padStart(3, '0')}          PIC X(200).`);
    const moves = Array.from({ length: n - 1 }, (_, i) => `           MOVE WS-F${String(i).padStart(3, '0')} TO WS-F${String(i + 1).padStart(3, '0')}`);
    writeFileSync(join(dir, 'LONGCH.cbl'), [
      '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. LONGCH.',
      '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
      '       01 WS-Q             PIC X(200).', ...decl,
      '       01 WS-STMT          PIC X(400).', '       PROCEDURE DIVISION.',
      '           EXEC CICS WEB RECEIVE INTO(WS-Q) LENGTH(200) END-EXEC',
      '           MOVE WS-Q TO WS-F000', ...moves,
      `           MOVE WS-F${String(n - 1).padStart(3, '0')} TO WS-STMT`,
      '           EXEC SQL EXECUTE IMMEDIATE :WS-STMT END-EXEC', '           GOBACK.', ''].join('\n'));

    const flow = (...extra) => {
      const r = spawnSync(process.execPath, [CLI, 'flow', dir, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      assert.equal(r.status, 0, r.stderr);
      const f = JSON.parse(r.stdout).findings;
      assert.equal(f.length, 1, 'the chain is one finding');
      return f[0];
    };

    const capped = flow();
    assert.ok(capped.hops > TRACE_MAX, `chain too short to cross the cap: ${capped.hops}`);
    assert.equal(capped.trace.length, TRACE_KEEP * 2 + 1, 'both ends kept, one marker between them');
    const marker = capped.trace[TRACE_KEEP];
    assert.match(marker.via, /… \d+ hops not listed/);
    assert.equal(marker.elided, capped.hops - TRACE_KEEP * 2, 'the count is a number, not only a string');

    const full = flow('--full-trace');
    assert.equal(full.trace.length, full.hops, 'every hop is listed');
    assert.equal(full.trace.filter(h => /hops not listed/.test(h.via)).length, 0, 'nothing is elided');
    assert.deepEqual(full.trace[0], capped.trace[0], 'the two ends are the same either way');
    assert.deepEqual(full.trace[full.trace.length - 1], capped.trace[capped.trace.length - 1]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Report paths are POSIX-shaped whatever the platform separator is. A SARIF artifactLocation.uri
// holding a backslash is not a URI, and a path that changes shape when --repos is passed makes one
// file read as two. Asserted on a nested tree, because a separator only appears inside one.
test('report paths and SARIF URIs use forward slashes, with and without --repos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-sep-'));
  try {
    const src = readFileSync(join(FIXTURES, 'dataflow', 'pos', 'S1.cbl'), 'latin1');
    for (const repo of ['r1', 'r2']) {
      mkdirSync(join(dir, repo, 'src', 'deep'), { recursive: true });
      writeFileSync(join(dir, repo, 'src', 'deep', `${repo.toUpperCase()}.cbl`), src.replace(/PROGRAM-ID\.\s+\S+/i, `PROGRAM-ID. ${repo.toUpperCase()}.`));
    }
    const paths = (report) => [
      ...report.findings.flatMap(f => [f.path, ...(f.related || []).map(x => x.path)]),
    ].filter(Boolean);

    for (const extra of [[], ['--repos']]) {
      const where = extra.length ? 'with --repos' : 'without --repos';
      const target = extra.length ? dir : join(dir, 'r1');

      for (const command of ['scan', 'flow']) {
        const r = run(command, target, ...extra);
        assert.equal(r.status, 0, r.stderr);
        const found = paths(JSON.parse(r.stdout));
        assert.ok(found.length, `${command} ${where} produced no path to check`);
        for (const p of found) assert.ok(!p.includes(BACKSLASH), `${command} ${where}: native separator in ${JSON.stringify(p)}`);
      }

      const s = run('scan', target, ...extra, '--format', 'sarif');
      assert.equal(s.status, 0, s.stderr);
      const uris = JSON.parse(s.stdout).runs[0].results.flatMap(x => x.locations.map(l => l.physicalLocation.artifactLocation.uri));
      assert.ok(uris.length, `sarif ${where} produced no uri to check`);
      for (const u of uris) assert.ok(!u.includes(BACKSLASH), `sarif ${where}: native separator in ${JSON.stringify(u)}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an option that takes a value refuses a missing one rather than taking the next option as it', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cw-cli-'));
  try {
    for (const args of [['--out'], ['--out', '--quiet'], ['--advisories'], ['--advisories', ','], ['--rule', ''], ['--only', '--quiet'], ['--report', '--quiet']]) {
      const r = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURES, 'dataflow'), ...args], { encoding: 'utf8', cwd });
      assert.equal(r.status, 2, args.join(' '));
      assert.equal(r.stdout, '', args.join(' '));
      assert.match(r.stderr, new RegExp(`${args[0]} needs a value`), args.join(' '));
    }
    assert.deepEqual(readdirSync(cwd), []);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('--advisories loads each named feed once, and a command that reads no advisories refuses it', () => {
  const estate = mkdtempSync(join(tmpdir(), 'cw-cli-estate-'));
  const outside = mkdtempSync(join(tmpdir(), 'cw-cli-feed-'));
  try {
    writeFileSync(join(estate, 'cobolwork.site.json'), JSON.stringify({ runtimeVersions: { 'cics-ts': '5.6' } }));
    const feed = join(outside, 'feed.json');
    writeFileSync(feed, JSON.stringify({ schemaVersion: 1, extract: 'portal export, estate A', retrieved: '2026-09-01', advisories: [
      { kind: 'advisory', product: 'cics-ts', id: 'PORTAL-0001', affected: '[5.5,5.6]', fixedIn: '6.1', severity: 'high', summary: 'A crafted request to a CICS region corrupts storage.', source: { doc: 'bulletin 0001' } },
    ] }));
    const env = { ...process.env, COBOLWORK_ADVISORIES: '' };
    const scan = (...extra) => spawnSync(process.execPath, [CLI, 'scan', estate, '--only', 'build', ...extra], { encoding: 'utf8', env });
    const portal = (report) => report.findings.filter((f) => /PORTAL-0001/.test(f.detail)).length;

    const r = scan('--advisories', `${feed},${feed}`);
    assert.equal(r.status, 0, r.stderr);
    const withFeed = JSON.parse(r.stdout);
    assert.deepEqual(withFeed.summary.advisoryFeeds.map((f) => [f.file, f.loaded, f.refused]), [['feed.json', 1, 0]]);
    assert.equal(portal(withFeed), 1);

    const without = JSON.parse(scan().stdout);
    assert.equal(without.summary.advisoryFeeds, undefined);
    assert.equal(portal(without), 0);

    for (const command of ['flow', 'diff', 'inventory']) {
      const refused = spawnSync(process.execPath, [CLI, command, estate, '--advisories', feed], { encoding: 'utf8', env });
      assert.equal(refused.status, 2, command);
      assert.match(refused.stderr, new RegExp(`${command} reads no advisories`));
    }
  } finally {
    rmSync(estate, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a stored report that is missing or not JSON is refused with its path and why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cli-report-'));
  try {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"tool":');
    for (const [file, why] of [[join(dir, 'none.json'), /no such file/], [bad, /not JSON/]]) {
      const r = run('explain', dir, 'fp', '--report', file);
      assert.equal(r.status, 2, file);
      assert.ok(r.stderr.includes(file), r.stderr);
      assert.match(r.stderr, why);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
