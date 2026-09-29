// diag/propose-site.mjs drafts the estate facts three rules need. It is tested the way it is used:
// run with --write over a tree, and the file it writes read back by the loader the rules use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSite, SITE_FILE } from '../lib/site.mjs';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '..', 'diag', 'propose-site.mjs');
const propose = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

function inTree(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-propose-'));
  try {
    for (const [p, lines] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), `${lines.join('\n')}\n`);
    }
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const REGION = [
  "//CICSRGN  JOB (ACCT),'CICS REGION',CLASS=A",
  '//CICS     EXEC PGM=DFHSIP,PARM=SYSIN,REGION=0M',
  '//STEPLIB  DD DSN=CICSTS.SDFHAUTH,DISP=SHR',
  '//DFHRPL   DD DSN=PROD.CICS.LOADLIB,DISP=SHR',
  '//INREADER DD SYSOUT=(A,INTRDR)',
  '//SYSIN    DD *',
  'APPLID=CICSPRD1',
  '/*',
];

const ESTATE = {
  'jcl/CICSRGN.jcl': REGION,
  // A batch job's reader DD, which the flow rules read from the job without a declaration.
  'jcl/NIGHTLY.jcl': [
    "//NIGHTLY  JOB (ACCT),'NIGHTLY',CLASS=A",
    '//STEP1    EXEC PGM=JOBGEN',
    '//JOBOUT   DD SYSOUT=(A,INTRDR)',
  ],
  'csd/REGION.csd': [
    ' DEFINE TDQUEUE(JOBS) GROUP(APP)',
    '        DESCRIPTION(SUBMIT JOBS FROM CICS)',
    '        TYPE(EXTRA) DDNAME(INREADER)',
    ' DEFINE TDQUEUE(SUBQ) GROUP(APP) TYPE(INDIRECT) INDIRECTNAME(JOBS)',
    ' DEFINE TDQUEUE(LOGQ) GROUP(APP) TYPE(EXTRA) DDNAME(APPLOG)',
  ],
  // A compile procedure, run once as it stands and once with its PARM overridden, and a step
  // overriding IBM's IGYWCL, which is not in the tree.
  'proc/BKCOMP.prc': [
    '//BKCOMP   PROC MEMBER=',
    '//COMPILE  EXEC PGM=IGYCRCTL,',
    "//             PARM='RENT,SSRANGE,NUMPROC(PFD),TRUNC(BIN)'",
    '//SYSIN    DD DSN=APP.COBOL(&MEMBER),DISP=SHR',
  ],
  'jcl/BUILD.jcl': [
    "//BUILD    JOB (ACCT),'BUILD',CLASS=A",
    '//PAYROLL  EXEC BKCOMP,MEMBER=PAYROLL',
    '//LEDGER   EXEC BKCOMP,MEMBER=LEDGER,',
    "//             PARM.COMPILE='RENT,NOSSRANGE,NUMPROC(PFD),TRUNC(BIN)'",
    '//REPORTS  EXEC IGYWCL,',
    "//             PARM.COBOL=(RENT,SSRANGE,'NUMPROC(PFD)',TRUNC(BIN))",
  ],
};

