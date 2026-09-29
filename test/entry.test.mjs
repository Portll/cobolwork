// What starts a program: the CICS transactions the CSD defines, the job steps that run it, and what
// those reach by CALL, LINK, XCTL and START. A mainframe team triages by transaction, and a program
// nothing here starts is one no route in the tree reaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { scanAll } from '../lib/scan.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'entry');
const report = scan(FIXTURES);
const at = (file, rule) => report.findings.filter((f) => f.path === file && (!rule || f.rule === rule));

test('a finding in a program a transaction runs names the transaction and where it is defined', () => {
  const [f] = at('INQUIRY.cbl', 'cics-terminal-to-dynamic-sql');
  assert.deepEqual(f.startedBy, [{ transaction: 'INQ1', file: 'REGION.csd', line: 2 }]);
});

test('a program another transfers to by name is started by what starts the first', () => {
  const [f] = at('REPORTS.cbl', 'cics-terminal-to-os-command');
  assert.deepEqual(f.startedBy.map((e) => e.transaction), ['MNU1']);
});

test('a job step that runs a program is its entry', () => {
  const [f] = at('NIGHTLY.cbl', 'jcl-parm-to-os-command');
  assert.deepEqual(f.startedBy, [{ job: 'NIGHTJOB', step: 'RUNIT', file: 'NIGHTLY.jcl', line: 2 }]);
});

test('a program nothing starts or names is context, and one another spells may be started through a variable', () => {
  const orphans = report.findings.filter((f) => f.rule === 'program-without-entry');
  assert.deepEqual(orphans.map((f) => [f.program, f.path, f.sev, f.evidence]), [['ORPHAN', 'ORPHAN.cbl', 'info', 'context']]);
  assert.equal(at('ORPHAN.cbl', 'argv-or-env-to-os-command')[0].startedBy, undefined);
});

test('findings are counted by the transaction and the job that reach them', () => {
  assert.deepEqual(report.summary.byTransaction, { INQ1: 1, MNU1: 1 });
  assert.deepEqual(report.summary.byJob, { 'NIGHTJOB RUNIT': 1 });
  assert.equal(report.summary.entryPoints.transactions, 2);
  assert.equal(report.summary.entryPoints.programsWithoutEntry, 1);
});

test('a whole scan puts the entry on findings of every set, not only flow', () => {
  const all = scanAll(FIXTURES, {});
  const nonFlow = all.findings.filter((f) => f.program === 'INQUIRY' && !/-to-/.test(f.rule));
  for (const f of nonFlow) assert.deepEqual(f.startedBy.map((e) => e.transaction), ['INQ1'], f.rule);
  assert.ok(all.summary.byTransaction.INQ1 >= 1);
});

test('a tree that holds no transaction and no job says nothing about what starts its programs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-entry-'));
  try {
    writeFileSync(join(dir, 'LONE.cbl'), [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. LONE.',
      '       DATA DIVISION.',
      '       WORKING-STORAGE SECTION.',
      '       01 WS-CMD PIC X(80).',
      '       PROCEDURE DIVISION.',
      '           ACCEPT WS-CMD FROM COMMAND-LINE',
      "           CALL 'SYSTEM' USING WS-CMD",
      '           GOBACK.',
      '',
    ].join('\n'));
    const r = scan(dir);
    assert.equal(r.findings.filter((f) => f.rule === 'program-without-entry').length, 0);
    assert.equal(r.summary.byTransaction, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a scan that left programs unread says nothing about what starts the rest', () => {
  // BBTARGET's only caller is past the byte budget. Read whole, the caller spells its name; read in
  // part, it would look started by nothing.
  const dir = mkdtempSync(join(tmpdir(), 'cw-entry-'));
  const program = (id, body, pad = 0) => [
    '       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       PROCEDURE DIVISION.', ...body, '           GOBACK.',
    ...Array.from({ length: pad }, () => '      * padding that puts this program past the budget'), '',
  ].join('\n');
  try {
    writeFileSync(join(dir, 'REGION.csd'), ' DEFINE TRANSACTION(T1) GROUP(G) PROGRAM(AAMAIN)\n');
    writeFileSync(join(dir, 'AAMAIN.cbl'), program('AAMAIN', ['           DISPLAY "MAIN"']));
    writeFileSync(join(dir, 'BBTARGET.cbl'), program('BBTARGET', ['           DISPLAY "TARGET"']));
    writeFileSync(join(dir, 'ZZCALLER.cbl'), program('ZZCALLER', ["           CALL 'BBTARGET'"], 60));
    const whole = scan(dir);
    assert.deepEqual(whole.findings.filter((f) => f.rule === 'program-without-entry').map((f) => f.program), ['ZZCALLER']);
    const part = scan(dir, { maxSourceBytes: 1000 });
    assert.ok(part.summary.filesOverBudget > 0, 'the caller was left unread');
    assert.deepEqual(part.findings.filter((f) => f.rule === 'program-without-entry'), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
