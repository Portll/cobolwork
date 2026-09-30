// A web request that changes state, and whether the program compared anything the browser could not
// forge. The state changes are the ones a request can make: a record, a row, a queue, a transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWeb } from '../lib/sets/web.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'web-csrf');
const report = scanWeb(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file && f.rule === 'web-request-changes-state-without-a-token');

test('an SQL UPDATE on a web request with no token is reported at the UPDATE', () => {
  const [f, ...rest] = of('SQLUPD.cbl');
  assert.equal(rest.length, 0);
  assert.equal(f.line, 12);
  assert.equal(f.sev, 'med');
  assert.match(f.detail, /changes state \(EXEC SQL UPDATE\)/);
  assert.match(f.detail, /could not rule out/);
});

test('a transaction started only for a POST is still reported, and the method test is named', () => {
  const [f] = of('POSTONLY.cbl');
  assert.match(f.detail, /EXEC CICS START TRANSID/);
  assert.match(f.detail, /tests the HTTP method, which a forged request sets too/);
});

test('a token tested only against SPACES verifies nothing', () => {
  const [f] = of('PRESENT.cbl');
  assert.match(f.detail, /EXEC CICS WRITE FILE/);
});

test('a token compared with the one issued, in an EVALUATE, clears the program', () => {
  assert.deepEqual(of('COMPARED.cbl'), []);
});
