import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJcl } from '../lib/jcl.mjs';
import { UTILITIES } from '../lib/utilities.mjs';
import './pin-machine.mjs';

const parse = (lines) => parseJcl(lines.join('\n') + '\n', 'job.jcl');
const pairs = (r) => r.copies.map((c) => `${c.step}: ${c.from.dd || '-'}=${c.from.dsn} > ${c.to.dd || '-'}=${c.to.dsn}`);

test('IEBGENER and ICEGENER copy every dataset concatenated on SYSUT1 to SYSUT2', () => {
  for (const pgm of ['IEBGENER', 'ICEGENER']) {
    const r = parse([
      '//J JOB (X)',
      `//COPY EXEC PGM=${pgm}`,
      '//SYSPRINT DD SYSOUT=*',
      '//SYSIN DD DUMMY',
      '//SYSUT1 DD DSN=PAY.JAN,DISP=SHR',
      '//       DD DSN=PAY.FEB,DISP=SHR',
      '//SYSUT2 DD DSN=PAY.QUARTER,DISP=(NEW,CATLG,DELETE)',
    ]);
    assert.deepEqual(pairs(r), ['COPY: SYSUT1=PAY.JAN > SYSUT2=PAY.QUARTER', 'COPY: SYSUT1=PAY.FEB > SYSUT2=PAY.QUARTER'], pgm);
    assert.equal(r.copies[0].utility, pgm);
    assert.equal(r.copies[0].line, 2, 'the copy is the step, so it is placed on the EXEC');
  }
});

test('in-stream data copied to a dataset says it came from the job', () => {
  const r = parse(['//J JOB (X)', '//S1 EXEC PGM=IEBGENER', '//SYSUT1 DD *', 'ANY DATA', '/*', '//SYSUT2 DD DSN=PAY.CARDS,DISP=OLD']);
  assert.deepEqual(r.copies[0].from, { dd: 'SYSUT1', dsn: null, inStream: true });
});

test('SORT reads SORTIN and writes SORTOUT and every data set its OUTFIL statements name', () => {
  const r = parse([
    '//J JOB (X)',
    '//SPLIT EXEC PGM=SORT',
    '//SORTIN DD DSN=PAY.TRANS,DISP=SHR',
    '//SORTOUT DD DSN=PAY.SORTED,DISP=(NEW,CATLG)',
    '//EAST DD DSN=PAY.EAST,DISP=(NEW,CATLG)',
    '//WEST DD DSN=PAY.WEST,DISP=(NEW,CATLG)',
    '//SORTOF1 DD DSN=PAY.REJECTS,DISP=(NEW,CATLG)',
    '//SYSIN DD *',
    '* SPLIT BY REGION',
    '  SORT FIELDS=(1,10,CH,A)',
    "  OUTFIL FNAMES=(EAST,        A REMARK DOES NOT STOP THE CONTINUATION",
    "                 WEST),INCLUDE=(11,1,CH,EQ,C'E')",
    '  OUTFIL FILES=1,SAVE    EVERYTHING ELSE',
    '  OUTFIL OUTREC=(1,80)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), [
    'SPLIT: SORTIN=PAY.TRANS > SORTOUT=PAY.SORTED',
    'SPLIT: SORTIN=PAY.TRANS > EAST=PAY.EAST',
    'SPLIT: SORTIN=PAY.TRANS > WEST=PAY.WEST',
    'SPLIT: SORTIN=PAY.TRANS > SORTOF1=PAY.REJECTS',
    'SPLIT: SORTIN=PAY.TRANS > SORTOUT=PAY.SORTED',
  ], 'an OUTFIL naming no data set writes SORTOUT');
  assert.equal(r.copies[1].line, 11, 'a continued OUTFIL is placed on its first line');
});

