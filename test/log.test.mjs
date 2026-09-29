// What a program writes into a log. The rule is its matcher, so most of these tests are about
// names rather than about scanning, and the ones that matter are the two false-positive classes a
// corpus measurement caught before the rule was written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLog, LOG_RULES, classify } from '../lib/sets/log.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
import { classesOf } from '../lib/consequence.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'log');
const report = scanLog(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file).map((f) => [f.rule, f.line, f.sev]).sort();

test('a credential and a personal field written to a log are reported, by the name they carry', () => {
  assert.deepEqual(of('PAYLOG.cbl'), [
    ['log-writes-a-credential', 13, 'high'],
    ['log-writes-personal-data', 14, 'med'],
  ]);
});

test('a token only counts as a whole component of the name', () => {
  // Measured over the corpus, a substring match scored six hits of which four were these two,
  // both matching PAN inside COMPANY. That was a 67% false-positive rate before a line was written.
  assert.equal(classify('COMPANY-NAME'), null);
  assert.equal(classify('SS-COMPANY-LIABILITY-DATA'), null);
  assert.equal(classify('WS-TEMP-SSN-ORIG'), 'personal');
});

test('an account number is a ledger account, not a person', () => {
  // ACCT-NO matched 83 of the 90 personal-data hits in the corpus and every one was a chart-of-
  // accounts code in a payroll program. Including it made the rule 92% wrong where it fired.
  assert.equal(classify('DED-FICA-ACCT-NO'), null);
  assert.equal(classify('DED-CO-SUI-ACCT-NO'), null);
  assert.equal(classify('WS-CARD-NUM'), 'personal', 'a card number is still personal');
});

test('a field whose name says it was already made safe is not the defect', () => {
  for (const n of ['WS-MASKED-PAN', 'WS-SSN-MASKED', 'WS-HASHED-PWD', 'PAN-LAST4', 'SSN-TRUNCATED']) {
    assert.equal(classify(n), null, n);
  }
});

test('a name that holds something about a credential does not hold the credential', () => {
  for (const n of ['WS-PASSWORD-PROMPT', 'WS-PASSWORD-ERROR', 'WS-PASSWORD-VALID', 'WS-DIR-TOKEN-CNT', 'PASSWORD-LENGTH']) {
    assert.equal(classify(n), null, n);
  }
  for (const n of ['WS-INPUT-PASSWORD', 'W-EXE-PWD-UTE', 'WS-PASSWORD-USUARIO']) assert.equal(classify(n), 'credential', n);
  assert.deepEqual(of('MESSAGES.cbl'), []);
});

test('a token is a credential only beside a word of authentication or where only a credential comes from', () => {
  // A lexer's token, and the handle CICS gives an outbound web session, are not credentials.
  assert.deepEqual(of('LEXER.cbl'), []);
  // One CICS verifies as a token is, and so is one from an environment variable or a file named for secrets.
  assert.deepEqual(of('CICSTOK.cbl'), [['log-writes-a-credential', 12, 'high']]);
  assert.deepEqual(of('TOKENS.cbl'), [
    ['log-writes-a-credential', 21, 'high'],
    ['log-writes-a-credential', 22, 'high'],
    ['log-writes-a-credential', 23, 'high'],
  ]);
});

test('a numeric field is a number, and only a PIN of four digits or more is a numeric credential', () => {
  assert.deepEqual(of('NUMBERS.cbl'), [['log-writes-a-credential', 20, 'high']]);
});

test('a password shown back to the person who typed it is low, and says it went to their terminal', () => {
  assert.deepEqual(of('ECHO.cbl'), [
    ['display-echoes-a-credential', 12, 'low'],
    ['display-echoes-a-credential', 15, 'low'],
  ]);
  for (const f of report.findings.filter((x) => x.path === 'ECHO.cbl')) assert.match(f.detail, /on the terminal to the person who typed it/);
});

test('an echo in a program a job runs goes to SYSOUT, and stays high', () => {
  // BATCH.jcl runs BATCHPW by PGM=, PROCPW through a procedure, PWMEMBER by its member name, and
  // compiles COMPPW with IBM's procedure.
  for (const file of ['BATCHPW.cbl', 'PROCPW.cbl', 'MEMBERPW.cbl', 'COMPPW.cbl']) {
    assert.deepEqual(of(file), [['log-writes-a-credential', 12, 'high']], file);
  }
});

test('a job whose program nobody names leaves every echo in the repository high', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-log-'));
  writeFileSync(join(root, 'ECHO.cbl'), readFileSync(join(FIXTURES, 'ECHO.cbl')));
  writeFileSync(join(root, 'RUN.jcl'), '//RUNJOB   JOB (ACCT),CLASS=A\n//RUN      EXEC PGM=&PROG\n');
  const r = scanLog(root);
  assert.deepEqual(r.findings.map((f) => [f.rule, f.line, f.sev]).sort(), [
    ['log-writes-a-credential', 12, 'high'],
    ['log-writes-a-credential', 15, 'high'],
  ]);
});

