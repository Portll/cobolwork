import './pin-machine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argvRewritten, label, restedOn, shifted, TRACED } from '../bench/label.mjs';
import { SINK_KINDS } from '../lib/dataflow.mjs';
import { verifyEvidence } from '../lib/evidence/verify.mjs';
import { MARKER } from '../lib/verify.mjs';

const IRONWORK = process.env.COBOLWORK_IRONWORK;
const FIXTURE = join(import.meta.dirname, 'fixtures', 'label', 'batch');

test('every field of eight bytes or more holds the marker in one of the eight shifts', () => {
  for (let offset = 0; offset < 40; offset++) {
    const holding = [...Array(MARKER.length).keys()].filter((k) => shifted(k).slice(offset, offset + MARKER.length) === MARKER);
    assert.equal(holding.length, 1, `offset ${offset}`);
  }
});

test('a label carries the assumptions its runs could have rested on, once each, and none where the journals name none', () => {
  assert.deepEqual(restedOn({ assumptions: ['C12', 'C1'] }, { assumptions: ['C1', 'L19'] }), { assumptions: ['C1', 'C12', 'L19'] });
  assert.deepEqual(restedOn({ assumptions: [] }, {}), {});
  assert.deepEqual(restedOn(), {});
});

test('the labeller names only sink kinds cobolwork has', () => {
  for (const kind of Object.keys(TRACED)) assert.ok(Object.hasOwn(SINK_KINDS, kind), kind);
});

test('a finding is confirmed where the marker reached its operation, and unknown where the run did not get there', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(FIXTURE, { ironwork: IRONWORK, evidence });
  const by = Object.fromEntries(out.labels.map((l) => [l.path, l]));
  assert.equal(by['PGMREAD.cbl'].label, 'confirmed');
  assert.equal(by['PGMREAD.cbl'].variant, 'records shifted 7', 'WS-PGM starts one byte into the record');
  assert.equal(by['PGMGATE.cbl'].label, 'unknown');
  assert.equal(by['PGMGATE.cbl'].why, 'the run did not reach the operation');
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('a job\'s in-stream data is fed through its DD, and a program of more than 18 digits runs under ARITH(EXTEND)', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'instream'), { ironwork: IRONWORK, evidence });
  assert.deepEqual(out.labels.map((l) => [l.rule, l.line, l.label]).sort(), [
    ['file-record-to-dynamic-program-load', 20, 'confirmed'],
    ['jcl-instream-to-dynamic-program-load', 20, 'confirmed'],
  ]);
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('in-stream data is labelled by running its job, with the data set an earlier step writes, an empty generation and an empty cluster in place', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  // CTLUSE gives up unless STEP010's data set, a generation of CWJOB.HIST and the cluster
  // CWJOB.REF.MASTER all open, so neither operation runs unless the job was prepared whole.
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'job'), { ironwork: IRONWORK, evidence });
  const jobs = out.labels.filter((l) => l.rule.startsWith('jcl-instream'));
  assert.deepEqual(jobs.map((l) => [l.rule, l.path, l.line, l.labelledOn, l.job, l.label, l.variant, !!l.control]).sort(), [
    ['jcl-instream-to-arithmetic', 'CTLUSE.cbl', 46, 'job', 'CTLJOB.jcl', 'confirmed', 'in-stream asterisks', true],
    ['jcl-instream-to-dynamic-program-load', 'CTLUSE.cbl', 47, 'job', 'CTLJOB.jcl', 'confirmed', 'in-stream shifted 0', false],
  ]);
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('a job runs only through the finding\'s step, and a job ironwork refuses before that step falls back to the program alone, saying why', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  // LATER.jcl's STEP020 runs IEBCOPY, which ironwork refuses, after the finding's step and inside
  // an IF; REFUSED.jcl's own step names a symbol with no value.
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'jobfallback'), { ironwork: IRONWORK, evidence });
  const jobs = out.labels.filter((l) => l.rule.startsWith('jcl-instream'));
  assert.deepEqual(jobs.map((l) => [l.path, l.labelledOn, l.label, l.variant, l.jobNotRun]).sort(), [
    ['LATERPGM.cbl', 'job', 'confirmed', 'in-stream shifted 0', undefined],
    ['REFPGM.cbl', undefined, 'confirmed', 'records shifted 0', 'ironwork refuses the job: REFUSED.jcl:6: IWJ0006-S symbolic parameter &HLQ has no value'],
  ]);
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('a program ironwork reads only under --compliance extended runs there, and its label says so', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'renames'), { ironwork: IRONWORK, evidence });
  assert.deepEqual(out.labels.map((l) => [l.rule, l.label, l.labelledOn]), [['file-record-to-dynamic-program-load', 'confirmed', 'extended']]);
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('taint\'s answer at an operation the marker missed is recorded, and the finding stays unknown', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  // The IF always overwrites WS-PGM in this program, which no run shows of every program like it.
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'overwritten'), { ironwork: IRONWORK, evidence, traceInput: true });
  assert.deepEqual(out.labels.map((l) => [l.rule, l.label, l.inputAtSink]), [['file-record-to-dynamic-program-load', 'unknown', false]]);
  assert.deepEqual(out.inputAtSink, { true: 0, false: 1, null: 0 });
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('terminal input typed into a map reaches the log in the task the pseudo-conversation starts', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'cics'), { ironwork: IRONWORK, evidence });
  assert.deepEqual(out.labels.map((l) => [l.rule, l.path, l.line, l.label, l.variant]), [['cics-terminal-to-log', 'NAMEPGM.cbl', 21, 'confirmed', 'the marker in every unprotected field']]);
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('raw terminal input names the program LINK runs, and asterisks in a quantity end the COMPUTE that digits pass', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'raw'), { ironwork: IRONWORK, evidence });
  const by = Object.fromEntries(out.labels.map((l) => [l.path, l]));
  assert.equal(by['RAWPGM.cbl'].label, 'confirmed');
  assert.equal(by['QTYPGM.cbl'].rule, 'cics-terminal-to-arithmetic');
  assert.equal(by['QTYPGM.cbl'].label, 'confirmed');
  assert.ok(by['QTYPGM.cbl'].control, 'the run with digits is kept as the control');
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('nines past a table or field end the run under SSRANGE at the operation, and ones pass it', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'storage'), { ironwork: IRONWORK, evidence });
  assert.deepEqual(out.labels.map((l) => [l.rule, l.path, l.line, l.label, l.variant, !!l.control]).sort(), [
    ['cics-terminal-to-reference-modification', 'CUTPGM.cbl', 16, 'confirmed', 'typed after the transaction, nines', true],
    ['cics-terminal-to-subscript', 'ROWPGM.cbl', 16, 'confirmed', 'typed after the transaction, nines', true],
  ]);
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('the command line and environment become MOVEs in the columns they held, and an ACCEPT a MOVE cannot stand for is named', () => {
  const lines = [
    '           ACCEPT WS-ARG FROM COMMAND-LINE END-ACCEPT',
    '           ACCEPT WS-ARG(1:4) FROM ARGUMENT-VALUE.',
    "           ACCEPT WS-HOME FROM ENVIRONMENT 'HOME'",
    '           DISPLAY "MT_HOME" UPON environment-name',
    '           ACCEPT MT_HOME FROM environment-value',
    '           ACCEPT WS-COUNT FROM ARGUMENT-NUMBER',
    '           ACCEPT WS-CARD',
  ];
  const out = argvRewritten(lines.join('\n'), MARKER).text.split('\n');
  assert.deepEqual(out.map((l) => l.length), lines.map((l) => l.length));
  assert.deepEqual(out.map((l) => l.trim().replace(/ +/g, ' ')), [
    `MOVE ALL '${MARKER}' TO WS-ARG`,
    `MOVE ALL '${MARKER}' TO WS-ARG(1:4) .`,
    `MOVE ALL '${MARKER}' TO WS-HOME`,
    'DISPLAY "MT_HOME"',
    `MOVE ALL '${MARKER}' TO MT_HOME`,
    'MOVE 1 TO WS-COUNT',
    'ACCEPT WS-CARD',
  ]);
  assert.equal(argvRewritten("           ACCEPT WS-HOME FROM ENVIRONMENT\n               'HOME'", MARKER).why, 'an ACCEPT FROM ENVIRONMENT names its variable on another line');
  assert.equal(argvRewritten("           ACCEPT WS-HOME FROM ENVIRONMENT 'HOME'\n               ON EXCEPTION CONTINUE", MARKER).why,
    'an ACCEPT of the command line or environment goes on past its line, with an EXCEPTION phrase or END-ACCEPT, which a MOVE does not take');
  assert.equal(argvRewritten('           ACCEPT WS-CARD', MARKER).why, 'no ACCEPT of the command line or environment was found to rewrite');
});