test('a merge reads SORTINnn and a sort reads SORTIN, under any of the names SORT runs as', () => {
  const job = (pgm, statement) => parse([
    '//J JOB (X)', `//M EXEC PGM=${pgm}`,
    '//SORTIN DD DSN=PAY.ALL,DISP=SHR',
    '//SORTIN01 DD DSN=PAY.A,DISP=SHR', '//SORTIN02 DD DSN=PAY.B,DISP=SHR',
    '//SORTOUT DD DSN=PAY.AB,DISP=(NEW,CATLG)',
    '//SYSIN DD *', `  ${statement}`, '/*',
  ]);
  for (const pgm of ['ICEMAN', 'DFSORT', 'SYNCSORT']) {
    assert.deepEqual(pairs(job(pgm, 'MERGE FIELDS=(1,10,CH,A)')),
      ['M: SORTIN01=PAY.A > SORTOUT=PAY.AB', 'M: SORTIN02=PAY.B > SORTOUT=PAY.AB'], pgm);
    assert.deepEqual(pairs(job(pgm, 'SORT FIELDS=(1,10,CH,A)')), ['M: SORTIN=PAY.ALL > SORTOUT=PAY.AB'], pgm);
  }
});

test('control statements kept in a library are named as unread, not taken as none', () => {
  const r = parse([
    '//J JOB (X)', '//S EXEC PGM=SORT',
    '//SORTIN DD DSN=PAY.TRANS,DISP=SHR', '//SORTOUT DD DSN=PAY.SORTED,DISP=(NEW,CATLG)',
    '//SYSIN DD DSN=PAY.CTLCARDS(SPLIT),DISP=SHR',
  ]);
  assert.deepEqual(pairs(r), ['S: SORTIN=PAY.TRANS > SORTOUT=PAY.SORTED']);
  const note = r.diags.find((d) => /PAY\.CTLCARDS\(SPLIT\)/.test(d.text));
  assert.equal(note.sev, 'info');
  assert.match(note.text, /whether it merges and which OUTFIL data sets it writes are not known/);
});

test('IDCAMS REPRO copies between DDs or between the datasets it names, in any spelling', () => {
  const r = parse([
    '//J JOB (X)', '//LOAD EXEC PGM=IDCAMS',
    '//SYSPRINT DD SYSOUT=*',
    '//IN DD DSN=PAY.SEQ,DISP=SHR',
    '//OUT DD DSN=PAY.KSDS,DISP=OLD',
    '//SYSIN DD *',
    '  /* LOAD THE CLUSTER */',
    '  REPRO INFILE(IN) OUTFILE(OUT)',
    '  REPRO IFILE(IN) OFILE(OUT)',
    '  REPRO -',
    '    INDATASET(PAY.KSDS) -',
    '    OUTDATASET(PAY.BACKUP)',
    '  REPRO INFILE(IN) OUTDATASET(PAY.COPY) REPLACE',
    '  LISTCAT ENTRIES(PAY.KSDS)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), [
    'LOAD: IN=PAY.SEQ > OUT=PAY.KSDS',
    'LOAD: IN=PAY.SEQ > OUT=PAY.KSDS',
    'LOAD: -=PAY.KSDS > -=PAY.BACKUP',
    'LOAD: IN=PAY.SEQ > -=PAY.COPY',
  ]);
  assert.deepEqual(r.copies.map((c) => c.line), [8, 9, 10, 13], 'a continued command is placed on its first line');
});

