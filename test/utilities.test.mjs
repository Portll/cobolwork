import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJcl } from '../lib/jcl.mjs';
import { UTILITIES, tsoCommands } from '../lib/utilities.mjs';
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

test('IEBPTPCH and IEBUPDTE copy SYSUT1 to SYSUT2', () => {
  for (const pgm of ['IEBPTPCH', 'IEBUPDTE']) {
    const r = parse([
      '//J JOB (X)', `//P EXEC PGM=${pgm}`,
      '//SYSPRINT DD SYSOUT=*',
      '//SYSUT1 DD DSN=PAY.SRC(PAYCALC),DISP=SHR',
      '//SYSUT2 DD DSN=PAY.NEWSRC,DISP=(NEW,CATLG)',
      '//SYSIN DD *',
      '  PRINT TYPORG=PO,MAXFLDS=1',
      '/*',
    ]);
    assert.deepEqual(pairs(r), ['P: SYSUT1=PAY.SRC(PAYCALC) > SYSUT2=PAY.NEWSRC'], pgm);
    assert.equal(r.copies[0].utility, pgm);
  }
});

test('IDCAMS EXPORT and IMPORT move a cluster to and from its portable data set', () => {
  const r = parse([
    '//J JOB (X)', '//PORT EXEC PGM=IDCAMS',
    '//SYSPRINT DD SYSOUT=*',
    '//CLUSTER DD DSN=PAY.KSDS,DISP=OLD',
    '//PORTOUT DD DSN=PAY.PORTABLE,DISP=(NEW,CATLG)',
    '//SYSIN DD *',
    '  EXPORT PAY.KSDS OUTFILE(PORTOUT) TEMPORARY',
    '  EXP PAY.KSDS INFILE(CLUSTER) -',
    '      OFILE(PORTOUT)',
    '  EXPORT PAY.KSDS OUTDATASET(PAY.PORTABLE2)',
    '  IMPORT INDATASET(PAY.PORTABLE2) OUTFILE(CLUSTER)',
    '  IMPORT INFILE(PORTOUT) OUTDATASET(PAY.KSDS.NEW)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), [
    'PORT: -=PAY.KSDS > PORTOUT=PAY.PORTABLE',
    'PORT: CLUSTER=PAY.KSDS > PORTOUT=PAY.PORTABLE',
    'PORT: -=PAY.KSDS > -=PAY.PORTABLE2',
    'PORT: -=PAY.PORTABLE2 > CLUSTER=PAY.KSDS',
    'PORT: PORTOUT=PAY.PORTABLE > -=PAY.KSDS.NEW',
  ]);
  assert.deepEqual(r.copies.map((c) => c.line), [7, 8, 10, 11, 12]);
});

test('IDCAMS PRINT lists a data set to OUTFILE, or to SYSPRINT when it names none', () => {
  const r = parse([
    '//J JOB (X)', '//LIST EXEC PGM=IDCAMS',
    '//SYSPRINT DD SYSOUT=*',
    '//MASTER DD DSN=PAY.MASTER,DISP=SHR',
    '//REPORT DD DSN=PAY.LISTING,DISP=(NEW,CATLG)',
    '//SYSIN DD *',
    '  PRINT INFILE(MASTER) CHARACTER COUNT(10)',
    '  PRINT IDS(PAY.KSDS) -',
    '        OFILE(REPORT)',
    '  PRINT INDATASET(PAY.KSDS) OUTFILE(REPORT)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), [
    'LIST: MASTER=PAY.MASTER > SYSPRINT=null',
    'LIST: -=PAY.KSDS > REPORT=PAY.LISTING',
    'LIST: -=PAY.KSDS > REPORT=PAY.LISTING',
  ]);
});

