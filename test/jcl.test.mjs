import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJcl, foldStatements, splitOperands, parseOperands, substitute, dispositionOf, accessOf } from '../lib/jcl.mjs';
import './pin-machine.mjs';

// A job exercising the parts a naive reader gets wrong: a continued JOB card, a SET, symbolic
// substitution including the &SYM..LITERAL form, in-stream data with and without a custom
// delimiter, a concatenated DD, a continued DD, and an EXEC of a procedure.
const NIGHTLY = [
  "//PAYROLL  JOB (ACCT),'NIGHTLY RUN',CLASS=A,MSGCLASS=X,",
  '//             NOTIFY=&SYSUID,REGION=0M',
  '//*',
  '//* Nightly payroll. Do not run outside the batch window.',
  '//*',
  '//SETVARS  SET ENV=PROD,HLQ=PAYR',
  '//STEP010  EXEC PGM=IDCAMS',
  '//SYSPRINT DD SYSOUT=*',
  '//SYSIN    DD *',
  '  DELETE &HLQ..&ENV..MASTER.BACKUP',
  '  SET MAXCC=0',
  '/*',
  "//STEP020  EXEC PGM=IKJEFT01,PARM='ALLOC F(SYSUT1) DA(INPUT)'",
  '//SYSTSIN  DD *,DLM=##',
  '  ADDUSER BATCHOP PASSWORD=SUMMER26 SPECIAL',
  '/* this is data, not a delimiter, because DLM says so',
  '  ALTUSER BATCHOP OPERATIONS',
  '##',
  '//STEP030  EXEC PGM=PAYCALC',
  '//STEPLIB  DD DSN=&HLQ..&ENV..LOADLIB,DISP=SHR',
  '//         DD DSN=SYS1.LINKLIB,DISP=SHR',
  '//MASTER   DD DSN=&HLQ..&ENV..MASTER,DISP=(OLD,KEEP,KEEP),',
  '//            UNIT=SYSDA,VOL=SER=PRD001',
  '//STEP040  EXEC PROC=CLEANUP,PARM=&MISSING',
  '//',
].join('\n');

const parse = (src, opts) => parseJcl(src, 'nightly.jcl', opts);

test('operands split on commas that are not inside parentheses or quotes', () => {
  assert.deepEqual(splitOperands('DISP=(NEW,CATLG,DELETE),UNIT=SYSDA'), ['DISP=(NEW,CATLG,DELETE)', 'UNIT=SYSDA']);
  assert.deepEqual(splitOperands("(ACCT),'A,B',CLASS=A"), ['(ACCT)', "'A,B'", 'CLASS=A']);
});

test('a keyword splits on the first = outside parentheses, so DCB= stays one operand', () => {
  const { keywords, positional } = parseOperands('PGM=IDCAMS,DCB=(RECFM=FB,LRECL=80)');
  assert.equal(keywords.get('PGM'), 'IDCAMS');
  assert.equal(keywords.get('DCB'), '(RECFM=FB,LRECL=80)');
  assert.deepEqual(positional, []);
});

test('a symbol ends at a dot, which is consumed as a separator', () => {
  const symbols = new Map([['HLQ', 'PAYR'], ['ENV', 'PROD']]);
  assert.equal(substitute('&HLQ..&ENV..MASTER', symbols).text, 'PAYR.PROD.MASTER');
  assert.equal(substitute('&&LITERAL', symbols).text, '&&LITERAL', 'a double ampersand is not a symbol');
  assert.deepEqual(substitute('&NOPE.DATA', symbols).unresolved, ['NOPE']);
});

test('a continued statement folds into one, and remembers every line it came from', () => {
  const { statements } = foldStatements(NIGHTLY);
  const job = statements.find((s) => s.operation === 'JOB');
  assert.deepEqual(job.lines, [1, 2]);
  assert.match(job.field, /NOTIFY=&SYSUID/);
  assert.match(job.field, /CLASS=A/, 'the first line survives the fold');
});

