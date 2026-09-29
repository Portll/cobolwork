// What a program writes into a log. The rule is its matcher, so most of these tests are about
// names rather than about scanning, and the ones that matter are the two false-positive classes a
// corpus measurement caught before the rule was written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLog, LOG_RULES, classify } from '../lib/sets/log.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
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
  const written = r.findings.map((f) => / writes (\S+) with /.exec(f.detail)?.[1]);
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
  for (const r of Object.values(LOG_RULES)) assert.equal(r.evidence, 'construct');
});

test('the log set is registered and its rules are in the catalogue of all rules', () => {
  assert.ok(RULE_SETS.includes('log'));
  for (const id of Object.keys(LOG_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});
