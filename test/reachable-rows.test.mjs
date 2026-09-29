// SPDX-License-Identifier: AGPL-3.0-or-later
// The five rules built for the rows that were reachable but unreported.
//
// Of the 86 rows no rule reported, 19 were reachable: 4 an existing rule could take with a known
// change, and 15 gated on a fact only the estate has. Those 19 are 5 rules, not 19 - several rows
// are the same defect seen through different products.
//
// Two of the fifteen were refused on measurement rather than built, and the refusals are recorded
// in docs/spec/z-sibling-rules.md: a debug PARM appears in 0 of 124 repositories, and every one of
// the 71 CICS programs with a password field names no attempt counter, because counting attempts
// is RACF's job rather than the program's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPriv } from '../lib/sets/priv.mjs';
import { scanWeb, WEB_RULES } from '../lib/sets/web.mjs';
import { ALL_RULES } from '../lib/scan.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const bare = scanPriv(join(HERE, 'fixtures', 'priv'));
const sited = scanPriv(join(HERE, 'fixtures', 'priv-site'));
const web = scanWeb(join(HERE, 'fixtures', 'web-more'));
const ruleOf = (r, id) => r.findings.filter((f) => f.rule === id);

test('a dataset whose name says it holds diagnostic output is reported where it lands', () => {
  // The name is the estate saying what is in it, which is better evidence than guessing from the
  // step that wrote it. A dump or an unload holds whatever the job was working on.
  const seen = ruleOf(bare, 'job-writes-diagnostic-output-unrestricted').map((f) => f.detail.match(/writes ([A-Z0-9.]+)/)[1]).sort();
  assert.deepEqual(seen, ['PUBLIC.BANK.UNLOAD', 'PUBLIC.RACF.UNLOAD', 'SECURE.RACF.AUDIT']);
  for (const f of ruleOf(bare, 'job-writes-diagnostic-output-unrestricted')) {
    assert.equal(f.evidence, 'context', 'with no prefix declared it observes and asserts nothing');
  }
});

test('a dataset only read is not a dataset written', () => {
  // PUBLIC.BANK.TRACE is DISP=SHR. Where diagnostic output lands is the question; where it comes
  // from is not, and reporting a read would double every finding.
  assert.equal(bare.findings.some((f) => /PUBLIC\.BANK\.TRACE/.test(f.detail)), false);
});

test('once the estate names its restricted prefixes, the one that is covered clears', () => {
  const seen = ruleOf(sited, 'job-writes-diagnostic-output-unrestricted').map((f) => f.detail.match(/writes ([A-Z0-9.]+)/)[1]).sort();
  assert.deepEqual(seen, ['PUBLIC.BANK.UNLOAD', 'PUBLIC.RACF.UNLOAD'], 'SECURE.RACF.AUDIT is under a declared prefix');
  for (const f of ruleOf(sited, 'job-writes-diagnostic-output-unrestricted')) {
    assert.equal(f.sev, 'med');
    assert.equal(f.evidence, 'construct', 'and the ones left over became defects');
  }
});

test('a job that runs a shell says so, and names the fact that would decide it', () => {
  const f = ruleOf(bare, 'job-reaches-unix-system-services')[0];
  assert.match(f.detail, /runs BPXBATCH/);
  assert.match(f.detail, /superuserIds/, 'the reader is told which fact settles it');
  assert.equal(f.evidence, 'context');
});

test('a response header that names the software answering is reported', () => {
  const f = ruleOf(web, 'web-response-tells-the-caller-what-it-runs')[0];
  assert.match(f.detail, /writes the header Server with the value 'CICS TS 5.6'/);
  assert.equal(f.cwe, 'CWE-200');
});

test('a credential in a URI is one finding per program, at the line that shows it', () => {
  // URICRED both writes a literal query naming a password and STRINGs the field in. That is one
  // credential in one place, and the STRING carries the line worth reading.
  const hits = ruleOf(web, 'web-uri-carries-a-credential');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 10);
  assert.match(hits[0].detail, /STRINGs WS-API-PASSWORD/);
});

test('a state change on a web request with no token is reported, and one with a token is not', () => {
  const hits = ruleOf(web, 'web-request-changes-state-without-a-token');
  assert.deepEqual(hits.map((f) => f.path), ['NOTOKEN.cbl']);
  assert.equal(hits[0].evidence, 'advisory', 'it cannot follow a token checked in another program');
  assert.match(hits[0].detail, /could not rule out/);
});

test('Cache-Control joined the headers whose absence is checked', () => {
  // CVE-2022-33955 is a back-and-refresh attack: the browser keeps the page after the session.
  const f = ruleOf(web, 'web-response-without-protective-headers')[0];
  assert.match(f.detail, /cache-control/);
});

test('every new rule is declared with an impact and a remedy, and is in the catalogue', () => {
  for (const id of ['web-response-tells-the-caller-what-it-runs', 'web-uri-carries-a-credential',
    'web-request-changes-state-without-a-token']) {
    assert.ok(WEB_RULES[id].impact.length > 40, id);
    assert.ok(WEB_RULES[id].remedy.length > 40, id);
    assert.ok(ALL_RULES[id], id);
  }
  for (const id of ['job-writes-diagnostic-output-unrestricted', 'job-reaches-unix-system-services']) {
    assert.ok(ALL_RULES[id], id);
  }
});