test('a continuation resuming outside columns 4 to 16 is a diagnostic', () => {
  const bad = ['//A JOB (X),', '//                                        CLASS=A'].join('\n');
  const { diags } = foldStatements(bad);
  assert.ok(diags.some((d) => /must resume between columns 4 and 16/.test(d.text)));
});

test('steps are tied to the program they run, with their DD statements', () => {
  const r = parse(NIGHTLY, { symbols: { SYSUID: 'OPER01' } });
  assert.deepEqual(r.jobs.map((j) => j.name), ['PAYROLL']);
  assert.deepEqual(r.steps.map((s) => s.name), ['STEP010', 'STEP020', 'STEP030', 'STEP040']);
  assert.deepEqual(r.steps.map((s) => s.pgm), ['IDCAMS', 'IKJEFT01', 'PAYCALC', null]);
  assert.equal(r.steps[3].proc, 'CLEANUP', 'a step may run a procedure instead of a program');
  assert.equal(r.steps[1].parm, 'ALLOC F(SYSUT1) DA(INPUT)', 'PARM is unquoted');
});

test('SET and symbolic substitution reach the dataset names', () => {
  const r = parse(NIGHTLY, { symbols: { SYSUID: 'OPER01' } });
  const steplib = r.dds.filter((d) => d.step === 'STEP030');
  assert.equal(steplib[0].dsn, 'PAYR.PROD.LOADLIB');
  assert.equal(steplib[1].dsn, 'SYS1.LINKLIB');
  assert.ok(steplib[1].concatenated, 'a DD with no name is concatenated to the one before it');
  assert.equal(steplib[2].dsn, 'PAYR.PROD.MASTER');
  assert.equal(steplib[2].disp, '(OLD,KEEP,KEEP)', 'the continued operand is part of the same DD');
});

test('in-stream data is collected, and a custom DLM keeps /* as data', () => {
  const r = parse(NIGHTLY, { symbols: { SYSUID: 'OPER01' } });
  const sysin = r.dds.find((d) => d.step === 'STEP010' && d.name === 'SYSIN');
  assert.equal(sysin.inStream.length, 2);
  assert.match(sysin.inStream[0].text, /DELETE/);

  const systsin = r.dds.find((d) => d.name === 'SYSTSIN');
  assert.equal(systsin.dlm, '##');
  assert.equal(systsin.inStream.length, 3, 'the /* line is data, because DLM=## says where the stream ends');
  assert.ok(systsin.inStream.some((l) => /ALTUSER/.test(l.text)), 'the stream continues past the /*');
});

