// The flow engine used to begin where a program begins. A JCL step begins one level above it: it
// chooses the program, hands it a parameter and fills the DD names it reads. These tests are about
// that join, which no single file states - the COBOL says ASSIGN TO SYSIN, the job says
// //SYSIN DD *, and neither names the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../lib/sets/flow.mjs';
import { analyze } from '../lib/dataflow.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-cross-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};

// A batch program receives PARM as a halfword length followed by the text, in the first item of
// PROCEDURE DIVISION USING.
const TAKES_PARM = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. RUNCMD.',
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01  WS-CMD            PIC X(100).',
  '       LINKAGE SECTION.',
  '       01  LK-PARM.',
  '           05  LK-LEN        PIC S9(4) COMP.',
  '           05  LK-TEXT       PIC X(98).',
  '       PROCEDURE DIVISION USING LK-PARM.',
  '           MOVE LK-TEXT TO WS-CMD',
  "           CALL 'SYSTEM' USING WS-CMD",
  '           GOBACK.',
  '',
].join('\n');

const READS_SYSIN = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. RDSYSIN.',
  '       ENVIRONMENT DIVISION.',
  '       INPUT-OUTPUT SECTION.',
  '       FILE-CONTROL.',
  '           SELECT CTL-FILE ASSIGN TO SYSIN.',
  '       DATA DIVISION.',
  '       FILE SECTION.',
  '       FD  CTL-FILE.',
  '       01  CTL-REC           PIC X(80).',
  '       WORKING-STORAGE SECTION.',
  '       01  WS-CMD            PIC X(100).',
  '       PROCEDURE DIVISION.',
  '           READ CTL-FILE',
  '           MOVE CTL-REC TO WS-CMD',
  "           CALL 'SYSTEM' USING WS-CMD",
  '           GOBACK.',
  '',
].join('\n');

const rules = (root) => scan(root).findings.map((f) => f.rule).sort();

test('a PARM on a step reaches the operating-system command the program runs', () => {
  const root = tree({
    'src/RUNCMD.cbl': TAKES_PARM,
    'jcl/RUN.jcl': ["//RUNJOB   JOB (ACCT)", "//STEP010  EXEC PGM=RUNCMD,PARM='SOMETHING'"].join('\n'),
  });
  assert.ok(rules(root).includes('jcl-parm-to-os-command'));
});

test('the same program with no job that runs it produces no crossing', () => {
  const root = tree({ 'src/RUNCMD.cbl': TAKES_PARM });
  assert.ok(!rules(root).includes('jcl-parm-to-os-command'),
    'a linkage item is only untrusted once something outside the program fills it');
});

test('a step that passes no PARM is not a source', () => {
  const root = tree({
    'src/RUNCMD.cbl': TAKES_PARM,
    'jcl/RUN.jcl': ['//RUNJOB   JOB (ACCT)', '//STEP010  EXEC PGM=RUNCMD'].join('\n'),
  });
  assert.ok(!rules(root).includes('jcl-parm-to-os-command'));
});

test('a PARM to a different program does not taint this one', () => {
  const root = tree({
    'src/RUNCMD.cbl': TAKES_PARM,
    'jcl/RUN.jcl': ["//RUNJOB   JOB (ACCT)", "//STEP010  EXEC PGM=OTHERPGM,PARM='X'"].join('\n'),
  });
  assert.ok(!rules(root).includes('jcl-parm-to-os-command'));
});

test('in-stream data reaches the record the program reads from that DD', () => {
  const root = tree({
    'src/RDSYSIN.cbl': READS_SYSIN,
    'jcl/RUN.jcl': ['//RUNJOB   JOB (ACCT)', '//STEP010  EXEC PGM=RDSYSIN', '//SYSIN    DD *', '  PAYLOAD', '/*'].join('\n'),
  });
  const r = rules(root);
  assert.ok(r.includes('jcl-instream-to-os-command'), 'the join is made across two files');
  // The record is still a file record. Both statements are true and the more specific one carries
  // the job's own location, so neither is suppressed.
  assert.ok(r.includes('file-record-to-os-command'));
});

test('a DD with no in-stream data makes no crossing, and the file record still stands', () => {
  const root = tree({
    'src/RDSYSIN.cbl': READS_SYSIN,
    'jcl/RUN.jcl': ['//RUNJOB   JOB (ACCT)', '//STEP010  EXEC PGM=RDSYSIN', '//SYSIN    DD DSN=PROD.CARDS,DISP=SHR'].join('\n'),
  });
  const r = rules(root);
  assert.ok(!r.includes('jcl-instream-to-os-command'), 'a catalogued dataset is not in the repository');
  assert.ok(r.includes('file-record-to-os-command'));
});

test('a DD name that no SELECT assigns to makes no crossing', () => {
  const root = tree({
    'src/RDSYSIN.cbl': READS_SYSIN,
    'jcl/RUN.jcl': ['//RUNJOB   JOB (ACCT)', '//STEP010  EXEC PGM=RDSYSIN', '//OTHERDD   DD *', '  PAYLOAD', '/*'].join('\n'),
  });
  assert.ok(!rules(root).includes('jcl-instream-to-os-command'));
});

test('the DD name is matched through a dialect prefix', () => {
  const withPrefix = READS_SYSIN.replace('ASSIGN TO SYSIN', 'ASSIGN TO "DD:SYSIN"');
  const root = tree({
    'src/RDSYSIN.cbl': withPrefix,
    'jcl/RUN.jcl': ['//RUNJOB   JOB (ACCT)', '//STEP010  EXEC PGM=RDSYSIN', '//SYSIN    DD *', '  PAYLOAD', '/*'].join('\n'),
  });
  assert.ok(rules(root).includes('jcl-instream-to-os-command'));
});

test('the trace names the job, so the path can be followed out of the COBOL', () => {
  const root = tree({
    'src/RUNCMD.cbl': TAKES_PARM,
    'jcl/RUN.jcl': ["//RUNJOB   JOB (ACCT)", "//STEP010  EXEC PGM=RUNCMD,PARM='SOMETHING'"].join('\n'),
  });
  const f = scan(root).findings.find((x) => x.rule === 'jcl-parm-to-os-command');
  assert.ok(f, 'the finding exists');
  assert.match(f.detail || '', /PARM=|STEP010|RUN\.jcl/i,
    'a reader who has only the finding can tell which step to look at');
});

test('the summary counts what crossed and what did not', () => {
  const root = tree({
    'src/RUNCMD.cbl': TAKES_PARM,
    'jcl/RUN.jcl': [
      '//RUNJOB   JOB (ACCT)',
      "//STEP010  EXEC PGM=RUNCMD,PARM='SOMETHING'",
      '//STEP020  EXEC PGM=IEFBR14',
    ].join('\n'),
  });
  const s = analyze(root).stats;
  assert.equal(s.jclFiles, 1);
  assert.equal(s.jclSteps, 2);
  assert.equal(s.jclStepsResolved, 1, 'IEFBR14 is a system utility, not a program in this tree');
  assert.ok(s.jclCrossings >= 1);
});
