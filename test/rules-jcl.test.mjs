import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanJcl, JCL_RULES } from '../lib/sets/jcl.mjs';
import { scanAll, RULE_SETS, ALL_RULES } from '../lib/scan.mjs';
import { classesOf } from '../lib/consequence.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-jcl-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};

const program = (id) => ['       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`,
  '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n');

const rulesIn = (findings) => [...new Set(findings.map((f) => f.rule))].sort();

test('a password in in-stream data is critical, and the security command around it is not double reported', () => {
  const root = tree({
    'admin.jcl': [
      '//ADMIN    JOB (ACCT)',
      '//STEP1    EXEC PGM=IKJEFT01',
      '//SYSTSIN  DD *',
      '  ADDUSER BATCHOP PASSWORD=SUMMER26 SPECIAL',
      '  PERMIT PROD.PAYROLL ID(BATCHOP) ACCESS(ALTER)',
      '/*',
    ].join('\n'),
  });
  const r = scanJcl(root);
  assert.deepEqual(rulesIn(r.findings), ['jcl-instream-credential', 'jcl-instream-security-command']);
  const cred = r.findings.find((f) => f.rule === 'jcl-instream-credential');
  assert.equal(cred.line, 4, 'the finding is on the line the password is on, not on the DD');
  assert.equal(cred.step, 'STEP1');
  assert.equal(r.findings.filter((f) => f.line === 4).length, 1, 'one line is one finding');
});

test('a destructive in-stream command is reported, and a harmless one is not', () => {
  const root = tree({
    'clean.jcl': [
      '//CLEAN    JOB (ACCT)',
      '//STEP1    EXEC PGM=IDCAMS',
      '//SYSIN    DD *',
      '  DELETE PROD.MASTER.BACKUP',
      '  LISTCAT ENTRIES(PROD.MASTER)',
      '/*',
    ].join('\n'),
  });
  const r = scanJcl(root);
  assert.deepEqual(rulesIn(r.findings), ['jcl-instream-destructive']);
  assert.equal(r.findings[0].line, 4, 'LISTCAT is not a finding');
});

const destructive = (lines, site) => scanJcl(tree({ 'job.jcl': lines.join('\n') + '\n', ...(site ? { 'cobolwork.site.json': JSON.stringify(site) } : {}) }))
  .findings.filter((f) => f.rule === 'jcl-instream-destructive');

test('a delete the same job rebuilds is a clear-down, info and in neither consequence class', () => {
  // The shapes read in the 500-repository corpus on 2026-09-27: delete, then allocate new and write;
  // and delete, define and REPRO into it, under the submitter's own qualifier.
  const allocated = destructive(['//J        JOB 1', '//STEP1    EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DELETE Z26069.TOPLANE NVSAM', '/*',
    '//STEP2    EXEC PGM=PROG1', '//OUTFL1   DD DSN=Z26069.TOPLANE,DISP=(NEW,CATLG,DELETE)']);
  const reloaded = destructive(['//J        JOB 1', '//S1       EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DELETE &SYSUID..VSAM.AA CLUSTER PURGE',
    '  DEF CL ( NAME(&SYSUID..VSAM.AA) )', '  REPRO INFILE(X) ODS(&SYSUID..VSAM.AA)', '/*']);
  const reset = destructive(['//J        JOB 1', '//STEP1    EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DELETE KEERTHANA.EMPLOYEE.VSAM CLUSTER PURGE', '/*',
    '//STEP2    EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DEFINE CLUSTER -', '   (NAME(KEERTHANA.EMPLOYEE.VSAM) INDEXED)', '/*']);
  const ownQualifier = destructive(['//J        JOB 1', '//DELET100 EXEC PGM=IDCAMS', '//SYSIN    DD *', '   DELETE Z95628.QSAM.OUT NONVSAM', '/*',
    '//RUN      EXEC PGM=FILTER01', '//OUTFILE  DD DSN=&SYSUID..QSAM.OUT,DISP=(NEW,CATLG,DELETE)']);
  const throughProcedure = destructive(['//J        JOB 1', '//REINIT   EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DELETE Z26069.TOPLANE.REPORT  NVSAM', '/*',
    '//UNOSC    PROC RLE=', '//STEP1    EXEC PGM=CMPROC', '//OUTFL2   DD DSN=Z26069.&RLE..REPORT,DISP=(NEW,CATLG,DELETE)', '//         PEND',
    '//RUN1     EXEC UNOSC,RLE=TOPLANE']);
  for (const [f] of [allocated, reloaded, reset, ownQualifier, throughProcedure]) {
    assert.equal(f.sev, 'info');
    assert.match(f.detail, /a clear-down before a rebuild$/);
    assert.deepEqual(classesOf(f), []);
  }
});