test('IDCAMS ALTER NEWNAME moves a data set to its new name; a generic name or a member does not', () => {
  const r = parse([
    '//J JOB (X)', '//REN EXEC PGM=IDCAMS',
    '//SYSPRINT DD SYSOUT=*',
    '//SYSIN DD *',
    '  ALTER PAY.MASTER NEWNAME(TEST.MASTER)',
    '  ALTER \'PAY.EXTRACT\' -',
    '        NEWNM(TEST.EXTRACT)',
    '  ALTER PAY.* NEWNAME(TEST.*)',
    '  ALTER PAY.LIB(OLDMEM) NEWNAME(PAY.LIB(NEWMEM))',
    '  ALTER PAY.MASTER FREESPACE(10 10)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), ['REN: -=PAY.MASTER > -=TEST.MASTER', 'REN: -=PAY.EXTRACT > -=TEST.EXTRACT']);
  assert.deepEqual(r.copies.map((c) => c.line), [5, 6]);
});

test('IEBCOPY COPYMOD copies each INDD to the OUTDD like COPY', () => {
  const r = parse([
    '//J JOB (X)', '//LIB EXEC PGM=IEBCOPY',
    '//SYSPRINT DD SYSOUT=A',
    '//TESTLIB DD DSN=PAY.TEST.LOAD,DISP=SHR',
    '//PRODLIB DD DSN=PAY.PROD.LOAD,DISP=(OLD,KEEP)',
    '//SYSIN DD *',
    '  COPYMOD OUTDD=PRODLIB,INDD=TESTLIB',
    '  SELECT MEMBER=((WAGETAX,,R))',
    '/*',
  ]);
  assert.deepEqual(pairs(r), ['LIB: TESTLIB=PAY.TEST.LOAD > PRODLIB=PAY.PROD.LOAD']);
  assert.equal(r.copies[0].line, 7);
});

test('ADRDSSU COPY copies from INDDNAME or LOGINDDNAME to OUTDDNAME', () => {
  const r = parse([
    '//J JOB (X)', '//MOVE EXEC PGM=ADRDSSU',
    '//SRC DD UNIT=3390,VOL=SER=PAY001,DISP=OLD',
    '//DST DD UNIT=3390,VOL=SER=PAY002,DISP=OLD',
    '//SYSIN DD *',
    '  COPY DATASET(INCLUDE(PAY.**)) -',
    '       INDDNAME(SRC) OUTDDNAME(DST)',
    '  COPY DS(INCLUDE(PAY.**)) LIDD(SRC) ODD(DST)',
    '  COPY DS(INCLUDE(PAY.**)) OUTDDNAME(DST)',
    '  COPY DS(INCLUDE(PAY.**)) INDDNAME(SRC)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), ['MOVE: SRC=null > DST=null', 'MOVE: SRC=null > DST=null']);
  assert.deepEqual(r.copies.map((c) => c.line), [6, 8]);
  const notes = r.diags.filter((d) => d.sev === 'info');
  assert.ok(notes.some((d) => d.line === 9 && /input volume the command names no DD for/.test(d.text)));
  assert.ok(notes.some((d) => d.line === 10 && /output volume the command names no DD for/.test(d.text)));
});

test('ICETOOL COPY, SORT and MERGE read each FROM DD and write each TO DD', () => {
  const r = parse([
    '//J JOB (X)', '//TOOL EXEC PGM=ICETOOL',
    '//TOOLMSG DD SYSOUT=*', '//DFSMSG DD SYSOUT=*',
    '//IN1 DD DSN=PAY.A,DISP=SHR', '//IN2 DD DSN=PAY.B,DISP=SHR', '//IN3 DD DSN=PAY.C,DISP=SHR',
    '//OUT1 DD DSN=PAY.OUT1,DISP=(NEW,CATLG)', '//OUT2 DD DSN=PAY.OUT2,DISP=(NEW,CATLG)',
    '//TOOLIN DD *',
    '* COPY, THEN SORT, THEN MERGE',
    '  COPY FROM(IN1) TO(OUT1,OUT2)',
    '  SORT FROM(IN2) -   ANYTHING HERE IS IGNORED',
    '       TO(OUT2)',
    '  MERGE FROM(IN1,IN2) FROM(IN3) TO(OUT1)',
    '  COUNT FROM(IN1)',
    '/*',
  ]);
  assert.deepEqual(pairs(r), [
    'TOOL: IN1=PAY.A > OUT1=PAY.OUT1',
    'TOOL: IN1=PAY.A > OUT2=PAY.OUT2',
    'TOOL: IN2=PAY.B > OUT2=PAY.OUT2',
    'TOOL: IN1=PAY.A > OUT1=PAY.OUT1',
    'TOOL: IN2=PAY.B > OUT1=PAY.OUT1',
    'TOOL: IN3=PAY.C > OUT1=PAY.OUT1',
  ]);
  assert.deepEqual(r.copies.map((c) => c.line), [12, 12, 13, 15, 15, 15], 'a continued statement is placed on its first line');
});

test('ICETOOL says when its statements or its USING control statements are out of sight', () => {
  const job = (...tail) => parse([
    '//J JOB (X)', '//TOOL EXEC PGM=ICETOOL',
    '//IN DD DSN=PAY.A,DISP=SHR', '//OUT DD DSN=PAY.OUT,DISP=(NEW,CATLG)',
    ...tail,
  ]);
  const unread = job('//TOOLIN DD DSN=PAY.TOOLCARDS(SPLIT),DISP=SHR');
  assert.deepEqual(unread.copies, []);
  assert.ok(unread.diags.some((d) => /PAY\.TOOLCARDS\(SPLIT\)/.test(d.text)));

  const split = job('//SPLITCNTL DD *', '  OUTFIL FNAMES=EAST,INCLUDE=(1,1,CH,EQ,C\'E\')', '/*', '//TOOLIN DD *', '  COPY FROM(IN) TO(OUT) USING(SPLIT)', '/*');
  assert.deepEqual(pairs(split), ['TOOL: IN=PAY.A > OUT=PAY.OUT']);
  assert.ok(split.diags.some((d) => /SPLITCNTL that may write OUTFIL data sets/.test(d.text)));

  const plain = job('//INCLCNTL DD *', '  INCLUDE COND=(1,1,CH,EQ,C\'E\')', '/*', '//TOOLIN DD *', '  COPY FROM(IN) TO(OUT) USING(INCL)', '/*');
  assert.ok(!plain.diags.some((d) => /OUTFIL/.test(d.text)));
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

const TSO_JOB = [
  '//J JOB (X)',
  "//S1 EXEC PGM=IKJEFT01,PARM='ALLOC FILE(PARMDD) DA(''PAY.PARM'') SHR'",
  '//SYSTSPRT DD SYSOUT=*',
  '//SYSTSIN DD *',
  "  ALLOC FILE(MASTER) DA('PAY.MASTER') SHR REUSE",
  "  ALLOCATE DDNAME(REPORT) DATASET('PAY.RPT.A' 'PAY.RPT.B') OLD",
  '  ALLOC DD(OUT) DA(MY.OUTPUT) NEW -',
  '        SPACE(1,1) TRACKS',
  '  ALLOC FILE(PRT) SYSOUT(A)',
  "  ALLOC F(AMBIG) DA('PAY.X') SHR",
  "  CALL 'PAY.LOAD(PAYCALC)' 'RUN=NIGHTLY'",
  '  CALL *(OTHER)',
  '  CALL LOAD',
  '  DSN SYSTEM(DB2P)',
  "  RUN PROGRAM   (SQLPGM) PLAN (SQLPLAN) PARMS ('/ABC')",
  '  END',
  '/*',
];

test('TSO ALLOCATE in a batch step is a DD of the step; a name without quotes has no dsn, and F is not FILE', () => {
  const r = parse(TSO_JOB);
  const got = r.steps[0].dds.filter((d) => d.allocated).map((d) => [d.name, d.dsn, d.access, d.sysout, d.line]);
  assert.deepEqual(got, [
    ['PARMDD', 'PAY.PARM', 'read', null, 2],
    ['MASTER', 'PAY.MASTER', 'read', null, 5],
    ['REPORT', 'PAY.RPT.A', 'exclusive', null, 6],
    [null, 'PAY.RPT.B', 'exclusive', null, 6],
    ['OUT', null, 'create', null, 7],
    ['PRT', null, 'unknown', 'A', 9],
  ]);
  assert.equal(r.steps[0].dds.find((d) => d.name === 'OUT').rawDsn, 'MY.OUTPUT');
});

test('a data set a TSO step allocates joins the dataset flow', () => {
  const r = parse([
    '//J JOB (X)', '//S1 EXEC PGM=PAYGEN', '//OUT DD DSN=PAY.MASTER,DISP=(NEW,CATLG)',
    '//S2 EXEC PGM=IKJEFT01', '//SYSTSIN DD *', "  ALLOC FILE(IN) DA('PAY.MASTER') SHR", "  CALL 'PAY.LOAD(PAYRPT)'", '/*',
  ]);
  const master = r.datasetFlow.find((f) => f.dsn === 'PAY.MASTER');
  assert.deepEqual(master.writtenBy, ['S1']);
  assert.deepEqual(master.readBy, ['S2']);
});

test('TSO CALL and DSN RUN name the programs a TSO step runs, with their parameters', () => {
  const r = parse(TSO_JOB);
  assert.deepEqual(tsoCommands(r.steps[0]).runs.map((x) => [x.program, x.parm, x.line, x.via]), [
    ['PAYCALC', 'RUN=NIGHTLY', 11, 'TSO CALL'],
    ['OTHER', null, 12, 'TSO CALL'],
    ['TEMPNAME', null, 13, 'TSO CALL'],
    ['SQLPGM', '/ABC', 15, 'DSN RUN'],
  ]);
});

test('TSO commands kept in a data set are named as unread', () => {
  const r = parse(['//J JOB (X)', '//S1 EXEC PGM=IKJEFT01', '//SYSTSIN DD DSN=PAY.CNTL(TSOCMDS),DISP=SHR']);
  assert.ok(r.diags.some((d) => /commands in PAY\.CNTL\(TSOCMDS\).*ALLOCATE, CALL or RUN/.test(d.text)));
});

test('a keyword may stand apart from its parenthesis, and sequence numbers past column 72 are not read', () => {
  const r = parse([
    '//J JOB (X)', '//S1 EXEC PGM=IKJEFT01', '//SYSTSIN DD *',
    "  ALLOC FILE (IN) DA ('PAY.IN') SHR".padEnd(72) + '00010000',
    '  DSN SYSTEM (DB2P)'.padEnd(72) + '00020000',
    '    RUN PROGRAM   (GETTAB) -'.padEnd(72) + '00030000',
    '        PLAN      (PLANA )'.padEnd(72) + '00040000',
    '/*',
  ]);
  assert.deepEqual(r.steps[0].dds.filter((d) => d.allocated).map((d) => [d.name, d.dsn]), [['IN', 'PAY.IN']]);
  assert.deepEqual(tsoCommands(r.steps[0]).runs.map((x) => x.program), ['GETTAB']);
});

test('FTP sends to and fetches from a remote end, and SITE FILETYPE=JES marks the transfers after it', () => {
  const r = parse([
    '//J JOB (X)', '//S1 EXEC PGM=PAYGEN', '//OUT DD DSN=PAY.EXTRACT,DISP=(NEW,CATLG)',
    "//S2 EXEC PGM=FTP,PARM='partner.example.com (EXIT'", '//OUTDD DD DSN=PAY.EXTRACT,DISP=SHR', '//INPUT DD *', 'USER01 &PW',
    'PUT //DD:OUTDD /in/extract.dat', "LCD 'PAY'", 'GET /out/rates.dat RATES (REPLACE', 'MGET a.txt b*.txt',
    'SITE FILETYPE=JES', "PUT 'PAY.JCL(SUBMIT)'", "GET JOB01234 'PAY.JOBOUT'", 'QUIT', '/*',
    '//S3 EXEC PGM=RATEUSE', '//IN DD DSN=PAY.RATES,DISP=SHR',
  ]);
  const end = (e) => (e.remote ? `${e.remote.host}:${e.remote.name}${e.remote.filetype ? `[${e.remote.filetype}]` : ''}` : `${e.dd || '-'}=${e.dsn}`);
  assert.deepEqual(r.copies.map((c) => `${c.line}: ${end(c.from)} > ${end(c.to)}`), [
    '8: OUTDD=PAY.EXTRACT > partner.example.com:/in/extract.dat',
    '10: partner.example.com:/out/rates.dat > -=PAY.RATES',
    '11: partner.example.com:a.txt > -=PAY.A.TXT',
    "13: -=PAY.JCL(SUBMIT) > partner.example.com:'PAY.JCL(SUBMIT)'[JES]",
    '14: partner.example.com:JOB01234[JES] > -=PAY.JOBOUT',
  ]);
  const rates = r.datasetFlow.find((d) => d.dsn === 'PAY.RATES');
  assert.deepEqual([rates.writtenBy, rates.readBy], [['S2'], ['S3']]);
  assert.deepEqual(rates.writers[0].copiedFrom, [{ dd: null, dsn: null, remote: { host: 'partner.example.com', name: '/out/rates.dat' } }]);
});
