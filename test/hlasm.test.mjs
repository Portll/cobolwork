import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHlasm, OPERATIONS } from '../lib/hlasm.mjs';
import { scanHlasm, HLASM_RULES } from '../lib/sets/hlasm.mjs';
import { scanJcl } from '../lib/sets/jcl.mjs';
import { isAssembler } from '../lib/sources.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-hlasm-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};

// Name in column 1, operation from column 10, operands from column 16, as assembler is written.
const card = (name, op, operands = '') => `${name.padEnd(8)} ${op.padEnd(5)} ${operands}`.trimEnd();
const asm = (...lines) => `${lines.join('\n')}\n`;

const STUB = asm(
  card('ASMSUB', 'CSECT'),
  card('', 'USING', 'ASMSUB,15'),
  card('', 'STM', '14,12,12(13)'),
  card('', 'MODESET', 'KEY=ZERO,MODE=SUP'),
  card('', 'EX', '1,MOVE'),
  card('', 'PC', '0(5)'),
  card('', 'RACROUTE', 'REQUEST=AUTH,ENTITY=PROF'),
  card('', 'MODESET', 'KEY=NZERO,MODE=PROB'),
  card('', 'LM', '14,12,12(13)'),
  card('', 'BR', '14'),
  card('MOVE', 'MVC', '0(0,2),0(3)'),
  card('', 'ENTRY', 'ASMENT'),
  card('', 'EXTRN', 'OTHER'),
  card('', 'END'),
);

const MACRO = asm(card('', 'MACRO'), card('&L', 'GOSUP'), card('&L', 'MODESET', 'MODE=SUP'), card('', 'MEND'));

const prog = (id, body) => [
  '       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`,
  '       PROCEDURE DIVISION.', body, '           GOBACK.', '',
].join('\n');

test('assembler source reads as statements, with its sections, entry points and external names', () => {
  const r = readHlasm(STUB);
  assert.equal(r.kind, 'hlasm');
  assert.deepEqual(r.defines.map((d) => [d.how, d.name, d.line]), [['CSECT', 'ASMSUB', 1], ['ENTRY', 'ASMENT', 12]]);
  assert.deepEqual(r.external.map((d) => d.name), ['OTHER']);
  assert.deepEqual(r.operations.map((o) => o.name), ['MODESET', 'EX', 'PC', 'RACROUTE', 'MODESET']);
  assert.deepEqual(r.operations.filter((o) => o.name === 'MODESET').map((o) => o.stateChange), ['KEY=ZERO', null]);
});

test('a BMS map, an IMS definition and x86 source in a .asm file are told apart from assembler', () => {
  assert.equal(readHlasm(asm(card('MAP1', 'DFHMSD', 'TYPE=MAP,LANG=COBOL'))).kind, 'bms');
  assert.equal(readHlasm(asm(card('', 'DBD', 'NAME=ACCT,ACCESS=HIDAM'), card('', 'SEGM', 'NAME=ROOT,BYTES=40'))).kind, 'ims');
  assert.equal(readHlasm('section .text\n    mov eax, 1\n    int 0x80\n').kind, 'unrecognised');
});

test('an operation in a macro definition is read as written, and its sections are not the file\'s', () => {
  const r = readHlasm(MACRO);
  assert.equal(r.kind, 'hlasm');
  assert.deepEqual(r.operations.map((o) => [o.name, o.inMacro, o.stateChange]), [['MODESET', true, 'MODE=SUP']]);
  assert.deepEqual(r.defines, []);
});

