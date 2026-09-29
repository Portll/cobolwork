import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRecon, RECON_RULES } from '../lib/sets/recon.mjs';
import { loadSite, classifyPath } from '../lib/site.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-recon-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text, null, 1));
  }
  return root;
};

const SITE = {
  productionQualifiers: ['PROD', 'PAYR'],
  productionJobPaths: ['prod'],
  nonProductionJobPaths: ['test'],
  systemNames: ['SYSA'],
};

// The whole reason this rule set exists is that it must not fire on an estate that never told it
// what production means. Silence there is correct; silence that looks like a clean result is not.
test('without a site configuration the rule has not run, and the summary says so', () => {
  const root = tree({ 'test/JOB.jcl': '//J JOB (X)\n//S EXEC PGM=X\n//D DD DSN=PROD.MASTER,DISP=SHR\n' });
  const r = scanRecon(root);
  assert.deepEqual(r.findings.filter((f) => f.rule === 'recon-production-name-outside-production'), []);
  assert.equal(r.summary.siteConfigured, false);
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.notLooked[0], /did not run/);
});

// The name rule leaves a file the site does not classify alone, which is right, and so has not
// judged it, which the summary has to say. A file naming no production could not have been a
// finding however it was classified, and a JCL comment is not read by the rule either.
test('a file naming production that the site does not classify leaves the set incomplete', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'prod/RUN.jcl': '//J JOB (X)\n//S EXEC PGM=X\n//D DD DSN=PROD.MASTER,DISP=SHR\n',
    'batch/NIGHTLY.jcl': '//J JOB (X)\n//S EXEC PGM=X\n//D DD DSN=PROD.MASTER,DISP=SHR\n',
    'batch/NOTE.jcl': '//J JOB (X)\n//* copied from PROD.MASTER\n//S EXEC PGM=X\n',
    'batch/PLAIN.jcl': '//J JOB (X)\n//S EXEC PGM=X\n//D DD DSN=WORK.TEMP,DISP=SHR\n',
  });
  const r = scanRecon(root);
  assert.equal(r.summary.undecidedNamingProduction, 1);
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.notLooked[0], /^1 file\(s\) name a production qualifier or system name and match neither productionJobPaths nor nonProductionJobPaths in cobolwork\.site\.json/);

  const classified = scanRecon(tree({ 'cobolwork.site.json': SITE, 'prod/RUN.jcl': '//J JOB (X)\n//D DD DSN=PROD.MASTER,DISP=SHR\n' }));
  assert.equal(classified.summary.setIncomplete, false, 'a production job naming production is classified, and judged');
});

// With a disposition the DD is the production-dataset rules' finding; without one it only names it.
test('a production qualifier in a job the estate calls non-production is a finding', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/JOB.jcl': '//J JOB (X)\n//S EXEC PGM=X\n//D DD DSN=PROD.PAYROLL.MASTER\n',
  });
  const f = scanRecon(root).findings.filter((x) => x.rule === 'recon-production-name-outside-production');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /PROD/);
  assert.equal(f[0].line, 3);
});

test('the same name in a production job is the job doing its work', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'prod/JOB.jcl': '//J JOB (X)\n//S EXEC PGM=X\n//D DD DSN=PROD.PAYROLL.MASTER,DISP=SHR\n',
  });
  assert.deepEqual(scanRecon(root).findings.filter((x) => x.rule === 'recon-production-name-outside-production'), []);
});

test('an unclassified path is left alone rather than guessed at', () => {
  // Guessing here is what makes this rule set report the whole estate on its first run.
  const root = tree({
    'cobolwork.site.json': SITE,
    'somewhere/JOB.jcl': '//J JOB (X)\n//D DD DSN=PROD.PAYROLL.MASTER,DISP=SHR\n',
  });
  const r = scanRecon(root);
  assert.deepEqual(r.findings.filter((x) => x.rule === 'recon-production-name-outside-production'), []);
  assert.equal(r.summary.pathsUndecided, 1, 'and the count says how much was left alone');
});

test('a qualifier matches a whole component, never a substring', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/JOB.jcl': '//J JOB (X)\n//D DD DSN=PRODUCTS.CATALOG,DISP=SHR\n',
  });
  assert.deepEqual(scanRecon(root).findings.filter((x) => x.rule === 'recon-production-name-outside-production'), [],
    'PRODUCTS is not PROD');
});

test('a comment in a job is not a dataset reference', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/JOB.jcl': '//J JOB (X)\n//* copied from PROD.PAYROLL.MASTER by hand\n//D DD DSN=TEST.COPY,DISP=SHR\n',
  });
  assert.deepEqual(scanRecon(root).findings.filter((x) => x.rule === 'recon-production-name-outside-production'), []);
});

