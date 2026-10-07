// The CICS application API as an attack surface: the response a program returns, its headers, the
// host it calls, and the queue name it is given. CICS escapes nothing it sends and validates no
// name it is handed, so each is the program's own responsibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cicsweb');
const report = scan(FIXTURES);
const of = (file) => report.findings.filter(f => f.path === file).map(f => [f.rule, f.line, f.sev]).sort();

test('web input echoed into the reply, a header, a host and a queue name is reported once each', () => {
  assert.deepEqual(of('WEBECHO.cbl'), [
    ['cics-web-to-http-header', 22, 'high'],
    ['cics-web-to-outbound-host', 25, 'high'],
    ['cics-web-to-queue-name', 28, 'high'],
    ['cics-web-to-web-response', 19, 'high'],
  ]);
});

test('a form field CICS returns in VALUE is web input', () => {
  assert.deepEqual(of('WEBFORM.cbl'), [['cics-web-to-http-header', 11, 'high']]);
});

test('a queue item and the data a START passed are stored by another task, and choose a transfer', () => {
  assert.deepEqual(of('QUEUEXFER.cbl'), [
    ['cics-queue-to-cics-dynamic-transfer', 13, 'high'],
    ['cics-queue-to-cics-dynamic-transfer', 15, 'high'],
  ]);
  const f = report.findings.find((x) => x.path === 'QUEUEXFER.cbl' && x.line === 15);
  assert.match(f.detail, /READQ TS INTO/);
});

test('a fixed page, and a queue the program names itself, are not reported', () => {
  assert.deepEqual(of('WEBSTATIC.cbl'), []);
});

test('every new rule carries the CWE its class is known by', () => {
  const cwe = Object.fromEntries(report.findings.map(f => [f.rule, f.cwe]));
  assert.equal(cwe['cics-web-to-web-response'], 'CWE-79');
  assert.equal(cwe['cics-web-to-http-header'], 'CWE-113');
  assert.equal(cwe['cics-web-to-outbound-host'], 'CWE-918');
  assert.equal(cwe['cics-web-to-queue-name'], 'CWE-99');
});

test('a send on a session this program opened is data leaving, not a reply it owns', () => {
  assert.deepEqual(of('WEBCLIENT.cbl'), [['file-record-to-outbound-http', 22, 'high']]);
});

test('a stored value is reported where the reply is markup, not where it is data', () => {
  assert.deepEqual(of('WEBSTORED.cbl'), [['database-to-web-response', 14, 'med']]);
});
