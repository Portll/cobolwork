// What ironwork check says about each program, read into the advice document as compile items by
// message id, with the dialect census from a second pass under --compliance extended.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';
import { compilerAdvice } from '../lib/advice-compiler.mjs';
import { advise } from '../lib/advice.mjs';
import { schemaProblems } from './schema-check.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = join(HERE, '..', 'schema');
const load = (file) => JSON.parse(readFileSync(join(SCHEMAS, file), 'utf8'));
const schema = load('cobolwork-advice.schema.json');
const CATALOGUE = JSON.parse(readFileSync(join(HERE, '..', 'rules', 'ironwork-messages.json'), 'utf8'));

function findIronwork() {
  const named = process.env.COBOLWORK_IRONWORK;
  if (named) return existsSync(named) ? named : null;
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    if (dir && isAbsolute(dir) && existsSync(join(dir, 'ironwork'))) return join(dir, 'ironwork');
  }
  return null;
}
const IRONWORK = findIronwork();
const real = { skip: !IRONWORK && 'no ironwork binary: set COBOLWORK_IRONWORK or put ironwork on PATH' };
const posix = { skip: process.platform === 'win32' && 'the stand-in ironwork is a shell script' };

const program = (id, body, ws = []) => [
  '       IDENTIFICATION DIVISION.',
  `       PROGRAM-ID. ${id}.`,
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01 WS-A                PIC 9 VALUE 1.',
  ...ws,
  '       PROCEDURE DIVISION.',
  ...body.map((l) => `           ${l}`),
].join('\n') + '\n';
const FIXTURES = {
  'CLEAN.cbl': program('CLEAN', ["DISPLAY 'CLEAN'", 'GOBACK.']),
  'NOSTOP.cbl': program('NOSTOP', ["DISPLAY 'HELLO'."]),
  'MF.cbl': program('MF', ['IF WS-A <> 2', "   DISPLAY 'NE'", 'END-IF', 'GOBACK.']),
};
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-advice-iw-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

test('the message catalogue lists every id once and gives every W, E and X message a remedy', () => {
  const ids = CATALOGUE.messages.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 863, `${ids.length} ids`);
  for (const m of CATALOGUE.messages) {
    assert.match(m.id, /^IW[A-Z]\d{4}$/);
    assert.equal(m.area, m.id[2]);
    if (m.area === 'X' || m.severity === 'W' || m.severity === 'E') assert.equal(typeof CATALOGUE.remedies[m.id], 'string', m.id);
  }
  assert.ok(CATALOGUE.source.commit && CATALOGUE.source.retrieved && CATALOGUE.source.path === 'docs/messages.md');
});

