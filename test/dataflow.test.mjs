// Planted flows that must be found, and near-misses that must not be. Both directions: a taint
// engine that finds everything is as useless as one that finds nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { stampFingerprints, pairingKeys } from '../lib/kernel/identity.mjs';
import { toSarif } from '../lib/sarif.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'dataflow');
const report = scan(FIXTURES, { repos: ['pos', 'neg'] });
const of = (rule) => report.findings.filter(f => f.rule === rule);

test('command-line input reaching a command routine is found across two programs', () => {
  const f = of('argv-or-env-to-os-command');
  assert.equal(f.length, 1);
  assert.equal(f[0].crossProgram, true);
  assert.deepEqual(f[0].trace.map(t => `${t.program}.${t.item}`), ['P1.WS-IN', 'P1.WS-CMD', 'P2.LK-CMD', 'P2.WS-LOCAL']);
  assert.equal(f[0].sev, 'crit');
  assert.equal(f[0].cwe, 'CWE-78');
});

test('terminal input reaching a variable CICS transfer is found through the communication area', () => {
  const f = of('cics-terminal-to-cics-dynamic-transfer');
  assert.equal(f.length, 1);
  assert.equal(f[0].crossProgram, true);
  assert.ok(f[0].trace.some(t => t.item === 'DFHCOMMAREA'), 'the path should run through the communication area');
});

test('web input reaching dynamic SQL is found within one program', () => {
  const f = of('cics-web-to-dynamic-sql');
  assert.equal(f.length, 1);
  assert.equal(f[0].crossProgram, false);
});

test('near-misses report nothing', () => {
  const fromNeg = report.findings.filter(f => f.path.includes('/neg/') || f.related.some(r => r.path.includes('/neg/')));
  assert.deepEqual(fromNeg, [], 'an untainted argument, a literal command and a literal SQL statement are not findings');
});

test('the report states what it read', () => {
  assert.equal(report.summary.filesScanned, 8);
  assert.equal(report.summary.nosrc, false);
  assert.equal(report.summary.findings, report.findings.length);
});

test('a directory with no COBOL declares a void rather than a clean zero', () => {
  const empty = scan(join(FIXTURES, 'pos'), { repos: ['nothing-here'] });
  assert.equal(empty.summary.filesScanned, 0);
  assert.equal(empty.summary.nosrc, true);
  assert.equal(empty.summary.findings, 0);
});

test('a walk that reaches its bound stops, keeps what it found, and says the coverage is incomplete', () => {
  const whole = scan(FIXTURES, { repos: ['pos'] });
  assert.equal(whole.summary.coverageIncomplete, false);
  const cut = scan(FIXTURES, { repos: ['pos'], walkEdges: 2 });
  assert.ok(cut.summary.walksCut > 0);
  assert.equal(cut.summary.coverageIncomplete, true);
  assert.match(cut.summary.readInPart, /stopped at the bound/);
  assert.ok(cut.findings.length <= whole.findings.length);
  const none = scan(FIXTURES, { repos: ['pos'], totalEdges: 0 });
  assert.equal(none.findings.length, 0);
  assert.ok(none.summary.sourcesNotWalked > 0);
  assert.equal(none.summary.coverageIncomplete, true);
});

test('every walk to come is reserved its least, so a tight total still walks every source', () => {
  const whole = scan(FIXTURES, { repos: ['pos'] });
  const ample = scan(FIXTURES, { repos: ['pos'], totalEdges: whole.summary.edgesWalked + 2, minWalkEdges: 1 });
  assert.equal(ample.findings.length, whole.findings.length);
  assert.equal(ample.summary.coverageIncomplete, false);
  const tight = scan(FIXTURES, { repos: ['pos'], totalEdges: 6, minWalkEdges: 1 });
  assert.equal(tight.summary.sourcesNotWalked, 0);
  assert.ok(tight.summary.walksCut > 0);
  assert.equal(tight.summary.walkEdgesLeast, 1);
  assert.match(tight.summary.readInPart, /each walk given 1 edges or more/);
  const unreserved = scan(FIXTURES, { repos: ['pos'], totalEdges: 6, minWalkEdges: 1e9 });
  assert.ok(unreserved.summary.sourcesNotWalked > 0);
});

// hops is the route's length in nodes, source and sink included (docs/spec/flow-graph.md §3.1).
const HOPS = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hops');

test('hops is 1 where the operation reads the item the input arrived in', () => {
  const { findings } = scan(join(HOPS, 'direct'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'argv-or-env-to-os-command');
  assert.equal(findings[0].hops, 1);
  assert.equal(findings[0].trace.length, findings[0].hops);
  assert.deepEqual(findings[0].trace.map((t) => t.via), ['source']);
});

test('a group read through and a group written into each count one hop, as the MOVE between them does', () => {
  const { findings } = scan(join(HOPS, 'group'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].hops, 4);
  assert.deepEqual(findings[0].trace.map((t) => [t.item, t.via]), [['WS-IN', 'source'], ['WS-REC', 'group'], ['WS-OUT', 'MOVE at G1.cbl:13'], ['WS-CMD', 'group']]);
  assert.equal(findings[0].trace.filter((t) => t.via === 'group').length, 2);
});

test('hops is the same on two runs, and is outside the fingerprint and the pairing keys', () => {
  const root = join(HOPS, 'group');
  const [a] = scan(root).findings;
  const [b] = scan(root).findings;
  assert.deepEqual(a, b);
  const same = { ...a };
  const moved = { ...a, hops: a.hops + 3 };
  stampFingerprints([same, moved], { root });
  assert.equal(same.fingerprint, moved.fingerprint);
  assert.deepEqual(pairingKeys([same], { root }), pairingKeys([moved], { root }));
  assert.equal(a.sev, moved.sev, 'the count changes no severity');
});

test('SARIF carries hops on the result, beside the other per-finding properties', () => {
  const report = scan(join(HOPS, 'group'));
  const [result] = toSarif({ ...report, tool: 'cobolwork-flow', schemaVersion: 3 }, { toolVersion: 'test' }).runs[0].results;
  assert.equal(result.properties.hops, 4);
});