test('a routable address is a finding, and a private or documentation one is not', () => {
  const root = tree({
    'src/P.cbl': [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. P.',
      '       DATA DIVISION.',
      '       WORKING-STORAGE SECTION.',
      "       01 WS-HOST PIC X(20) VALUE '203.0.113.9'.",
      "       01 WS-LOCAL PIC X(20) VALUE '10.1.2.3'.",
      "       01 WS-LOOP PIC X(20) VALUE '127.0.0.1'.",
      "       01 WS-REAL PIC X(20) VALUE '52.94.236.248'.",
      '       PROCEDURE DIVISION.',
      '           GOBACK.',
      '',
    ].join('\n'),
  });
  const f = scanRecon(root).findings.filter((x) => x.rule === 'recon-routable-address-committed');
  assert.deepEqual(f.map((x) => x.detail.split(' ')[0]), ['52.94.236.248'],
    'private, loopback and documentation ranges say nothing about anyone');
});

test('four dotted numbers outside a literal are not an address', () => {
  const root = tree({
    'src/P.cbl': [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. P.',
      '      * version 52.94.236.248 of the record layout',
      '       PROCEDURE DIVISION.',
      '           GOBACK.',
      '',
    ].join('\n'),
  });
  assert.deepEqual(scanRecon(root).findings, []);
});

// An FTP control card is where an address actually appears in a job, and it is in-stream data
// rather than an operand. A qualifier cannot be purely numeric, so reading the whole JCL statement
// costs nothing in false positives and catches the case the rule exists for.
test('an address on an in-stream control card is found', () => {
  const root = tree({ 'test/J.jcl': '//J JOB (X)\n//S EXEC PGM=FTP\n//IN DD *\n  OPEN 52.94.236.248\n/*\n' });
  const f = scanRecon(root).findings.filter((x) => x.rule === 'recon-routable-address-committed');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 4);
});

test('a dotted dataset name in JCL is not mistaken for an address', () => {
  const root = tree({ 'test/J.jcl': '//J JOB (X)\n//D DD DSN=PROD.PAY.MAST.V2,DISP=SHR\n//* see 52.94.236.248\n' });
  assert.deepEqual(scanRecon(root).findings, [],
    'qualifiers are not numeric, and a comment is not a control card');
});

test('a malformed site file is reported rather than silently ignored', () => {
  const root = tree({ 'cobolwork.site.json': '{ not json', 'test/J.jcl': '//J JOB (X)\n' });
  const r = scanRecon(root);
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.siteProblems[0], /not readable as JSON/);
});

test('a site file that declares nothing says so', () => {
  const root = tree({ 'cobolwork.site.json': { productionJobPaths: ['prod'] }, 'test/J.jcl': '//J JOB (X)\n' });
  assert.match(scanRecon(root).summary.siteProblems[0], /neither a production qualifier nor a system name/);
});

test('paths are classified by the lists, and anything else is undecided', () => {
  const site = loadSite('/nowhere');
  assert.equal(site.present, false);
  const configured = { productionJobPaths: ['prod'], nonProductionJobPaths: ['test', 'dev'] };
  assert.equal(classifyPath(configured, 'prod/nightly.jcl'), 'production');
  assert.equal(classifyPath(configured, 'test/smoke.jcl'), 'non-production');
  assert.equal(classifyPath(configured, 'lib/other.jcl'), 'undecided');
});

const WRITES = 'recon-nonproduction-job-writes-production-dataset';
const READS = 'recon-nonproduction-job-reads-production-dataset';
const NAMED = 'recon-production-name-outside-production';
const at = (r) => r.findings.map((f) => [f.rule, f.line]).sort((a, b) => a[1] - b[1]);

test('a test job deleting a production dataset is a write, and the name rule leaves that line alone', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/CLEAN.jcl': '//J JOB (X)\n//S1 EXEC PGM=IEFBR14\n//D DD DSN=PROD.PAYROLL.MASTER,DISP=(OLD,DELETE)\n',
  });
  const r = scanRecon(root);
  assert.deepEqual(at(r), [[WRITES, 3]], 'one line is one finding');
  assert.equal(r.findings[0].sev, 'high');
  assert.equal(r.findings[0].step, 'S1');
  assert.match(r.findings[0].detail, /^step S1 deletes PROD\.PAYROLL\.MASTER when the step ends \(DISP=\(OLD,DELETE\)\)/);
});