test('a CGI response that echoes a posted password is low; one on file, or that may be, is high', () => {
  assert.deepEqual(of('CGIECHO.cbl'), [
    ['display-echoes-a-credential', 35, 'low'],
    ['log-writes-a-credential', 36, 'high'],
    ['log-writes-a-credential', 37, 'high'],
  ]);
  assert.deepEqual(of('CGIPOST.cbl'), [['display-echoes-a-credential', 19, 'low']]);
  for (const f of report.findings.filter((x) => x.rule === 'display-echoes-a-credential' && /^CGI/.test(x.path))) {
    assert.match(f.detail, /which the request posted, into its HTTP response/);
  }
});

test('the low echo is outside every class a build refuses', () => {
  assert.equal(LOG_RULES['display-echoes-a-credential'].sev, 'low');
  assert.deepEqual(classesOf({ rule: 'display-echoes-a-credential', sev: 'low' }), []);
  assert.deepEqual(classesOf({ rule: 'log-writes-a-credential', sev: 'high' }), ['privilege-escalation']);
});

test('a typed password is still logged when it goes to the console, or when something else can fill its bytes', () => {
  assert.deepEqual(of('ECHOLOG.cbl'), [
    ['log-writes-a-credential', 24, 'high'],
    ['log-writes-a-credential', 29, 'high'],
    ['log-writes-a-credential', 34, 'high'],
  ]);
});

test('a password on file is reported where it is displayed, though the same field is typed elsewhere', () => {
  assert.deepEqual(of('STORED.cbl'), [['log-writes-a-credential', 29, 'high']]);
});

test('a session cookie issued in a CGI response is silent, and DISPLAY UPON SYSERR goes to the server log', () => {
  assert.deepEqual(of('CGISID.cbl'), [['log-writes-a-credential', 14, 'high']]);
  assert.equal(report.findings.some((f) => /WS-SESSION-TOKEN/.test(f.detail)), false);
});

test('a program that logs only what it made safe is reported as nothing', () => {
  assert.deepEqual(of('PAYSAFE.cbl'), []);
});

test('the console is a log, however the program reaches it', () => {
  // EXEC CICS WRITE OPERATOR puts the message on the console and into the system log, where it
  // outlives the screen. DISPLAY ... UPON CONSOLE is the batch route to the same place.
  assert.deepEqual(of('CONSLOG.cbl'), [['log-writes-a-credential', 9, 'high']]);
});

test('a program whose only sink is the console is read, not reported as no source', () => {
  // The WRITE OPERATOR sink was added and the prefilter two lines away was not, so a file with no
  // DISPLAY in it was skipped before filesScanned counted it and the set said nosrc. A clean result
  // over source nobody read is the one thing this project refuses.
  //
  // The field name appears in no DISPLAY anywhere in these fixtures on purpose: the per-program
  // per-field dedup would otherwise fold this hit behind a DISPLAY of the same name, which is how
  // hard-coding isOperator = false used to leave every test in this file green.
  assert.deepEqual(of('CONSOLEONLY.cbl'), [['log-writes-a-credential', 8, 'high']]);
  const alone = scanLog(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'log'));
  assert.equal(alone.summary.nosrc, false);
});

test('what follows UPON is where the value went, not a value', () => {
  // The parser hands DISPLAY's operands back including UPON and the mnemonic after it, so a
  // destination was being judged as though it were a field. Nothing in the lists collides with
  // CONSOLE or SYSOUT today, which is exactly why this would have rotted quietly.
  const r = scanLog(FIXTURES);
  const written = r.findings.map((f) => / (?:writes|shows|puts) ([A-Z0-9-]+)/.exec(f.detail)?.[1]);
  assert.ok(written.length && written.every(Boolean), 'every finding names the value it writes');
  assert.deepEqual(written.filter((w) => ['CONSOLE', 'SYSOUT', 'UPON'].includes(w)), []);
});

test('a temporary-storage queue is not a log', () => {
  // WRITEQ TS is working state a program reads back. Counting it would put the whole
  // pseudo-conversational idiom in scope, and the rule would report the idiom rather than a defect.
  assert.ok(report.summary.logWrites > 0);
  assert.equal(report.findings.some((f) => /WRITEQ TS/.test(f.detail)), false);
});

test('a field is reported once per program however many ways it is written', () => {
  // PAYLOG both DISPLAYs WS-EMP-SSN and writes it with WRITEQ TD. The fix is one edit.
  assert.equal(report.findings.filter((f) => /WS-EMP-SSN/.test(f.detail)).length, 1);
});

test('every rule carries the CWE its class is known by', () => {
  assert.equal(LOG_RULES['log-writes-a-credential'].cwe, 'CWE-532');
  assert.equal(LOG_RULES['log-writes-personal-data'].cwe, 'CWE-532');
  assert.equal(LOG_RULES['display-echoes-a-credential'].cwe, 'CWE-200');
  for (const r of Object.values(LOG_RULES)) assert.equal(r.evidence, 'construct');
});

test('the log set is registered and its rules are in the catalogue of all rules', () => {
  assert.ok(RULE_SETS.includes('log'));
  for (const id of Object.keys(LOG_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});
