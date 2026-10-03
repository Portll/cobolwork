import './pin-machine.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { label, shifted, TRACED } from '../bench/label.mjs';
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