test('what the disposition says the step does decides which rule reports it', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/MIXED.jcl': [
      '//J JOB (X)',
      '//S1 EXEC PGM=PAYTEST',
      '//NEW  DD DSN=PROD.EXTRACT,DISP=(NEW,CATLG,DELETE)',
      '//OMIT DD DSN=PROD.EXTRACT2,DISP=(,CATLG,DELETE)',
      '//MOD  DD DSN=PROD.LOG,DISP=MOD',
      '//OLD  DD DSN=PROD.MASTER,DISP=OLD',
      '//FAIL DD DSN=PAYR.HISTORY,DISP=(SHR,KEEP,DELETE)',
      '//SHR  DD DSN=PAYR.RATES,DISP=SHR',
    ].join('\n') + '\n',
  });
  const r = scanRecon(root);
  const on = Object.fromEntries(r.findings.map((f) => [f.line, f]));
  assert.equal(r.findings.length, 6);
  assert.match(on[3].detail, /creates PROD\.EXTRACT \(/);
  assert.match(on[4].detail, /creates PROD\.EXTRACT2/, 'an omitted status is NEW');
  assert.match(on[5].detail, /adds records to PROD\.LOG/);
  assert.match(on[6].detail, /holds PROD\.MASTER exclusively/);
  assert.match(on[7].detail, /deletes PAYR\.HISTORY if the step fails/);
  for (const l of [3, 4, 5, 6, 7]) assert.equal(on[l].rule, WRITES, `line ${l}`);
  assert.equal(on[8].rule, READS);
  assert.equal(on[8].sev, 'med', 'reading is less than writing');
});

test('a DD continued onto a second line is one finding, whichever line holds its DSN', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/CONT.jcl': '//J JOB (X)\n//S1 EXEC PGM=X\n//D DD DISP=SHR,\n//      DSN=PROD.PAYROLL.MASTER\n',
  });
  assert.deepEqual(at(scanRecon(root)), [[READS, 3]]);
});

// The DD is judged by the dataset it names, and the name rule keeps the line the name is written on.
test('a dataset named through a symbolic or a referback is judged by what it resolves to', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/SYM.jcl': [
      '//J JOB (X)',
      '//  SET HLQ=PROD',
      '//S1 EXEC PGM=X',
      '//IN DD DSN=&HLQ..PAYROLL.MASTER,DISP=SHR',
      '//S2 EXEC PGM=IEFBR14',
      '//GONE DD DSN=*.S1.IN,DISP=(OLD,DELETE)',
    ].join('\n') + '\n',
  });
  const r = scanRecon(root);
  assert.deepEqual(at(r), [[NAMED, 2], [READS, 4], [WRITES, 6]]);
  assert.match(r.findings.find((f) => f.line === 6).detail, /deletes PROD\.PAYROLL\.MASTER/);
});

test('a program library is where a step finds its code, so it is left to the name rule', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/LIB.jcl': [
      '//J JOB (X)',
      '//JOBLIB DD DSN=PROD.LOADLIB,DISP=SHR',
      '//S1 EXEC PGM=X',
      '//STEPLIB DD DSN=TEST.LOADLIB,DISP=SHR',
      '//        DD DSN=PAYR.LOADLIB,DISP=SHR',
      '//OUT DD DSN=PAYR.REPORT,DISP=(NEW,CATLG)',
    ].join('\n') + '\n',
  });
  assert.deepEqual(at(scanRecon(root)), [[NAMED, 2], [NAMED, 5], [WRITES, 6]],
    'the concatenation belongs to STEPLIB, and the DD after it does not');
});

test('a production name the job only mentions stays with the name rule', () => {
  const root = tree({
    'cobolwork.site.json': SITE,
    'test/LIST.jcl': [
      '//J JOB (X)',
      '//S1 EXEC PGM=IDCAMS',
      '//IN DD DSN=PROD.CUSTOMER',
      '//SYSIN DD *',
      '  LISTCAT ENTRIES(PAYR.CUSTOMER)',
      '/*',
    ].join('\n') + '\n',
  });
  assert.deepEqual(at(scanRecon(root)), [[NAMED, 3], [NAMED, 5]],
    'with no DISP the DD says nothing about what the step does, and in-stream text is not a DD');
});

test('the production-dataset rules keep the limits of the name rule', () => {
  const job = '//J JOB (X)\n//S1 EXEC PGM=IEFBR14\n//D DD DSN=PROD.PAYROLL.MASTER,DISP=(OLD,DELETE)\n';
  assert.deepEqual(scanRecon(tree({ 'cobolwork.site.json': SITE, 'prod/J.jcl': job })).findings, [],
    'a production job deleting production data is the job doing its work');
  assert.deepEqual(scanRecon(tree({ 'cobolwork.site.json': SITE, 'somewhere/J.jcl': job })).findings, [],
    'an undecided path is not guessed at');
  const substring = job.replace('PROD.PAYROLL', 'PRODUCTS.PAYROLL');
  assert.deepEqual(scanRecon(tree({ 'cobolwork.site.json': SITE, 'test/J.jcl': substring })).findings, [],
    'PRODUCTS is not PROD');
  const r = scanRecon(tree({ 'test/J.jcl': job }));
  assert.deepEqual(r.findings, []);
  assert.match(r.summary.notLooked[0], /production-dataset rules did not run/);
});

test('the recon set is registered and its rules are catalogued', () => {
  assert.ok(RULE_SETS.includes('recon'));
  for (const id of Object.keys(RECON_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});