test('a delete nothing rebuilds is med, high in production, and an SQL DELETE FROM is not a dataset', () => {
  const lines = ['//J        JOB 1', '//S1       EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DELETE PROD.MASTER.BACKUP', '/*'];
  assert.equal(destructive(lines)[0].sev, 'med');
  const prod = destructive(lines, { productionQualifiers: ['PROD'] })[0];
  assert.equal(prod.sev, 'high');
  assert.match(prod.detail, /in the production qualifier PROD$/);
  assert.deepEqual(classesOf(prod), ['data-mutation']);
  assert.deepEqual(destructive(['//J        JOB 1', '//S1       EXEC PGM=DSNTIAD', '//SYSIN    DD *', '  DELETE FROM AUDIT_LOG WHERE X < 1;', '/*']), []);
  assert.deepEqual(destructive(['//J        JOB 1', '//S1       EXEC PGM=DFHCSDUP', '//SYSIN    DD *', 'DELETE GROUP(GAMAPPL) ALL', '/*']), [],
    "DFHCSDUP's DELETE removes CICS definitions, not a dataset");
  const continued = destructive(['//J        JOB 1', '//S1       EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DELETE  -', '    PROD.BNKACC.PATH3 -', '    PATH PURGE', '/*'],
    { productionQualifiers: ['PROD'] });
  assert.equal(continued[0].sev, 'high', 'the target on the continuation line is the one judged');
  assert.equal(destructive(['//J        JOB 1', '//S1       EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DELETE AWS.CCDA.CUSTDATA.CLUSTER CLUSTER', '/*',
    '//S2       EXEC PGM=IDCAMS', '//SYSIN    DD *', '  DEFINE CLUSTER (NAME(AWS.CUSTDATA.CLUSTER))', '/*'])[0].sev, 'med', 'a define under another name rebuilds nothing');
});

test('a non-default delimiter is reported, and the data past the /* is still read', () => {
  const root = tree({
    'hide.jcl': [
      '//HIDE     JOB (ACCT)',
      '//STEP1    EXEC PGM=IKJEFT01',
      '//SYSTSIN  DD *,DLM=##',
      '/* a naive reader stops here',
      '  ADDUSER SNEAKY PASSWORD=HUNTER2',
      '##',
      '/*',
    ].join('\n'),
  });
  const r = scanJcl(root);
  assert.ok(r.findings.some((f) => f.rule === 'jcl-dlm-hides-instream'));
  const cred = r.findings.find((f) => f.rule === 'jcl-instream-credential');
  assert.ok(cred, 'the credential past the /* is still found, which is the point of parsing DLM');
  assert.equal(cred.line, 5);
});

test('PARM to a program in the tree is an entry point; to one that is absent it is not claimed', () => {
  const root = tree({
    'run.jcl': [
      '//RUN      JOB (ACCT)',
      "//STEP1    EXEC PGM=PAYCALC,PARM='PROD'",
      "//STEP2    EXEC PGM=ELSEWHERE,PARM='PROD'",
    ].join('\n'),
    'src/paycalc.cbl': program('PAYCALC'),
  });
  const r = scanJcl(root);
  const entry = r.findings.filter((f) => f.rule === 'jcl-parm-is-an-entry-point');
  assert.equal(entry.length, 1);
  assert.match(entry[0].detail, /PAYCALC/);
});

test('a step running a system utility is ordinary; one running an unknown program is not', () => {
  const root = tree({
    'mix.jcl': [
      '//MIX      JOB (ACCT)',
      '//S1       EXEC PGM=IEFBR14',
      '//S2       EXEC PGM=IDCAMS',
      '//S3       EXEC PGM=PAYCALC',
      '//S4       EXEC PGM=GHOSTPGM',
    ].join('\n'),
    'src/paycalc.cbl': program('PAYCALC'),
  });
  const r = scanJcl(root);
  const unresolved = r.findings.filter((f) => f.rule === 'jcl-exec-pgm-unresolved');
  assert.deepEqual(unresolved.map((f) => f.step), ['S4'],
    'system utilities and programs defined in the tree are not unresolved');
});

