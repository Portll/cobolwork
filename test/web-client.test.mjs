// CICS as an HTTP client, and a receive into a buffer: what WEB OPEN asks for, and whether a body
// can be longer than the area CICS copies it into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanWeb, WEB_RULES } from '../lib/sets/web.mjs';
import { scanAll } from '../lib/scan.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-webclient-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};

const prog = (id, data, body) => [
  '       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`,
  '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01  WS-TOK      PIC X(8).',
  ...data.map((d) => `       ${d}`),
  '       PROCEDURE DIVISION.',
  ...body.map((b) => `           ${b}`),
  '           EXEC CICS RETURN END-EXEC.', '',
].join('\n');

const open = (...options) => ['EXEC CICS WEB OPEN', ...options.map((o) => `    ${o}`), '    SESSTOKEN(WS-TOK)', 'END-EXEC'];
const rules = (r, path) => r.findings.filter((f) => f.path === path).map((f) => [f.rule, f.line]);

test('an outbound connection opened with HTTP is cleartext, and one opened with HTTPS is not', () => {
  const root = tree({
    'SENDSMS.cbl': prog('SENDSMS', ["01  WS-HOST     PIC X(15) VALUE '10.20.0.138'.", '01  WS-PORT     PIC S9(8) BINARY VALUE 50408.'],
      open('HOST(WS-HOST)', 'PORTNUMBER(WS-PORT)', 'HTTP')),
    'PAYTLS.cbl': prog('PAYTLS', ["01  WS-HOST     PIC X(15) VALUE 'pay.example'."], open('HOST(WS-HOST)', 'HTTPS')),
    'HTTPHOST.cbl': prog('HTTPHOST', ['01  HTTP-HOST   PIC X(15).'], open('HOST(HTTP-HOST)', 'HTTPS')),
    'NAMEDTLS.cbl': prog('NAMEDTLS', [], open("HOST('pay.example')", 'SCHEME(HTTPS)')),
    'NAMEDCLR.cbl': prog('NAMEDCLR', [], open("HOST('pay.example')", 'SCHEME(DFHVALUE(HTTP))')),
  });
  const r = scanWeb(root);
  assert.deepEqual(rules(r, 'SENDSMS.cbl'), [['web-client-opens-cleartext', 9]]);
  const sms = r.findings.find((f) => f.path === 'SENDSMS.cbl');
  assert.match(sms.detail, /connection to 10\.20\.0\.138 asking for HTTP rather than HTTPS/);
  assert.match(sms.detail, /unless an AT-TLS policy outside the program encrypts it/);
  assert.deepEqual(rules(r, 'PAYTLS.cbl'), []);
  assert.deepEqual(rules(r, 'HTTPHOST.cbl'), [], 'HTTP in a data name is not the HTTP option');
  assert.deepEqual(rules(r, 'NAMEDTLS.cbl'), [], 'SCHEME(HTTPS) names the CVDA as the keyword does');
  assert.deepEqual(rules(r, 'NAMEDCLR.cbl'), [['web-client-opens-cleartext', 7]]);
  assert.match(r.findings.find((f) => f.path === 'NAMEDCLR.cbl').detail, /to pay\.example/);
  assert.equal(r.summary.outboundOpens, 5);
  assert.equal(r.summary.opensUndecided, 0);
});

