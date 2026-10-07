// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the DL/I call interface: a get call fills its I/O area as a database value, and a PSB
// is held to the options its program's own calls use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAll } from '../lib/scan.mjs';
import './pin-machine.mjs';

const program = (body, ws = []) => [
  '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. ACCTRPT.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  "       01 GU-FUNC   PIC X(4) VALUE 'GU  '.", '       01 IO-AREA   PIC X(80).', ...ws,
  '       LINKAGE SECTION.', '       01 DB-PCB    PIC X(40).', '       PROCEDURE DIVISION USING DB-PCB.',
  ...body.map((l) => `           ${l}`), '           GOBACK.', '',
].join('\n');
const psb = (procopt, name = 'ACCTRPT') => [
  `         PCB   TYPE=DB,DBDNAME=ACCTDB,PROCOPT=${procopt},KEYLEN=8`, '         SENSEG NAME=ACCOUNT', `         PSBGEN PSBNAME=${name},LANG=COBOL`, '         END', '',
].join('\n');

function scan(files, only) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-dli-'));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return scanAll(dir, { only }).findings;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const rulesOf = (findings) => findings.map((f) => f.rule).sort();

test('a get call fills its I/O area with what the database held, by literal, by field or by EXEC DLI', () => {
  const cmd = "CALL 'SYSTEM' USING IO-AREA";
  for (const call of ["CALL 'CBLTDLI' USING 'GU  ' DB-PCB IO-AREA", "CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA",
    ['EXEC DLI GU USING PCB(1) SEGMENT(ACCOUNT)', '    INTO(IO-AREA) END-EXEC']]) {
    assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program([call, cmd].flat()) }, ['flow'])), ['database-to-os-command'], String(call));
  }
});

test('an ISRT writes its I/O area and does not fill it', () => {
  const body = ["CALL 'CBLTDLI' USING 'ISRT' DB-PCB IO-AREA", "CALL 'SYSTEM' USING IO-AREA"];
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(body) }, ['flow'])), []);
});

test('a PSB granting options no call of its program uses is ims-procopt-broader-than-used, naming them', () => {
  const body = ["CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA"];
  const found = scan({ 'ACCTRPT.cbl': program(body), 'ACCTRPT.psb': psb('A') }, ['ims']).filter((f) => f.rule === 'ims-procopt-broader-than-used');
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /PROCOPT=A grants insert, replace, delete, which no DL\/I call of ACCTRPT/);
  assert.match(found[0].detail, /it issues GU$/);
});

test('an option one of the calls uses is not reported, and replace and delete imply get', () => {
  const body = ["CALL 'CBLTDLI' USING 'GHU ' DB-PCB IO-AREA", "CALL 'CBLTDLI' USING 'REPL' DB-PCB IO-AREA"];
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(body), 'ACCTRPT.psb': psb('GR') }, ['ims'])), []);
  const fewer = scan({ 'ACCTRPT.cbl': program(body), 'ACCTRPT.psb': psb('GRD') }, ['ims']);
  assert.deepEqual(rulesOf(fewer), ['ims-procopt-broader-than-used']);
  assert.match(fewer[0].detail, /grants delete,/);
});

test('nothing is reported when the program cannot be read whole: an undecided function code, or a CALL that passes on its PCB', () => {
  const undecided = ["ACCEPT GU-FUNC", "CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA"];
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(undecided), 'ACCTRPT.psb': psb('A') }, ['ims'])), ['ims-pcb-procopt-all']);
  const passesOn = ["CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA", "CALL 'ACCTUPD' USING DB-PCB IO-AREA"];
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(passesOn), 'ACCTRPT.psb': psb('A') }, ['ims'])), ['ims-pcb-procopt-all']);
});

test('a PSB is named for its program by PSBGEN PSBNAME, or else by its file name', () => {
  const body = ["CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA"];
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(body), 'OTHER.psb': psb('GR', 'ACCTRPT') }, ['ims'])), ['ims-procopt-broader-than-used']);
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(body), 'ACCTRPT.psb': psb('GR', 'PSBX') }, ['ims'])), ['ims-procopt-broader-than-used']);
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(body), 'PSBX.psb': psb('GR', 'PSBX') }, ['ims'])), []);
});

test("a DFSRRC00 step or the program's own SCHD names the PSB it runs with", () => {
  const body = ["CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA"];
  const jcl = ['//NIGHTLY  JOB (1),CLASS=A', "//STEP1    EXEC PGM=DFSRRC00,PARM='DLI,ACCTRPT,PSBRPT'", ''].join('\n');
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(body), 'PSBRPT.psb': psb('GR', 'PSBRPT'), 'NIGHTLY.jcl': jcl }, ['ims'])), ['ims-procopt-broader-than-used']);
  const scheduled = ["EXEC DLI SCHD PSB('PSBRPT') END-EXEC", ...body];
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(scheduled), 'PSBRPT.psb': psb('GR', 'PSBRPT') }, ['ims'])), ['ims-procopt-broader-than-used']);
});

test('a PSB two programs run with is held to the calls of both', () => {
  const writer = program(["CALL 'CBLTDLI' USING 'REPL' DB-PCB IO-AREA"]).replace('PROGRAM-ID. ACCTRPT.', 'PROGRAM-ID. ACCTUPD.');
  const jcl = ['//NIGHTLY  JOB (1),CLASS=A', "//STEP1    EXEC PGM=DFSRRC00,PARM='DLI,ACCTRPT,PSBACCT'",
    "//STEP2    EXEC PGM=DFSRRC00,PARM='DLI,ACCTUPD,PSBACCT'", ''].join('\n');
  const files = { 'ACCTRPT.cbl': program(["CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA"]), 'ACCTUPD.cbl': writer, 'PSBACCT.psb': psb('GR', 'PSBACCT'), 'NIGHTLY.jcl': jcl };
  assert.deepEqual(rulesOf(scan(files, ['ims'])), []);
});

test('a CALL that passes no PCB and no LINKAGE item leaves the calls readable', () => {
  const body = ["CALL 'CBLTDLI' USING GU-FUNC DB-PCB IO-AREA", "CALL 'MQPUT' USING IO-AREA"];
  assert.deepEqual(rulesOf(scan({ 'ACCTRPT.cbl': program(body), 'ACCTRPT.psb': psb('GR') }, ['ims'])), ['ims-procopt-broader-than-used']);
});