test('every operation in the table names the IBM document that defines it, in this project\'s own words', () => {
  const table = JSON.parse(readFileSync(new URL('../rules/hlasm-operations.json', import.meta.url), 'utf8'));
  assert.ok(table.retrieved, 'the table says when its sources were read');
  const classes = new Set(['supervisor-state-change', 'cross-memory', 'built-instruction', 'long-move', 'cross-key-move', 'supervisor-call', 'storage', 'module-load', 'security-product', 'section', 'linkage']);
  for (const o of table.operations) {
    assert.ok(classes.has(o.class), `${o.name} is one of the classes the set reads`);
    assert.ok(o.source && o.source.doc && o.source.topic, `${o.name} names its document and topic`);
    assert.match(o.source.url, /^https:\/\/www\.ibm\.com\/docs\//, `${o.name} links to IBM Docs`);
    assert.ok(o.summary && !/PROVISIONAL/.test(o.summary), `${o.name} says what it does`);
  }
  assert.equal(OPERATIONS.size, table.operations.length, 'no operation is listed twice');
  for (const n of ['MODESET', 'EX', 'EXRL', 'PC', 'PR', 'SSAR', 'LASP', 'RACROUTE', 'CSECT', 'ENTRY']) assert.ok(OPERATIONS.has(n), n);
});

test('each privileged operation is reported where it is written, and the return to problem state is not', () => {
  const root = tree({ 'asm/ASMSUB.asm': STUB, 'asm/GOSUP.mac': MACRO });
  const r = scanHlasm(root);
  const at = (rule) => r.findings.filter((f) => f.rule === rule).map((f) => `${f.path}:${f.line}`);
  assert.deepEqual(at('hlasm-supervisor-state-change').sort(), ['asm/ASMSUB.asm:4', 'asm/GOSUP.mac:3']);
  assert.deepEqual(at('hlasm-executes-built-instruction'), ['asm/ASMSUB.asm:5']);
  assert.deepEqual(at('hlasm-cross-memory-service'), ['asm/ASMSUB.asm:6']);
  assert.deepEqual(at('hlasm-calls-security-product'), ['asm/ASMSUB.asm:7']);
  assert.match(r.findings.find((f) => f.path === 'asm/GOSUP.mac').detail, /macro definition/);
  assert.match(r.findings.find((f) => f.rule === 'hlasm-calls-security-product').detail, /RACROUTE REQUEST=AUTH/);
  assert.equal(r.summary.assemblerFiles, 2);
});

test('maps, IMS definitions and other assemblers are counted and not read as HLASM', () => {
  const root = tree({
    'maps/MAP1.asm': asm(card('MAP1', 'DFHMSD', 'TYPE=MAP,LANG=COBOL')),
    'dbd/ACCT.asm': asm(card('', 'DBD', 'NAME=ACCT,ACCESS=HIDAM')),
    'x86/hello.asm': 'section .text\n    mov eax, 1\n',
  });
  const r = scanHlasm(root);
  assert.deepEqual([r.summary.bmsFiles, r.summary.imsFiles, r.summary.unrecognisedFiles, r.summary.assemblerFiles], [1, 1, 1, 0]);
  assert.deepEqual(r.findings, []);
});

test('a CSECT or ENTRY a COBOL program CALLs is the module that CALL reaches; a commented CALL is not', () => {
  const root = tree({
    'asm/ASMSUB.asm': STUB,
    'cbl/P.cbl': prog('P', "           CALL 'ASMSUB' USING X\n      *    CALL 'ASMENT'"),
    'cbl/Q.cbl': prog('Q', "           CALL 'ASMSUB'"),
  });
  const f = scanHlasm(root).findings.filter((x) => x.rule === 'hlasm-provides-called-module');
  assert.deepEqual(f.map((x) => `${x.path}:${x.line}`), ['asm/ASMSUB.asm:1']);
  assert.match(f[0].detail, /CSECT ASMSUB is the module CALL 'ASMSUB' reaches from cbl\/P\.cbl:4 and 1 other CALL$/);
});

test('a job step running an assembler module is resolved by the assembler source that defines it', () => {
  const root = tree({
    'asm/ASMSUB.asm': STUB,
    'jcl/RUN.jcl': '//RUN      JOB (ACCT)\n//S1       EXEC PGM=ASMSUB\n//S2       EXEC PGM=ASMENT\n//S3       EXEC PGM=NOWHERE\n',
  });
  const unresolved = scanJcl(root).findings.filter((f) => f.rule === 'jcl-exec-pgm-unresolved').map((f) => f.step);
  assert.deepEqual(unresolved, ['S3']);
});

test('an extensionless member is assembler only when it defines a section and declares storage', () => {
  const root = tree({ ASMMEM: STUB, NOTES: '    START the batch at nine\n' });
  assert.equal(isAssembler(join(root, 'ASMMEM')), true);
  assert.equal(isAssembler(join(root, 'NOTES')), false);
});

test('the defects are graded, and the inventory rules assert none', () => {
  for (const id of ['hlasm-calls-security-product', 'hlasm-provides-called-module']) assert.equal(HLASM_RULES[id].sev, 'info', id);
  for (const id of ['hlasm-supervisor-state-change', 'hlasm-executes-built-instruction', 'hlasm-cross-memory-service']) {
    assert.ok(HLASM_RULES[id].impact && HLASM_RULES[id].remedy, `${id} says what is at stake and what to do`);
  }
});
