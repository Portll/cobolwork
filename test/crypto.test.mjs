// What a program asks ICSF for, judged from the literals that can reach each argument: the key
// length it generates, the hash it names, the initialization vector it passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanCrypto, CRYPTO_RULES } from '../lib/sets/crypto.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-crypto-'));
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
  '       01  RC          PIC 9(8) COMP.', '       01  RS          PIC 9(8) COMP.',
  '       01  EXL         PIC 9(8) COMP VALUE 0.', '       01  EXD         PIC X(4).',
  ...data.map((d) => `       ${d}`),
  '       PROCEDURE DIVISION.',
  ...body.map((b) => `           ${b}`),
  '           GOBACK.', '',
].join('\n');

const call = (name, ...args) => [`CALL '${name}' USING RC RS EXL EXD`, ...args.map((a) => `    ${a}`), '    .'];
const kgn = (length, type = 'DATA') => prog('KGN', [
  "01  KEY-FORM    PIC X(8) VALUE 'OP'.", `01  KEY-LENGTH  PIC X(8) VALUE '${length}'.`, `01  KEY-TYPE-1  PIC X(8) VALUE '${type}'.`,
  '01  KEY-TYPE-2  PIC X(8) VALUE SPACES.', '01  KEK1        PIC X(64).', '01  KEK2        PIC X(64).', '01  KEY-ID      PIC X(64).', '01  KEY-ID2     PIC X(64).',
  '01  KL-S        PIC X(8).',
], ['MOVE KEY-LENGTH TO KL-S', ...call('CSNBKGN', 'KEY-FORM KL-S KEY-TYPE-1 KEY-TYPE-2', 'KEK1 KEK2 KEY-ID KEY-ID2')]);

test('a single-length DES key is reported where it is generated, and an AES key is not', () => {
  const root = tree({ 'SINGLE.cbl': kgn('SINGLE'), 'KEYLN8.cbl': kgn('KEYLN8'), 'AES.cbl': kgn('KEYLN32', 'AESDATA') });
  const r = scanCrypto(root);
  assert.deepEqual(r.findings.map((f) => [f.rule, f.path]), [['icsf-single-length-des-key', 'KEYLN8.cbl'], ['icsf-single-length-des-key', 'SINGLE.cbl']]);
  assert.match(r.findings[1].detail, /CALL 'CSNBKGN' passes KL-S as key_length, and KL-S can hold SINGLE/);
  assert.equal(r.summary.icsfCalls, 3);
});

const owh = (setup) => prog('OWH', ['01  ALGO        PIC X(8).', "01  HASH-MODE   PIC X(8) VALUE 'ONLY'.", '01  RULES       PIC X(16).', '01  RCNT        PIC 9(8) COMP VALUE 2.',
  '01  TLEN        PIC 9(8) COMP.', '01  TXT         PIC X(100).', '01  CVL         PIC 9(8) COMP.', '01  CV          PIC X(128).', '01  HLEN        PIC 9(8) COMP.', '01  HASH        PIC X(64).'],
[...setup, 'STRING ALGO HASH-MODE INTO RULES', ...call('CSFOWH', 'RCNT RULES TLEN TXT CVL CV HLEN HASH')]);

test('a hash the rule array names as MD5 or SHA-1 is weak, through STRING and under the CSF name', () => {
  const root = tree({
    'MD5.cbl': owh(["MOVE 'MD5' TO ALGO"]),
    'SHA256.cbl': owh(["MOVE 'SHA-256' TO ALGO"]),
    'ASKED.cbl': owh(['ACCEPT ALGO']),
  });
  const r = scanCrypto(root);
  assert.deepEqual(r.findings.map((f) => [f.rule, f.path]), [['icsf-weak-hash', 'MD5.cbl']]);
  assert.match(r.findings[0].detail, /RULES as rule_array, and RULES can hold MD5/);
  assert.equal(r.summary.argumentsUndecided, 1, 'an algorithm the program reads in is counted as undecided');
});

const enc = (rules, ivSetup) => prog('ENC', ['01  ICV         PIC X(8) VALUE LOW-VALUES.', `01  RULES       PIC X(16) VALUE '${rules}'.`, '01  RCNT        PIC 9(8) COMP VALUE 1.',
  '01  KEY-ID      PIC X(64).', '01  TLEN        PIC 9(8) COMP.', '01  TXT         PIC X(100).', '01  PAD         PIC X.', '01  CV          PIC X(18).', '01  OUT         PIC X(100).'],
[...ivSetup, ...call('CSNBENC', 'KEY-ID TLEN TXT ICV RCNT RULES PAD CV OUT')]);

test('a vector nothing but a constant is put in is fixed; one generated per call, or not used, is not', () => {
  const root = tree({
    'FIXED.cbl': enc('CUSP', []),
    'RANDOM.cbl': enc('CBC', ["CALL 'CSNBRNG' USING RC RS EXL EXD RCNT ICV"]),
    'CHAINED.cbl': enc('CBC     CONTINUE', []),
  });
  const r = scanCrypto(root);
  assert.deepEqual(r.findings.map((f) => [f.rule, f.path]), [['icsf-fixed-initialization-vector', 'FIXED.cbl']]);
  assert.match(r.findings[0].detail, /passes ICV as its initialization vector, and nothing but LOW-VALUES is ever put in it/);
});

test('every finding names its basis, and the table cites IBM for every service', () => {
  const table = JSON.parse(readFileSync(new URL('../rules/icsf-services.json', import.meta.url), 'utf8'));
  assert.ok(table.retrieved && table.document.number);
  for (const s of table.services) assert.match(s.url, /^https:\/\/www\.ibm\.com\/docs\//, s.name);
  for (const [key, f] of Object.entries(table.findings)) {
    assert.ok(f.basis && f.sources.length, `${key} says why`);
    for (const s of f.services) assert.ok(table.services.some((x) => x.name === s), `${key} names a service in the table`);
  }
  assert.equal(CRYPTO_RULES['icsf-single-length-des-key'].cwe, 'CWE-327');
  assert.equal(CRYPTO_RULES['icsf-weak-hash'].cwe, 'CWE-328');
  assert.equal(CRYPTO_RULES['icsf-fixed-initialization-vector'].cwe, 'CWE-1204');
});