test('a program is known by the PROGRAM-ID it declares, not by its file name', () => {
  const root = tree({
    'run.jcl': ['//R JOB (A)', '//S EXEC PGM=REALNAME'].join('\n'),
    'src/whatever.cbl': program('REALNAME'),
  });
  assert.deepEqual(scanJcl(root).findings, []);
});

test('an ordinary job produces nothing, so the rule set is quiet by default', () => {
  const root = tree({
    'ok.jcl': [
      '//OK       JOB (ACCT)',
      '//STEP1    EXEC PGM=IEBGENER',
      '//SYSUT1   DD DSN=A.B.C,DISP=SHR',
      '//SYSUT2   DD SYSOUT=*',
      '//SYSIN    DD DUMMY',
    ].join('\n'),
  });
  assert.deepEqual(scanJcl(root).findings, []);
});

test('unresolved symbolics in a job make the scan report incomplete coverage', () => {
  const root = tree({ 'sym.jcl': ['//S JOB (A)', '//E EXEC PGM=IEFBR14,PARM=&NOTSET'].join('\n') });
  assert.ok(scanJcl(root).summary.coverageIncomplete);
});

test('the jcl set is registered, keyed and merged into a whole scan', () => {
  assert.ok(RULE_SETS.includes('jcl'));
  for (const id of Object.keys(JCL_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);

  const root = tree({
    'admin.jcl': ['//A JOB (X)', '//S EXEC PGM=IKJEFT01', '//SYSTSIN DD *', '  ADDUSER OP PASSWORD=P123', '/*'].join('\n'),
  });
  const r = scanAll(root);
  assert.ok(r.summary.bySet.jcl, 'the set reports its own counts');
  const f = r.findings.find((x) => x.rule === 'jcl-instream-credential');
  assert.ok(f, 'the finding reaches the merged report');
  assert.equal(f.sev, 'crit', 'severity comes from the rule table');
  assert.equal(f.cwe, 'CWE-798');
  assert.equal(r.ruleText['jcl-instream-credential'], JCL_RULES['jcl-instream-credential'].text);
});

// A vendor product supplies its own utilities. Before packs could vouch for them, every shop
// running Connect:Direct got an unresolved-program finding on DMBATCH - a false positive created
// by the customer having correctly told us what they run.
test('a loaded pack vouches for the programs its product supplies', () => {
  const jclText = '//X JOB (A)\n//S EXEC PGM=DMBATCH\n//SYSIN DD *\n  SIGNON USERID=OP\n/*\n';

  const without = tree({ 'j/XFER.jcl': jclText });
  assert.ok(scanJcl(without).findings.some((f) => f.rule === 'jcl-exec-pgm-unresolved'),
    'with no pack loaded, DMBATCH is a program nothing in the tree defines');

  const withPack = tree({
    'cobolwork.site.json': JSON.stringify({ vendorPacks: ['connectdirect'], allowUnvalidatedPacks: true }),
    'j/XFER.jcl': jclText,
  });
  const r = scanJcl(withPack);
  assert.deepEqual(r.findings.filter((f) => f.rule === 'jcl-exec-pgm-unresolved'), [],
    'with the pack loaded, it is the vendor utility the estate said it runs');
  assert.ok(r.summary.vendorProgramsKnown > 0, 'and the summary says how many it was told about');
});

test('a pack vouches only for its own programs', () => {
  const root = tree({
    'cobolwork.site.json': JSON.stringify({ vendorPacks: ['connectdirect'], allowUnvalidatedPacks: true }),
    'j/X.jcl': '//X JOB (A)\n//S1 EXEC PGM=DMBATCH\n//S2 EXEC PGM=CTMAPI\n',
  });
  const unresolved = scanJcl(root).findings.filter((f) => f.rule === 'jcl-exec-pgm-unresolved');
  assert.deepEqual(unresolved.map((f) => f.step), ['S2'],
    'loading the transfer pack says nothing about the scheduler');
});
