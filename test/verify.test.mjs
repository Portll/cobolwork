// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificationPlan, MARKER } from '../lib/verify.mjs';
import { explainFinding } from '../lib/explain.mjs';
import { scanAll } from '../lib/scan.mjs';
import { kindsOf } from '../lib/consequence.mjs';
import { ALL_RULES } from '../lib/kernel/registry.mjs';
import { setMemoryReaders } from '../lib/kernel/memory.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, '..', 'bench', 'cases');
const MB = 1024 * 1024;
const scanned = (root) => {
  setMemoryReaders({ heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }), free: () => 4096 * MB });
  try { return scanAll(root); } finally { setMemoryReaders(); }
};
const planOf = (name, rule) => {
  const root = join(CASES, name);
  const r = scanned(root);
  const f = r.findings.find((x) => x.rule === rule);
  return { r, f, p: explainFinding(r, f.fingerprint, { root }) };
};

const route = (rule, over = {}) => ({
  rule, path: 'INQ.cbl', line: 13, program: 'INQ', fingerprint: 'f'.repeat(32),
  related: [{ path: 'INQ.cbl', line: 10, detail: 'EXEC CICS RECEIVE' }],
  trace: [{ program: 'INQ', item: 'WS-IN' }, { program: 'INQ', item: 'WS-X' }],
  startedBy: [{ transaction: 'CR00', file: 'REGION.csd', line: 2 }],
  ...over,
});
const pathRules = Object.keys(ALL_RULES).filter((r) => ALL_RULES[r].evidence === 'path' && kindsOf(r));
const ACTS = new Set(['os-command', 'dynamic-sql', 'internal-reader', 'cics-system-resource', 'connection-target', 'outbound-host',
  'outbound-http', 'socket-send', 'message-queue', 'extrapartition-queue', 'xml-document', 'http-header', 'queue-name', 'storage-length']);

test('V1.1 Every path rule has a plan', () => {
  for (const r of pathRules) assert.ok(verificationPlan(route(r)), r);
});

test('V1.2 A sink that acts is read at the operation with the marker and stopped before it runs', () => {
  for (const r of pathRules) {
    const { source, sink } = kindsOf(r);
    if (!ACTS.has(sink) || source === 'system-response') continue;
    const p = verificationPlan(route(r));
    assert.equal(p.run, null, r);
    assert.match(p.stopBefore, /before the operation runs/, r);
    if (sink !== 'storage-length') assert.equal(p.value, MARKER, r);
  }
});

test('V1.3 No plan carries a value that would run', () => {
  for (const r of pathRules) {
    const p = verificationPlan(route(r));
    assert.ok(p.value === null || !/[;|`$"'=&]|--|\/\/|\/\*|\bDROP\b|\bDELETE\b|\bEXEC\b|<[a-z]/i.test(p.value), `${r}: ${p.value}`);
  }
});

test('V1.4 An asterisk in a numeric field, watched for the data exception', () => {
  const { p } = planOf('057-terminal-quantity-reaches-arithmetic', 'cics-terminal-to-arithmetic');
  assert.match(p.verify.value, /an asterisk in every position of WS-QTY/);
  assert.match(p.verify.run, /ASRA.*S0C7/);
  assert.match(p.verify.observe, /ARITH\.cbl:14/);
  assert.match(p.verify.tool, /^CEDF/);
});

test('V1.5 A subscript plan takes the table size from the finding and stops before the overrun', () => {
  const { p } = planOf('053-terminal-input-chooses-a-table-row', 'cics-terminal-to-subscript');
  assert.match(p.verify.value, /^11, one more than the 10 entries/);
  assert.equal(p.verify.run, null);
  assert.match(p.verify.stopBefore, /without SSRANGE/);
  const ss = verificationPlan(route('cics-terminal-to-subscript', { ssrange: true }));
  assert.match(ss.run, /IGZ0006S/);
  assert.equal(ss.stopBefore, undefined);
});

test('V1.6 A job PARM route is entered in a copy of the job and read under a debugger', () => {
  const { p } = planOf('037-a-job-parameter-reaches-an-os-command', 'jcl-parm-to-os-command');
  assert.equal(p.verify.start, 'job RUNJOB step STEP010');
  assert.match(p.verify.enter, /PARM= on step STEP010.*in a copy of the job/);
  assert.match(p.verify.tool, /z\/OS Debugger/);
  assert.equal(p.verify.value, MARKER);
});

test('V1.7 A response code is provoked, not entered', () => {
  const { p } = planOf('092-an-sql-error-sent-to-the-web-client', 'system-response-to-web-response');
  assert.equal(p.verify.value, null);
  assert.match(p.verify.enter, /^nothing: provoke the failure/);
});

test('V1.8 A protected field is changed under CEDF, a key names another test user\'s record', () => {
  const p = verificationPlan(route('cics-protected-field-to-record-update', { screen: { field: 'ROWID', map: 'ACCTM', mapset: 'ACCTS' } }));
  assert.match(p.enter, /field ROWID of map ACCTM in mapset ACCTS.*under CEDF/);
  assert.match(p.value, /a different test user/);
  assert.match(p.run, /set the record up for this test alone/);
});

test('V1.9 A mitigated finding says what a stopped test means', () => {
  const p = verificationPlan(route('cics-terminal-to-arithmetic', { guardedFrom: 'high', guard: { item: 'WS-X', file: 'INQ.cbl', line: 12 } }));
  assert.match(p.check, /check on WS-X at INQ\.cbl:12.*not-reproduced/);
});

test('V1.10 A construct has no plan, and a scan report carries none', () => {
  assert.equal(verificationPlan(route('cics-transfer-to-variable-program')), null);
  const r = scanned(join(CASES, '004-web-input-built-into-sql'));
  const text = JSON.stringify(r);
  assert.ok(!text.includes(MARKER));
  assert.ok(!text.includes('"verify"'));
});