test('the draft names the region\'s reader DD, the queues the CSD sends to it, and only the options every compile step states', () => inTree(ESTATE, (dir) => {
  const r = propose(dir, '--write');
  assert.equal(r.status, 0, r.stderr);
  const draft = JSON.parse(readFileSync(join(dir, SITE_FILE), 'utf8'));
  assert.match(draft._comment, /^PROPOSED, NOT CONFIRMED/);

  assert.deepEqual(draft.internalReaderDds, ['INREADER']);
  assert.deepEqual(draft._from.internalReaderDds.INREADER, ['jcl/CICSRGN.jcl:5 (job CICSRGN, step CICS), which runs DFHSIP']);
  assert.deepEqual(Object.keys(draft._notProposed.internalReaderDds), ['JOBOUT'], 'a batch job is not a region');

  assert.deepEqual(draft.internalReaderQueues, ['JOBS', 'SUBQ'], 'LOGQ goes to another DD');
  assert.equal(draft._from.internalReaderQueues.SUBQ, 'csd/REGION.csd:4: TYPE(INDIRECT) INDIRECTNAME(JOBS), which is DDNAME(INREADER)');

  assert.deepEqual(draft.compilerOptions, ['RENT', 'NUMPROC(PFD)', 'TRUNC(BIN)']);
  assert.deepEqual(draft._notProposed.compilerOptions, {
    SSRANGE: 'stated by 2 of 3 compile steps',
    NOSSRANGE: 'stated by 1 of 3 compile steps',
  });
  // The procedure's step once, and each override; a job running the procedure as it stands
  // states nothing of its own.
  assert.deepEqual(Object.keys(draft._from.compilerOptions), [
    'proc/BKCOMP.prc:2 (procedure BKCOMP, step COMPILE)',
    'jcl/BUILD.jcl:3 (job BUILD, step LEDGER), PARM.COMPILE of BKCOMP',
    'jcl/BUILD.jcl:5 (job BUILD, step REPORTS), PARM.COBOL of IGYWCL',
  ]);
  assert.match(r.stdout, /proposed as compilerOptions, stated by every compile step: RENT, NUMPROC\(PFD\), TRUNC\(BIN\)/);
  assert.match(r.stdout, /SSRANGE {9}2 of 3/);

  const site = loadSite(dir);
  assert.deepEqual(site.problems, []);
  assert.deepEqual(site.productionQualifiers, ['PROD']);
  assert.deepEqual(site.internalReaderDds, ['INREADER']);
  assert.deepEqual(site.internalReaderQueues, ['JOBS', 'SUBQ']);
  assert.deepEqual(site.compilerOptions, ['RENT', 'NUMPROC(PFD)', 'TRUNC(BIN)']);

  // What the declaration is for: the rule runs, and finds the queue that reaches the reader.
  copyFileSync(join(HERE, 'fixtures', 'intrdr', 'undeclared', 'JOBSUB.cbl'), join(dir, 'JOBSUB.cbl'));
  const flow = scan(dir);
  assert.deepEqual(flow.findings.filter((f) => f.rule.endsWith('-to-internal-reader')).map((f) => f.rule), ['cics-terminal-to-internal-reader']);
  assert.equal(flow.summary.setIncomplete, undefined);
}));

// A DD qualified with a procedure step belongs to that step, and one without a qualifier to the
// procedure's first step. The queue is defined in DFHCSDUP job input rather than an extract.
test('a region started through a procedure the tree defines is found through the procedure step its DD names', () => inTree({
  'proc/DFHSTART.prc': [
    '//DFHSTART PROC',
    '//INIT     EXEC PGM=IEFBR14',
    '//CICS     EXEC PGM=DFHSIP,PARM=SYSIN',
  ],
  'jcl/CICSTST.jcl': [
    "//CICSTST  JOB (ACCT),'TEST REGION',CLASS=A",
    '//START    EXEC DFHSTART',
    '//CICS.IRDR DD SYSOUT=(B,INTRDR)',
    '//AUDIT    DD SYSOUT=(B,INTRDR)',
  ],
  'jcl/CSDLOAD.jcl': [
    "//CSDLOAD  JOB (ACCT),'CSD',CLASS=A",
    '//STEP1    EXEC PGM=DFHCSDUP',
    '//SYSIN    DD *',
    ' DEFINE TDQUEUE(IRQ) GROUP(APP)',
    '        TYPE(EXTRA) DDNAME(IRDR)',
    '/*',
  ],
}, (dir) => {
  assert.equal(propose(dir, '--write').status, 0);
  const draft = JSON.parse(readFileSync(join(dir, SITE_FILE), 'utf8'));
  assert.deepEqual(draft.internalReaderDds, ['IRDR']);
  assert.deepEqual(draft._from.internalReaderDds.IRDR, ['jcl/CICSTST.jcl:3 (job CICSTST, step START), which runs procedure DFHSTART, whose step CICS runs DFHSIP']);
  assert.deepEqual(draft._notProposed.internalReaderDds.AUDIT, ['jcl/CICSTST.jcl:4 (job CICSTST, step START), which runs procedure DFHSTART, whose step INIT runs IEFBR14: not a CICS region']);
  assert.deepEqual(draft.internalReaderQueues, ['IRQ']);
  assert.equal(draft._from.internalReaderQueues.IRQ, 'jcl/CSDLOAD.jcl:4: TYPE(EXTRA) DDNAME(IRDR)');
}));

