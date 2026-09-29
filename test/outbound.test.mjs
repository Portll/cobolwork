// Data at rest leaving through channels the program opens itself, beyond HTTP, sockets and MQ: a
// transient-data queue the CSD sends out of the region, and the containers a service call sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'outbound');
const report = scan(FIXTURES);
const at = (file) => report.findings.filter((f) => f.path === file).map((f) => [f.rule, f.line, f.sev]);

test('a row written to a queue the CSD sends to a DD is data leaving the region', () => {
  assert.deepEqual(at('EXTRAQ.cbl'), [['database-to-extrapartition-queue', 9, 'low']]);
  assert.match(report.findings.find((f) => f.path === 'EXTRAQ.cbl').detail, /out of the region to DD RPTOUT/);
});

test('the same row to an intrapartition queue stays inside the region', () => {
  assert.deepEqual(at('INTRAQ.cbl'), []);
});

test('a row fetched into one qualified field reaches that field alone, and a host structure every field', () => {
  assert.deepEqual(at('HOSTSTR.cbl'), [['database-to-extrapartition-queue', 16, 'low'], ['database-to-extrapartition-queue', 17, 'low']]);
});

test('a service call sends the containers on its channel, and only those', () => {
  const f = report.findings.filter((x) => x.path === 'INVOKE.cbl');
  assert.deepEqual(f.map((x) => [x.rule, x.line]), [['database-to-outbound-http', 15]]);
  assert.match(f[0].detail, /INVOKE SERVICE sending CONTAINER\(DFHWS-DATA\) on CHANNEL\(SVC\)/);
});

test('web input choosing where a service call goes is the same as choosing a host', () => {
  assert.deepEqual(at('INVOKEURI.cbl'), [['cics-web-to-outbound-host', 9, 'high']]);
});