test('IEBCOPY copies each INDD to the OUTDD, with or without replace', () => {
  const r = parse([
    '//J JOB (X)', '//LIB EXEC PGM=IEBCOPY',
    '//OLDLIB DD DSN=PAY.OLD.LOAD,DISP=SHR',
    '//FIXES DD DSN=PAY.FIX.LOAD,DISP=SHR',
    '//NEWLIB DD DSN=PAY.NEW.LOAD,DISP=OLD',
    '//SYSIN DD *',
    '  COPY OUTDD=NEWLIB,',
    '       INDD=((FIXES,R),OLDLIB)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), ['LIB: FIXES=PAY.FIX.LOAD > NEWLIB=PAY.NEW.LOAD', 'LIB: OLDLIB=PAY.OLD.LOAD > NEWLIB=PAY.NEW.LOAD']);
  assert.equal(r.copies[0].line, 7);
});

// IBM's own COPYGRP example carries a label, and an INDD= record of its own continues the COPY above.
test('an IEBCOPY statement may carry a label, and an INDD record adds a step to the copy before it', () => {
  const r = parse([
    '//J JOB (X)', '//LIB EXEC PGM=IEBCOPY',
    '//DDIN DD DSN=PAY.PDSE.A,DISP=SHR',
    '//DDOUT DD DSN=PAY.PDSE.B,DISP=OLD',
    '//FIXES DD DSN=PAY.FIX.LOAD,DISP=SHR',
    '//OLDLIB DD DSN=PAY.OLD.LOAD,DISP=SHR',
    '//NEWLIB DD DSN=PAY.NEW.LOAD,DISP=OLD',
    '//SYSIN DD *',
    'GROUPCPY   COPYGRP  INDD=((DDIN,R)),OUTDD=DDOUT',
    '  COPY OUTDD=NEWLIB,INDD=FIXES',
    '  SELECT MEMBER=PAYCALC',
    '  INDD=OLDLIB',
    '/*',
  ]);
  assert.deepEqual(pairs(r), [
    'LIB: DDIN=PAY.PDSE.A > DDOUT=PAY.PDSE.B',
    'LIB: FIXES=PAY.FIX.LOAD > NEWLIB=PAY.NEW.LOAD',
    'LIB: OLDLIB=PAY.OLD.LOAD > NEWLIB=PAY.NEW.LOAD',
  ]);
  assert.deepEqual(r.copies.map((c) => c.line), [9, 10, 12]);
});

test('ADRDSSU DUMP and RESTORE copy from INDDNAME to each OUTDDNAME', () => {
  const r = parse([
    '//J JOB (X)', '//BACKUP EXEC PGM=ADRDSSU',
    '//DASD DD UNIT=3390,VOL=SER=PAY001,DISP=OLD',
    '//TAPE1 DD DSN=PAY.DUMP1,DISP=(NEW,CATLG)',
    '//TAPE2 DD DSN=PAY.DUMP2,DISP=(NEW,CATLG)',
    '//SYSIN DD *',
    '  DUMP FULL INDDNAME(DASD) -',
    '       OUTDDNAME(TAPE1,TAPE2)',
    '/*',
    '//BACK EXEC PGM=ADRDSSU',
    '//TAPE DD DSN=PAY.DUMP1,DISP=OLD',
    '//DASD DD UNIT=3390,VOL=SER=PAY002,DISP=OLD',
    '//SYSIN DD *',
    '  RESTORE INDDNAME(TAPE) OUTDDNAME(DASD) DATASET(INCLUDE(PAY.**))',
    '  DUMP DATASET(INCLUDE(PAY.**)) OUTDDNAME(TAPE)',
    '  RESTORE IDD(TAPE) DATASET(INCLUDE(PAY.OLD)) RENAME(*.OLD,*.NEW)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), [
    'BACKUP: DASD=null > TAPE1=PAY.DUMP1',
    'BACKUP: DASD=null > TAPE2=PAY.DUMP2',
    'BACK: TAPE=PAY.DUMP1 > DASD=null',
  ]);
  const notes = r.diags.filter((d) => d.sev === 'info');
  assert.ok(notes.some((d) => d.line === 15 && /chosen by filter/.test(d.text)),
    'a logical dump by filter is named as not knowing what it copies');
  assert.ok(notes.some((d) => d.line === 16 && /where the catalogue puts them/.test(d.text)),
    'and so is a logical restore with no output volume');
});

test('a program the table does not know copies nothing here, and nothing is invented for it', () => {
  const r = parse(['//J JOB (X)', '//S EXEC PGM=PAYCALC', '//SYSUT1 DD DSN=PAY.IN,DISP=SHR', '//SYSUT2 DD DSN=PAY.OUT,DISP=OLD']);
  assert.deepEqual(r.copies, []);
  assert.ok(!UTILITIES.includes('PAYCALC'));
});

// The reason the table exists: "step two read what step one wrote" now says who did the writing.
test('a dataset flow says which program wrote the dataset and what it copied in', () => {
  const r = parse([
    '//J JOB (X)',
    '//S1 EXEC PGM=IEBGENER',
    '//SYSIN DD DUMMY',
    '//SYSUT1 DD DSN=PROD.TRANS,DISP=SHR',
    '//SYSUT2 DD DSN=&&WORK,DISP=(NEW,PASS)',
    '//S2 EXEC PGM=PAYCALC',
    '//IN DD DSN=&&WORK,DISP=(OLD,DELETE)',
    '//OUT DD DSN=PAY.RESULT,DISP=SHR',
    '//S3 EXEC PGM=IEBGENER',
    '//SYSIN DD DUMMY',
    '//SYSUT1 DD DSN=PAY.RESULT,DISP=SHR',
    '//SYSUT2 DD SYSOUT=*',
  ]);
  const work = r.datasetFlow.find((f) => f.dsn === '&&WORK');
  assert.deepEqual(work.writers, [{ step: 'S1', program: 'IEBGENER', dd: 'SYSUT2', line: 5, copiedFrom: [{ dd: 'SYSUT1', dsn: 'PROD.TRANS' }] }]);
  assert.deepEqual(work.undetermined, ['S2'], 'PAYCALC is not in the table, so DISP=OLD still decides nothing');

  const result = r.datasetFlow.find((f) => f.dsn === 'PAY.RESULT');
  assert.deepEqual(result.readBy, ['S2', 'S3'], 'what the table does not know, the disposition still says');
  assert.deepEqual(result.writers, []);
});

test('a utility writing a DD it opened SHR or OLD is a writer, whatever the disposition says', () => {
  const r = parse([
    '//J JOB (X)',
    '//S1 EXEC PGM=IEBGENER',
    '//SYSUT1 DD DSN=PAY.CARDS,DISP=OLD',
    '//SYSUT2 DD DSN=PAY.LIB(MEMBER),DISP=SHR',
    '//S2 EXEC PGM=IEBGENER',
    '//SYSUT1 DD DSN=PAY.LIB(MEMBER),DISP=SHR',
    '//SYSUT2 DD DSN=PAY.CARDS,DISP=OLD',
  ]);
  const lib = r.datasetFlow.find((f) => f.dsn === 'PAY.LIB(MEMBER)');
  assert.deepEqual([lib.writtenBy, lib.readBy, lib.undetermined], [['S1'], ['S2'], []]);
  const cards = r.datasetFlow.find((f) => f.dsn === 'PAY.CARDS');
  assert.deepEqual([cards.writtenBy, cards.readBy, cards.undetermined], [['S2'], ['S1'], []],
    'DISP=OLD says nothing about direction; SYSUT1 and SYSUT2 do');
});

test('a dataset REPRO names without a DD is still a touch, so the flow through it is joined', () => {
  const r = parse([
    '//J JOB (X)',
    '//S1 EXEC PGM=PAYGEN',
    '//OUT DD DSN=PAY.EXTRACT,DISP=(NEW,CATLG)',
    '//S2 EXEC PGM=IDCAMS',
    '//SYSIN DD *',
    '  REPRO INDATASET(PAY.EXTRACT) OUTDATASET(PAY.EXTRACT.COPY)',
    '/*',
    '//S3 EXEC PGM=PAYRPT',
    '//IN DD DSN=PAY.EXTRACT.COPY,DISP=SHR',
  ]);
  const extract = r.datasetFlow.find((f) => f.dsn === 'PAY.EXTRACT');
  assert.deepEqual([extract.writtenBy, extract.readBy], [['S1'], ['S2']]);
  assert.equal(extract.writers[0].program, 'PAYGEN');
  const copy = r.datasetFlow.find((f) => f.dsn === 'PAY.EXTRACT.COPY');
  assert.deepEqual(copy.writers, [{ step: 'S2', program: 'IDCAMS', dd: null, line: 6, copiedFrom: [{ dd: null, dsn: 'PAY.EXTRACT' }] }]);
  assert.deepEqual(copy.readBy, ['S3']);
});