test('the privilege facts are handed over as candidates and proposed as nothing', () => inTree({
  'jcl/RACFUNL.jcl': [
    "//RACFUNL  JOB (ACCT),'UNLOAD',CLASS=A,USER=SECADM",
    '//DBU      EXEC PGM=IRRDBU00',
    '//STEPLIB  DD DSN=SYS1.LINKLIB,DISP=SHR',
    '//INDD1    DD DSN=SYS1.RACFDS,DISP=SHR',
    '//OUTDD    DD DSN=PUBLIC.RACF.UNLOAD,DISP=(NEW,CATLG)',
  ],
}, (dir) => {
  const r = propose(dir, '--write');
  assert.equal(r.status, 0, r.stderr);
  const draft = JSON.parse(readFileSync(join(dir, SITE_FILE), 'utf8'));
  // Proposed as nothing. Whether SYS1.LINKLIB is APF-authorised is a fact about a running system,
  // and a guess here would turn three checks from silent into wrong.
  assert.deepEqual(draft.apfLibraries, []);
  assert.deepEqual(draft.restrictedDatasets, []);
  assert.deepEqual(draft.surrogateUsers, []);
  // Handed over as candidates, each with where it was seen, so the person answering ticks a list
  // rather than facing a blank page - which is what this whole file exists to avoid.
  assert.match(draft._toClassify.apfLibraries['SYS1.LINKLIB'], /loaded by 1 step/);
  assert.ok(draft._toClassify.surrogateUsers.SECADM);
  assert.deepEqual(Object.keys(draft._toClassify.restrictedDatasets).sort(), ['PUBLIC.RACF.UNLOAD', 'SYS1.RACFDS']);
  // The database a utility reads is as restricted as the unload it writes, so both are candidates.
  assert.match(draft._toClassify.restrictedDatasets['SYS1.RACFDS'], /IRRDBU00/);
  assert.deepEqual(loadSite(dir).problems.filter((x) => /apf|restricted|surrogate/i.test(x)), []);
}));

test('the draft refuses to overwrite a site file someone may have corrected', () => inTree(ESTATE, (dir) => {
  assert.equal(propose(dir, '--write').status, 0);
  const corrected = readFileSync(join(dir, SITE_FILE), 'utf8').replace('"RENT",', '');
  writeFileSync(join(dir, SITE_FILE), corrected);
  const r = propose(dir, '--write');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists; refusing to overwrite/);
  assert.equal(readFileSync(join(dir, SITE_FILE), 'utf8'), corrected);
}));

test('with no production qualifier the draft loads with the one problem that says so', () => inTree({ 'jcl/CICSRGN.jcl': REGION.filter((l) => !l.includes('PROD.')) }, (dir) => {
  assert.equal(propose(dir, '--write').status, 0);
  const site = loadSite(dir);
  assert.deepEqual(site.problems, ['the file names neither a production qualifier nor a system name, so the recon rules still have nothing to compare against']);
  assert.deepEqual(site.internalReaderDds, ['INREADER']);
  assert.deepEqual(site.compilerOptions, []);
}));
