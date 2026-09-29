// What a response says about itself. These two rules report an absence, which makes the negative
// cases the load-bearing ones: a program that stated every attribute and every header must produce
// nothing, or the rule is noise wearing a CWE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanWeb, WEB_RULES } from '../lib/sets/web.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'web');
const report = scanWeb(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file).map((f) => [f.rule, f.line, f.sev]).sort();

test('a cookie set without the attributes that keep it off a cleartext hop is reported once', () => {
  assert.deepEqual(of('WEBCOOKIE.cbl'), [
    ['web-cookie-without-secure-attributes', 8, 'med'],
    ['web-response-without-protective-headers', 12, 'low'],
  ]);
  const cookie = report.findings.find((f) => f.rule === 'web-cookie-without-secure-attributes');
  assert.match(cookie.detail, /without Secure, HttpOnly, SameSite/);
  assert.match(cookie.detail, /cleartext hop/, 'the detail says what the missing attribute costs');
});

test('a program that stated every attribute and every header is reported as nothing', () => {
  assert.deepEqual(of('WEBSAFE.cbl'), []);
});

test('a reply that is not markup is not asked who may frame it', () => {
  // Nothing frames a JSON payload and nothing sniffs it into script, so the headers that govern
  // both are not absences worth reporting.
  assert.deepEqual(of('WEBJSON.cbl'), []);
});

test('a link that opens a window keeping a handle back is reported, once for the program', () => {
  assert.deepEqual(of('WEBLINK.cbl'), [
    ['web-link-opens-without-noopener', 12, 'low'],
    ['web-response-without-protective-headers', 12, 'low'],
  ]);
});

test('a header name the program computed is counted as unread, not as one that was not written', () => {
  // The finding still stands - nothing in the source says the header was written - but the detail
  // says the analysis could not read one, so the reader is not told an absence was proved.
  const f = report.findings.find((x) => x.path === 'WEBCOMPUTED.cbl');
  assert.equal(f.rule, 'web-response-without-protective-headers');
  assert.match(f.detail, /1 header name or value in this program is computed/);
  assert.equal(report.summary.headersComputed, 1);
});

test('a header written in one paragraph protects a response sent in another', () => {
  // WEBSAFE writes its headers four statements before the send. Judging per statement instead of
  // per program would report it, and that finding would be wrong.
  assert.equal(report.summary.webPrograms, 5);
  assert.equal(report.summary.htmlResponses, 4);
  assert.equal(report.findings.filter((f) => f.program === 'WEBSAFE').length, 0);
});

test('every rule carries the CWE its class is known by', () => {
  assert.equal(WEB_RULES['web-cookie-without-secure-attributes'].cwe, 'CWE-1004');
  assert.equal(WEB_RULES['web-response-without-protective-headers'].cwe, 'CWE-1021');
  assert.equal(WEB_RULES['web-link-opens-without-noopener'].cwe, 'CWE-1022');
  // Every rule here reports an absence in what the program wrote, which is `construct` - except
  // the CSRF one, which is `advisory` because it cannot follow a token checked in another program
  // reached by LINK, and the guard model refuses to invent a cross-program guarantee.
  for (const [id, r] of Object.entries(WEB_RULES)) {
    assert.equal(r.evidence, id === 'web-request-changes-state-without-a-token' ? 'advisory' : 'construct', id);
  }
});

// Shapes a real CICS web program takes, which the corpus cannot supply: no public repository uses
// the CICS web API at all, so the only way to find out what these rules do on ordinary code is to
// write ordinary code.
const SHAPES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'web-shapes');
const shapes = scanWeb(SHAPES);
const shapeOf = (file) => shapes.findings.filter((f) => f.path === file).map((f) => f.rule).sort();

test('a page built with MOVE, and sent with a media type chosen at run time, is still a page', () => {
  // This was a false negative. A COBOL program builds its markup in working storage and sends
  // that; reading only the literals inside the EXEC CICS block saw no HTML and reported nothing.
  assert.deepEqual(shapeOf('MOVEDHTML.cbl'), ['web-response-without-protective-headers']);
});

test('headers written in a paragraph performed before the send still protect it', () => {
  assert.deepEqual(shapeOf('HDRPARA.cbl'), []);
});

test('cookie attributes are recognised whatever case they are written in', () => {
  // The header name and all three attributes are lower case here.
  assert.equal(shapeOf('LOWERCASE.cbl').includes('web-cookie-without-secure-attributes'), false);
  assert.deepEqual(shapeOf('LOWERCASE.cbl'), ['web-response-without-protective-headers']);
});

// The listener that accepts the request every other rule in this set is about. It is defined in a
// CSD, not in a program, and it is the only part of N-CRYPTO the corpus witnesses: ICSF calls,
// EXEC CICS WEB OPEN and hardcoded initialisation vectors are each zero across 124 repositories.
const CSD = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'web-csd');
const listeners = scanWeb(CSD);

test('a listener with SSL off, and one that says nothing, are the same finding', () => {
  // CICS defaults SSL to NO, so a definition that is silent accepts cleartext exactly as one that
  // says NO does. GenApp's real listener is the silent kind, which is why it must be reported.
  assert.deepEqual(listeners.findings.map((f) => [f.rule, f.line]), [
    ['cics-listener-accepts-cleartext', 2],
    ['cics-listener-accepts-cleartext', 5],
  ]);
  assert.match(listeners.findings[0].detail, /an IPIC connection on port 30709 with SSL\(NO\)/);
  assert.match(listeners.findings[1].detail, /no SSL attribute, which CICS defaults to NO/);
});

test('a listener that terminates TLS, however it says so, is not a finding', () => {
  // SSL(YES) and SSL(CLIENTAUTH) both encrypt; only the second also demands a client certificate.
  assert.equal(listeners.summary.listenersDefined, 4, 'all four were read');
  assert.equal(listeners.findings.length, 2, 'and the two that encrypt are not reported');
});

test('the web set is registered and its rules are in the catalogue of all rules', () => {
  assert.ok(RULE_SETS.includes('web'));
  for (const id of Object.keys(WEB_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});