test('a URIMAP decides the scheme where the program names one, and AT-TLS-aware is not cleartext', () => {
  const root = tree({
    'csd/CLIENT.csd': [
      'DEFINE URIMAP(PAYMAP) GROUP(PAY) USAGE(CLIENT) SCHEME(HTTP)',
      '       HOST(pay.example) PATH(/charge)',
      'DEFINE URIMAP(ATTLSMAP) GROUP(PAY) USAGE(CLIENT) SCHEME(HTTP)',
      '       HOST(pay.example) ATTLS(AWARE)',
      'DEFINE URIMAP(TLSMAP) GROUP(PAY) USAGE(CLIENT) SCHEME(HTTPS) HOST(pay.example)',
      '',
    ].join('\n'),
    'VIAMAP.cbl': prog('VIAMAP', ["01  WS-MAP      PIC X(8) VALUE 'PAYMAP'."], open('URIMAP(WS-MAP)')),
    'VIAATTLS.cbl': prog('VIAATTLS', [], open("URIMAP('ATTLSMAP')")),
    'VIATLS.cbl': prog('VIATLS', [], open("URIMAP('TLSMAP')")),
    'VIAELSE.cbl': prog('VIAELSE', [], open("URIMAP('OTHERMAP')")),
    'VARSCHEME.cbl': prog('VARSCHEME', ['01  WS-SCHEME  PIC S9(8) BINARY.'], open('HOST(WS-TOK)', 'SCHEME(WS-SCHEME)')),
  });
  const r = scanWeb(root);
  assert.deepEqual(rules(r, 'VIAMAP.cbl'), [['web-client-opens-cleartext', 8]]);
  assert.match(r.findings.find((f) => f.path === 'VIAMAP.cbl').detail, /URIMAP PAYMAP, which csd\/CLIENT\.csd:1 defines with SCHEME\(HTTP\) to PAY\.EXAMPLE and no ATTLS\(AWARE\)/);
  for (const p of ['VIAATTLS.cbl', 'VIATLS.cbl', 'VIAELSE.cbl', 'VARSCHEME.cbl']) assert.deepEqual(rules(r, p), [], p);
  assert.equal(r.summary.opensUndecided, 2, 'a URIMAP the tree does not define and a scheme in a variable are counted as undecided');
});

test('in the shared pass, a URIMAP defined in a file after the program still decides its open', () => {
  const root = tree({
    'A.cbl': prog('A', [], open("URIMAP('LATEMAP')")),
    'zz/LATE.csd': 'DEFINE URIMAP(LATEMAP) GROUP(PAY) USAGE(CLIENT) SCHEME(HTTP) HOST(pay.example)\n',
  });
  const r = scanAll(root, { only: ['web'] });
  assert.deepEqual(r.findings.filter((f) => f.path === 'A.cbl').map((f) => f.rule), ['web-client-opens-cleartext']);
  assert.deepEqual(rules(scanWeb(root), 'A.cbl'), [['web-client-opens-cleartext', 7]]);
});

const receive = (verb, ...options) => [`EXEC CICS WEB ${verb}`, ...options.map((o) => `    ${o}`), 'END-EXEC'];

test('a receive whose MAXLENGTH is longer than its INTO area is reported, by literal or LENGTH OF', () => {
  const root = tree({
    'RECV.cbl': prog('RECV', ['01  WS-BODY     PIC X(1000).', '01  WS-BIG      PIC X(5000).', '01  WS-LEN      PIC S9(8) BINARY VALUE 9000.', '01  WS-GOT      PIC S9(8) BINARY.'], [
      ...receive('RECEIVE', 'INTO(WS-BODY)', 'MAXLENGTH(4096)', 'LENGTH(WS-GOT)'),
      ...receive('CONVERSE', 'SESSTOKEN(WS-TOK)', 'INTO(WS-BODY)', 'TOLENGTH(WS-GOT)', 'MAXLENGTH(LENGTH OF WS-BIG)'),
      ...receive('RECEIVE', 'INTO(WS-BODY)', 'MAXLENGTH(LENGTH OF WS-BODY)', 'LENGTH(WS-GOT)'),
      ...receive('RECEIVE', 'INTO(WS-BODY)', 'MAXLENGTH(1000)', 'LENGTH(WS-GOT)'),
      ...receive('RECEIVE', 'INTO(WS-BODY)', 'MAXLENGTH(WS-LEN)', 'LENGTH(WS-GOT)'),
    ]),
  });
  const r = scanWeb(root);
  assert.deepEqual(rules(r, 'RECV.cbl'), [['web-receive-length-exceeds-area', 11], ['web-receive-length-exceeds-area', 16]]);
  assert.match(r.findings[0].detail, /WEB RECEIVE pass up to MAXLENGTH\(4096\), 4096 bytes, into WS-BODY, which is 1000 bytes/);
  assert.match(r.findings[1].detail, /WEB CONVERSE pass up to MAXLENGTH\(LENGTH OF WS-BIG\), 5000 bytes/);
});

test('the client rules say what they rest on', () => {
  assert.equal(WEB_RULES['web-client-opens-cleartext'].cwe, 'CWE-319');
  assert.equal(WEB_RULES['web-receive-length-exceeds-area'].cwe, 'CWE-805');
  assert.match(WEB_RULES['web-client-opens-cleartext'].impact, /AT-TLS/);
});
