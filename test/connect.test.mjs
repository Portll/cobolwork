// The database or queue manager a program connects to, when its caller names it. COBOL does not build
// JDBC URLs; it names a Db2 location in CONNECT TO and a queue manager in MQCONN's first argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'connect');
const report = scan(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file && f.rule.endsWith('-to-connection-target'));

test('terminal input naming the Db2 location of CONNECT TO is reported there', () => {
  const [f, ...rest] = of('SQLCONN.cbl');
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'cics-terminal-to-connection-target');
  assert.equal(f.sev, 'med');
  assert.equal(f.cwe, 'CWE-99');
  assert.equal(f.line, 13);
  assert.match(f.detail, /EXEC SQL CONNECT TO :WS-LOC/);
});

test('a user name from the terminal is not the target, where the location is the program\'s own', () => {
  assert.deepEqual(of('SQLFIXED.cbl'), []);
});

test('a job PARM naming the queue manager of MQCONN is reported low, at the call', () => {
  const [f] = of('MQPARM.cbl');
  assert.equal(f.rule, 'jcl-parm-to-connection-target');
  assert.equal(f.sev, 'low');
  assert.equal(f.line, 16);
  assert.match(f.detail, /CALL 'MQCONN' with queue manager W00-QM-NAME/);
});
