// A callee that declares more than its caller passes reaches past the argument on every call. The
// fixture's one caller makes five calls: two that fall short, and three shapes that must not be
// reported - a variable table, a program id defined twice, and a value passed BY VALUE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'callsize');
const report = scan(FIXTURES);
const of = (rule) => report.findings.filter(f => f.rule === rule);

test('a parameter longer than the whole record passed is reported high', () => {
  const f = of('call-parameter-exceeds-caller-record');
  assert.equal(f.length, 1);
  assert.equal(f[0].path, 'CALLER.cbl');
  assert.equal(f[0].line, 13);
  assert.equal(f[0].sev, 'high');
  assert.equal(f[0].evidence, 'construct');
  assert.equal(f[0].cwe, 'CWE-805');
  assert.deepEqual(f[0].arguments, [{ position: 2, argument: 'WS-SHORT', argumentBytes: 5, bytesToEndOfRecord: 5, parameter: 'LK-AREA', parameterBytes: 20 }]);
  assert.deepEqual(f[0].related, [{ path: 'CALLEE.cbl', line: 6, detail: 'CALLEE declares LK-AREA as 20 bytes' }]);
});

test('a parameter that stays inside the caller\'s record is reported low, as its neighbours', () => {
  const f = of('call-parameter-exceeds-argument');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 13);
  assert.equal(f[0].sev, 'low');
  assert.equal(f[0].cwe, 'CWE-628');
  assert.deepEqual(f[0].arguments, [{ position: 1, argument: 'WS-DATE', argumentBytes: 8, bytesToEndOfRecord: 18, parameter: 'LK-DATE', parameterBytes: 10 }]);
});

const pair = (callerWs, callerUsing, calleeBody, callerLinkage = []) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-callsize-'));
  writeFileSync(join(root, 'CALLER.cbl'), ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. CALLER.', '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.', ...callerWs, ...(callerLinkage.length ? ['       LINKAGE SECTION.', ...callerLinkage] : []),
    '       PROCEDURE DIVISION.', `           CALL 'STRLTH' USING ${callerUsing}`, '           GOBACK.', ''].join('\n'));
  writeFileSync(join(root, 'STRLTH.cbl'), ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. STRLTH.', '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.', '       01 WS-N PIC 9(4).', '       LINKAGE SECTION.', '       01 TEXT1 PIC X(255).',
    '       PROCEDURE DIVISION USING TEXT1.', ...calleeBody, '           GOBACK.', ''].join('\n'));
  return scan(root).findings.filter((f) => f.rule === 'call-parameter-exceeds-caller-record');
};

test('a callee that only reads past what its caller passed is low', () => {
  // The shape read in the 500-repository corpus on 2026-09-27: STRLTH measures a 255-byte text and
  // its caller passes the last 254-byte field of its record.
  const [reads] = pair(['       01 REC.', '          05 COMMENTS PIC X(254).'], 'COMMENTS', ['           MOVE LENGTH OF TEXT1 TO WS-N']);
  assert.equal(reads.sev, 'low');
  assert.match(reads.detail, /STRLTH only reads past it$/);
  const [writes] = pair(['       01 REC.', '          05 COMMENTS PIC X(254).'], 'COMMENTS', ['           MOVE SPACES TO TEXT1']);
  assert.equal(writes.sev, 'high');
});

test('an argument in storage the caller addressed through a pointer has no size to compare', () => {
  const found = pair(['       01 BUF-PTR POINTER.'], 'DFH-BODY', ['           MOVE SPACES TO TEXT1'], ['       01 DFH-BODY PIC X.']);
  assert.deepEqual(found, []);
});

test('an exact match, a variable table, a twice-defined callee and BY VALUE are not reported', () => {
  const lines = report.findings.filter(f => f.rule.startsWith('call-parameter-')).map(f => f.line);
  assert.deepEqual([...new Set(lines)], [13], 'only the CALL on line 13 falls short');
});