test('command-line and environment input is moved into a rewritten copy and labelled as its own stratum, the program\'s SYSIN holding the control', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'argv'), { ironwork: IRONWORK, evidence });
  assert.deepEqual(out.labels.map((l) => [l.path, l.line, l.labelledOn, l.label, l.variant ?? l.why]).sort(), [
    ['ARGLOAD.cbl', 10, 'rewritten', 'confirmed', 'command line or environment rotated 0'],
    ['ENVGUARD.cbl', 10, 'rewritten', 'unknown', 'an ACCEPT of the command line or environment goes on past its line, with an EXCEPTION phrase or END-ACCEPT, which a MOVE does not take'],
    ['ENVLOAD.cbl', 8, 'rewritten', 'confirmed', 'command line or environment rotated 0'],
  ]);
  assert.equal(verifyEvidence(evidence).verified, true);
});

test('a file a SELECT assigns from a data item is traced under --compliance extended, its labels a stratum of their own and with command-line input the rewritten one besides; a CICS FILE option is not traced', { skip: !IRONWORK || !existsSync(IRONWORK) ? 'COBOLWORK_IRONWORK names no ironwork binary' : false }, (t) => {
  const evidence = mkdtempSync(join(tmpdir(), 'cobolwork-label-test-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  const out = label(join(import.meta.dirname, 'fixtures', 'label', 'dynfile'), { ironwork: IRONWORK, evidence });
  assert.deepEqual(out.labels.map((l) => [l.rule, l.path, l.line, l.labelledOn, l.label, l.variant]).sort(), [
    ['argv-or-env-to-dynamic-file-path', 'ARGFILE.cbl', 6, 'rewritten+extended', 'confirmed', 'command line or environment rotated 0'],
    ['cics-terminal-to-dynamic-file-path', 'CICSREAD.cbl', 10, undefined, 'unknown', undefined],
    ['file-record-to-dynamic-file-path', 'DYNOUT.cbl', 7, 'extended', 'confirmed', 'records shifted 0'],
  ]);
  assert.equal(out.labels.find((l) => l.path === 'CICSREAD.cbl').why, 'ironwork traces a file named at run time in SELECT ... ASSIGN, not in an EXEC CICS FILE or DATASET option');
  assert.equal(verifyEvidence(evidence).verified, true);
});