test('a non-default delimiter is reported, because it hides what follows from a line reader', () => {
  const r = parse(NIGHTLY, { symbols: { SYSUID: 'OPER01' } });
  assert.ok(r.diags.some((d) => /DLM=##/.test(d.text)));
});

test('an unresolved symbolic is named, and sets coverageIncomplete', () => {
  const r = parse(NIGHTLY, { symbols: { SYSUID: 'OPER01' } });
  assert.deepEqual(r.unresolvedSymbols, ['MISSING']);
  assert.ok(r.coverageIncomplete, 'operands read unsubstituted are not full coverage');
});

// The benchmark caught what these tests did not: in-stream data was being read as statements and
// reported as unreadable, because the fold checked a stream it never opened. Every assertion here
// was passing at the time. A job that is entirely ordinary must produce no error at all.
test('an ordinary job produces no error diagnostic, in-stream data included', () => {
  const r = parse(NIGHTLY, { symbols: { SYSUID: 'OPER01' } });
  assert.deepEqual(r.diags.filter((d) => d.sev === 'error'), [],
    'a line of in-stream data is data, not a statement that failed to parse');
  assert.ok(!r.statements.some((s) => s.kind === 'unreadable'));
});

test('a stream that runs to the next statement, with no /*, still ends there', () => {
  const r = parse(['//A JOB (X)', '//S1 EXEC PGM=IDCAMS', '//SYSIN DD *', '  LISTCAT', '//S2 EXEC PGM=IEFBR14'].join('\n'));
  assert.deepEqual(r.diags.filter((d) => d.sev === 'error'), []);
  assert.equal(r.dds[0].inStream.length, 1);
  assert.deepEqual(r.steps.map((s) => s.name), ['S1', 'S2'], 'the statement that ended the stream is still a statement');
});

test('an unreadable statement is kept and reported, never dropped', () => {
  const r = parse(['//A JOB', 'THIS IS NOT JCL', '//B EXEC PGM=X'].join('\n'));
  assert.ok(r.diags.some((d) => d.sev === 'error' && /must begin with \/\//.test(d.text)));
  assert.ok(r.statements.some((s) => s.kind === 'unreadable'), 'the line is still in the output');
  assert.equal(r.steps.length, 1, 'the statements around it still parse');
});

test('an EXEC naming neither PGM nor a procedure is an error', () => {
  const r = parse(['//A JOB', '//B EXEC COND=(0,NE)'].join('\n'));
  assert.ok(r.diags.some((d) => /neither PGM= nor a procedure/.test(d.text)));
});

test('an unresolved INCLUDE is a coverage gap, like an unresolved COPY', () => {
  const r = parse(['//A JOB', '//  INCLUDE MEMBER=STDPROC', '//B EXEC PGM=X'].join('\n'));
  assert.deepEqual(r.includes.map((i) => i.member), ['STDPROC']);
  assert.ok(r.coverageIncomplete);
});

test('a PROC body is attributed to the procedure, not to the job', () => {
  const r = parse([
    '//CLEANUP  PROC HLQ=DEFAULT',
    '//PURGE    EXEC PGM=IEFBR14',
    '//OLD      DD DSN=&HLQ..OLD,DISP=(OLD,DELETE)',
    '//         PEND',
    '//RUN      JOB (X)',
    '//DOIT     EXEC PROC=CLEANUP',
  ].join('\n'));
  assert.equal(r.procs.length, 1);
  assert.equal(r.procs[0].name, 'CLEANUP');
  assert.deepEqual(r.procs[0].steps.map((s) => s.name), ['PURGE']);
  assert.equal(r.steps.find((s) => s.name === 'PURGE').inProc, 'CLEANUP');
  assert.equal(r.steps.find((s) => s.name === 'DOIT').inProc, null);
  assert.equal(r.dds.find((d) => d.name === 'OLD').dsn, 'DEFAULT.OLD', 'PROC operands are symbolic defaults');
});

test('columns 73 to 80 are not the statement', () => {
  const line = '//A       EXEC PGM=REAL'.padEnd(72) + 'PAYLOAD1';
  const r = parse(['//J JOB', line].join('\n'));
  assert.equal(r.steps[0].pgm, 'REAL');
  assert.equal(r.statements.find((s) => s.operation === 'EXEC').sequence, 'PAYLOAD1',
    'the sequence area is kept for the hidden-content rules, separately from the statement');
});

// Dataset flow between steps. The parser says which steps touch which dataset and how; it does
// not say which step's program moved the data, because that needs a maintained list of what each
// utility does with its DD names rather than anything a parser can derive.
test('a disposition says what the step does to the dataset, and OLD says less than it looks', () => {
  const r = parse([
    '//J JOB (X)',
    '//S1 EXEC PGM=IEBGENER',
    '//OUT DD DSN=&&WORK,DISP=(NEW,PASS)',
    '//S2 EXEC PGM=PAYCALC',
    '//IN  DD DSN=&&WORK,DISP=SHR',
    '//LOG DD DSN=PROD.LOG,DISP=(MOD,KEEP)',
    '//EXC DD DSN=PROD.MASTER,DISP=OLD',
  ].join('\n'));
  const by = (n) => r.dds.find((d) => d.name === n);
  assert.equal(by('OUT').access, 'create');
  assert.equal(by('IN').access, 'read');
  assert.equal(by('LOG').access, 'append');
  assert.equal(by('EXC').access, 'exclusive', 'OLD is exclusive access and says nothing about direction');
  assert.ok(by('OUT').temporary, '&&WORK lives only for the job');
  assert.ok(!by('LOG').temporary);
});

test('an omitted status is NEW, and each part of a disposition is kept', () => {
  assert.deepEqual(dispositionOf('(,CATLG,DELETE)'), { status: 'NEW', normal: 'CATLG', abnormal: 'DELETE' });
  assert.deepEqual(dispositionOf('SHR'), { status: 'SHR', normal: null, abnormal: null });
  assert.deepEqual(dispositionOf('(OLD,,DELETE)'), { status: 'OLD', normal: null, abnormal: 'DELETE' });
  assert.equal(dispositionOf(null), null);
  assert.equal(accessOf('(,CATLG,DELETE)'), 'create', 'DISP=(,CATLG,DELETE) creates the dataset');
  assert.equal(accessOf(null), 'unknown', 'no DISP at all may be an override of one a procedure sets');
});

test('a DD remembers the last line of its statement', () => {
  const master = parse(NIGHTLY, { symbols: { SYSUID: 'OPER01' } }).dds.find((d) => d.name === 'MASTER');
  assert.deepEqual([master.line, master.endLine], [22, 23]);
});

test('a dataset touched by more than one step is a flow, with the direction it can prove', () => {
  const r = parse([
    '//J JOB (X)',
    '//S1 EXEC PGM=IEBGENER',
    '//OUT DD DSN=&&WORK,DISP=(NEW,PASS)',
    '//S2 EXEC PGM=PAYCALC',
    '//IN  DD DSN=&&WORK,DISP=SHR',
    '//ONE DD DSN=PROD.ONLY.HERE,DISP=SHR',
  ].join('\n'));
  assert.equal(r.datasetFlow.length, 1, 'a dataset only one step touches is not a flow');
  const f = r.datasetFlow[0];
  assert.equal(f.dsn, '&&WORK');
  assert.ok(f.temporary);
  assert.deepEqual(f.writtenBy, ['S1']);
  assert.deepEqual(f.readBy, ['S2']);
  assert.deepEqual(f.undetermined, []);
});

test('a referback names an earlier DD, and resolves to the dataset that DD named', () => {
  const r = parse([
    '//J JOB (X)',
    '//S1 EXEC PGM=IEBGENER',
    '//SYSUT2 DD DSN=PROD.EXTRACT,DISP=(NEW,CATLG)',
    '//S2 EXEC PGM=PAYCALC',
    '//IN DD DSN=*.S1.SYSUT2,DISP=SHR',
  ].join('\n'));
  const back = r.dds.find((d) => d.name === 'IN');
  assert.equal(back.rawDsn, '*.S1.SYSUT2', 'what the job wrote is kept');
  assert.equal(back.dsn, 'PROD.EXTRACT', 'and what it means is resolved');
  assert.equal(back.referback.resolved, true);
  assert.equal(r.datasetFlow.length, 1, 'the two steps are joined through the referback');
});

test('a referback to a DD that is not there is reported as unresolved, not invented', () => {
  const r = parse(['//J JOB (X)', '//S1 EXEC PGM=X', '//IN DD DSN=*.NOPE.SYSUT2,DISP=SHR'].join('\n'));
  const back = r.dds.find((d) => d.name === 'IN');
  assert.equal(back.referback.resolved, false);
  assert.equal(back.dsn, '*.NOPE.SYSUT2', 'it keeps the text rather than guessing a dataset');
});

test('an undetermined disposition is counted as undetermined, not as a read', () => {
  const r = parse([
    '//J JOB (X)',
    '//S1 EXEC PGM=A', '//D1 DD DSN=PROD.SHARED,DISP=OLD',
    '//S2 EXEC PGM=B', '//D2 DD DSN=PROD.SHARED,DISP=SHR',
  ].join('\n'));
  const f = r.datasetFlow[0];
  assert.deepEqual(f.undetermined, ['S1']);
  assert.deepEqual(f.readBy, ['S2']);
  assert.deepEqual(f.writtenBy, [], 'nothing is claimed to have written it');
});

test('a PROCSTEP.DDNAME override is a DD of that procedure step, not a malformed name', () => {
  const r = parse([
    '//J JOB (X)',
    '//CL EXEC IGYWCL',
    '//COBOL.SYSIN DD DSN=DEV.SRC(PAY01),DISP=SHR',
    '//LKED.SYSLMOD DD DSN=DEV.LOAD(PAY01),DISP=SHR',
    '//BAD.NAME.X DD DUMMY',
  ].join('\n'));
  const sysin = r.dds.find((d) => d.name === 'COBOL.SYSIN');
  assert.equal(sysin.procStep, 'COBOL', 'the name stays as written, since findings are known by it');
  assert.equal(sysin.step, 'CL');
  assert.equal(r.dds.find((d) => d.name === 'LKED.SYSLMOD').procStep, 'LKED');
  const names = r.diags.filter((d) => /name field/.test(d.text)).map((d) => d.text);
  assert.equal(names.length, 1, 'only the three-part name is malformed');
  assert.match(names[0], /BAD\.NAME\.X/);
});

test('JOBLIB and what is concatenated to it belong to the job; any other DD before a step does not', () => {
  const r = parse([
    '//J JOB (X)',
    '//JOBLIB DD DSN=PROD.LOADLIB,DISP=SHR',
    '//       DD DSN=PROD.DB2.SDSNLOAD,DISP=SHR',
    '//STRAY  DD DSN=PROD.OTHER,DISP=SHR',
    '//S1 EXEC PGM=A',
  ].join('\n'));
  assert.deepEqual(r.jobs[0].dds.map((d) => d.dsn), ['PROD.LOADLIB', 'PROD.DB2.SDSNLOAD']);
  const stray = r.diags.filter((d) => /outside any step/.test(d.text));
  assert.deepEqual(stray.map((d) => d.line), [4]);
});

test('an operand field ends at a blank: a comma before a comment continues, and the comment is no value', () => {
  const r = parse([
    '//J JOB ,                                                            JOB00150',
    '// MSGCLASS=H,CLASS=A',
    '//S1 EXEC PGM=A',
    '//OUT DD UNIT=SYSDA,',
    '//         SPACE=(CYL,(1,1),RLSE), 00,RECFM=FB), OLD.TEXT',
    "//         DSN=PROD.OUT,DISP=(NEW,CATLG)   WRITES 'THE' FILE",
    "//PARM DD DSN=A.B,DISP=SHR  IS SHR, NOT OLD",
    '// IF (RC > 4) THEN',
    '//S2 EXEC PGM=B',
    '// ENDIF',
  ].join('\n'));
  assert.equal(r.jobs[0].keywords.get('MSGCLASS'), 'H', 'the JOB statement continues past its sequence number');
  const out = r.dds.find((d) => d.name === 'OUT');
  assert.equal(out.dsn, 'PROD.OUT');
  assert.equal(out.keywords.get('DISP'), '(NEW,CATLG)');
  assert.equal(r.dds.find((d) => d.name === 'PARM').access, 'read', 'DISP=SHR, not SHR and the comment after it');
  assert.deepEqual(r.diags.filter((d) => d.sev !== 'info').map((d) => d.text), []);
  assert.ok(r.statements.some((s) => s.operation === 'IF' && s.field === '(RC > 4) THEN'), 'an IF condition keeps its blanks');
});

test('a procedure whose program is a symbolic names none of its own, and one that sets it runs that', () => {
  const caller = parse(['//P PROC PGMNAME=,REGION=8M', '//S1 EXEC PGM=&PGMNAME,REGION=&REGION', '//IN DD DSN=A.B,DISP=SHR', '// PEND'].join('\n'));
  assert.equal(caller.steps[0].pgm, null);
  assert.equal(caller.steps[0].pgmSymbol, 'PGMNAME');
  assert.equal(caller.steps[0].proc, null, 'a symbolic program is not a procedure name');
  assert.deepEqual(caller.diags.filter((d) => d.sev === 'error'), []);
  assert.match(caller.diags.find((d) => /PGM=&PGMNAME/.test(d.text)).text, /leaves the symbolic empty/);
  assert.equal(caller.coverageIncomplete, false, 'the procedure was read whole; the caller chooses its program');

  const set = parse(['//P PROC PGMNAME=IEFBR14', '//S1 EXEC PGM=&PGMNAME', '// PEND'].join('\n'));
  assert.equal(set.steps[0].pgm, 'IEFBR14');
  assert.equal(set.steps[0].pgmSymbol, 'PGMNAME');
});

test('a system symbol the job never sets leaves coverage whole, and a symbolic it never sets does not', () => {
  const system = parse(['//J JOB (X),NOTIFY=&SYSUID', '//S1 EXEC PGM=A', '//IN DD DSN=&SYSUID..SRC.D&LYYMMDD,DISP=SHR'].join('\n'));
  assert.deepEqual(system.unresolvedSymbols.sort(), ['LYYMMDD', 'SYSUID']);
  assert.equal(system.coverageIncomplete, false, 'the system supplies these when the job is converted');
  assert.ok(system.diags.every((d) => !/SYSUID|LYYMMDD/.test(d.text) || d.sev === 'info'));

  const caller = parse(['//J JOB (X)', '//S1 EXEC PGM=A', '//IN DD DSN=&SYSUID..&HLQ..SRC,DISP=SHR'].join('\n'));
  assert.equal(caller.coverageIncomplete, true, '&HLQ has a value somewhere this file does not show');
});

test('a comment statement between the lines of a continued statement leaves it open, and EXPORT is a statement', () => {
  const r = parse([
    '//J JOB (X),',
    '//*  who to tell',
    '//  NOTIFY=OPS',
    '// EXPORT SYMLIST=*',
    '//S1 EXEC PGM=IEBGENER',
    '//SYSUT2 DD DSN=A.B,',
    '//*           DISP=(OLD,KEEP),',
    '//            DISP=SHR',
  ].join('\n'));
  assert.deepEqual(r.diags.filter((d) => d.sev !== 'info').map((d) => d.text), []);
  assert.equal(r.jobs[0].keywords.get('NOTIFY'), 'OPS');
  assert.equal(r.dds.find((d) => d.name === 'SYSUT2').keywords.get('DISP'), 'SHR');
  assert.ok(r.statements.some((s) => s.operation === 'EXPORT'));
  const lines = r.statements.map((s) => s.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b), 'a comment held back is read after its statement, in line order');
});

test('data after a comment that ended a DD * goes to an implicit SYSIN; /& ends a z/VSE job; a DOS end-of-file byte is no line', () => {
  const r = parse([
    '//J JOB (X)',
    '//LKED EXEC PGM=IEWL',
    '//SYSLIN DD *',
    '//* CHANGE THE PLAN',
    '  INCLUDE SYSLIB(DSNCLI)',
    '  NAME ADCDB01P (R)',
    '/*',
    '/&',
    '\x1a',
  ].join('\n'));
  assert.deepEqual(r.diags.filter((d) => d.sev === 'error'), []);
  assert.deepEqual(r.dds.map((d) => [d.name, d.inStream.length]), [['SYSLIN', 0], ['SYSIN', 2]]);
  assert.ok(r.diags.some((d) => d.sev === 'warn' && /implicit SYSIN/.test(d.text)));
  assert.ok(r.statements.some((s) => s.kind === 'end-of-job'));
});
