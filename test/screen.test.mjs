// A diagnostic the system set, shown on the terminal. A RESP on an error line is ordinary; Db2's
// message text names tables, columns and constraints, and is reported low.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'screen');
const report = scan(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file && f.rule === 'system-response-to-screen');

test('Db2 message text sent to the terminal is reported low', () => {
  const [f, ...rest] = of('SQLMSG.cbl');
  assert.equal(rest.length, 0);
  assert.equal(f.sev, 'low');
  assert.equal(f.cwe, 'CWE-209');
  assert.equal(f.line, 15);
  assert.match(f.detail, /SQLERRMC, which the system sets/);
  assert.match(f.detail, /EXEC CICS SEND TEXT FROM\(WS-MSG\)/);
});

test('a RESP on the error line of a map is ordinary, and not followed to the screen', () => {
  assert.deepEqual(of('RESPMAP.cbl'), []);
});

test('a failure answered with the program\'s own words is not a leak', () => {
  assert.deepEqual(of('FIXEDMSG.cbl'), []);
});