// A stand-in that answers as ironwork 0.9.0 did for each fixture, under strict and extended, with
// --diagnostics json.
function stub(dir) {
  const path = join(dir, 'ironwork-stub');
  const say = (id, severity, line, col, message) => `printf '{"col":${col},"file":"%s","id":"${id}","line":${line},"member":null,"message":"${message}","severity":"${severity}"}\\n' "$file" >&2`;
  writeFileSync(path, [
    '#!/bin/sh',
    'if [ "$1" = --version ]; then echo "ironwork for COBOL 9.9.9"; exit 0; fi',
    'file="$2"; ext=no',
    'for a in "$@"; do [ "$a" = extended ] && ext=yes; done',
    'case "$file" in',
    `  */NOSTOP.cbl) ${say('IWC0055', 'W', 'null', 'null', 'no STOP RUN, GOBACK or EXIT PROGRAM in the program: check that it ends')}; exit 4;;`,
    `  */MF.cbl) if [ $ext = yes ]; then ${say('IWX0003', 'W', 7, 20, '<> (Micro Focus and GnuCOBOL; Enterprise COBOL writes NOT =) is read as NOT =')}; exit 4; fi`,
    `    ${say('IWS0065', 'S', 7, 20, '<> is not an Enterprise COBOL relational operator: it writes NOT =')}; exit 12;;`,
    `  */R1.cbl|*/R2.cbl) ${say('IWR0064', 'S', 9, 12, 'FUNCTION FOO is not supported yet')}; exit 12;;`,
    `  */Q1.cbl) ${say('IWQ0001', 'S', 9, 12, 'a message of an area this cobolwork does not read')}; ${say('IWQ0002', 'W', 8, 12, 'a warning of that area')}; exit 12;;`,
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(path, 0o755);
  return path;
}

test('a stand-in ironwork: items by id, R refusals counted once, the census from the extended pass', posix, () => {
  const root = tree({ ...FIXTURES, 'R1.cbl': program('R1', ['GOBACK.']), 'R2.cbl': program('R2', ['GOBACK.']) });
  const bin = mkdtempSync(join(tmpdir(), 'cw-advice-stub-'));
  try {
    const r = compilerAdvice(root, { ironwork: stub(bin) });
    assert.deepEqual(r.estate.compiler, { tool: 'ironwork', version: '9.9.9' });
    assert.deepEqual(r.estate.programs, { count: 5, compiled: 2, failed: 1, notModelled: 2, unresolved: 0, unread: 0, unrun: 0 });
    assert.deepEqual(r.estate.dialect, { ibmStrict: 2, extendedOnly: 1, extensions: { IWX0003: 1 } });
    assert.deepEqual(r.items.map((i) => [i.ref, i.sev, i.where.path, i.where.line, i.where.program]), [
      ['IWX0003', 'info', 'MF.cbl', 7, 'MF'],
      ['IWC0055', 'low', 'NOSTOP.cbl', null, 'NOSTOP'],
    ]);
    assert.ok(!r.items.some((i) => i.ref.startsWith('IWR') || i.ref === 'IWS0065'));
    const refusals = r.unmeasured.filter((u) => /IWR0064/.test(u));
    assert.equal(refusals.length, 1, r.unmeasured.join(' | '));
    assert.match(refusals[0], /2 program\(s\) use what ironwork does not model yet/);
    assert.deepEqual(r.catalogue.map((c) => c.id), ['IWC0055', 'IWX0003']);
    assert.equal(r.catalogue[1].remedy, CATALOGUE.remedies.IWX0003);
    const again = compilerAdvice(root, { ironwork: stub(bin) });
    assert.deepEqual(again.items.map((i) => i.id), r.items.map((i) => i.id));

    const capped = compilerAdvice(root, { ironwork: stub(bin), maxPrograms: 2 });
    assert.equal(capped.estate.programs.unrun, 3);
    assert.ok(capped.unmeasured.some((u) => /first 2 of 5 programs/.test(u)), capped.unmeasured.join(' | '));
    const spent = compilerAdvice(root, { ironwork: stub(bin), budgetMs: -1 });
    assert.equal(spent.estate.programs.unrun, 5);
    assert.ok(spent.unmeasured.some((u) => /budget ran out/.test(u)), spent.unmeasured.join(' | '));

    const doc = advise(root, { ironwork: stub(bin) });
    assert.deepEqual(schemaProblems(doc, schema, schema, '$', load), []);
    assert.ok(doc.items.some((i) => i.kind === 'compile' && i.ref === 'IWC0055'));
    assert.deepEqual(doc.catalogue.compiler.map((c) => c.id), ['IWC0055', 'IWX0003']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('a stand-in ironwork: an id of an area cobolwork does not read is no item, and its program is not decided', posix, () => {
  const root = tree({ 'CLEAN.cbl': FIXTURES['CLEAN.cbl'], 'Q1.cbl': program('Q1', ['GOBACK.']) });
  const bin = mkdtempSync(join(tmpdir(), 'cw-advice-stub-'));
  try {
    const r = compilerAdvice(root, { ironwork: stub(bin) });
    assert.deepEqual(r.estate.programs, { count: 2, compiled: 1, failed: 0, notModelled: 0, unresolved: 0, unread: 1, unrun: 0 });
    assert.deepEqual(r.items, []);
    assert.ok(r.unmeasured.includes('ironwork check: 1 program(s) stop at a message whose id this cobolwork does not read, so whether they compile is not decided'), r.unmeasured.join(' | '));
    assert.ok(r.unmeasured.includes('ironwork check gave message ids this cobolwork does not read (IWQ0001, IWQ0002), which are not items'), r.unmeasured.join(' | '));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  }
});

test('ironwork: a program with no STOP RUN is a low compile item IWC0055 with its remedy', real, () => {
  const root = tree(FIXTURES);
  try {
    const r = compilerAdvice(root, { ironwork: IRONWORK });
    const item = r.items.find((i) => i.ref === 'IWC0055');
    assert.ok(item, JSON.stringify(r.items));
    assert.equal(item.kind, 'compile');
    assert.equal(item.source, 'ironwork');
    assert.equal(item.sev, 'low');
    assert.equal(item.where.path, 'NOSTOP.cbl');
    assert.equal(item.where.program, 'NOSTOP');
    assert.equal(item.remediation.text, CATALOGUE.remedies.IWC0055);
    assert.match(item.id, /^compile:IWC0055:[0-9a-f]{16}$/);
    assert.match(r.estate.compiler.version, /^\d+\.\d+\.\d+/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ironwork: a program using <> is an IWX item and compiles only under --compliance extended', real, () => {
  const root = tree(FIXTURES);
  try {
    const r = compilerAdvice(root, { ironwork: IRONWORK });
    const item = r.items.find((i) => i.ref === 'IWX0003');
    assert.ok(item, JSON.stringify(r.items));
    assert.equal(item.sev, 'info');
    assert.equal(item.where.path, 'MF.cbl');
    assert.equal(item.where.line, 7);
    assert.equal(r.estate.dialect.extendedOnly, 1);
    assert.equal(r.estate.dialect.ibmStrict, 2);
    assert.equal(r.estate.dialect.extensions.IWX0003, 1);
    assert.deepEqual(r.estate.programs, { count: 3, compiled: 2, failed: 1, notModelled: 0, unresolved: 0, unread: 0, unrun: 0 });
    const doc = advise(root, { ironwork: IRONWORK });
    assert.deepEqual(schemaProblems(doc, schema, schema, '$', load), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
