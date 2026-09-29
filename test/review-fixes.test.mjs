// One case per defect an independent review of 2026-09-18 reported and reproduced. Each test is
// named for the wrong behaviour, so a regression says which finding came back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAll } from '../lib/scan.mjs';
import { inventory } from '../lib/inventory.mjs';
import { scanCopybooks } from '../lib/sets/copybook.mjs';
import { diffRefs } from '../lib/diff.mjs';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = (t) => mkdtempSync(join(tmpdir(), `cw-rf-${t}-`));
const write = (dir, name, text) => { const p = join(dir, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); return p; };
const rules = (dir, only = ['flow']) => scanAll(dir, { only }).summary.byRule;
const head = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.'];
const run = (dir, body, ws = []) => [...head, ...ws, '       PROCEDURE DIVISION.', ...body, '           GOBACK.', ''].join('\n');
const inTmp = (t, fn) => { const dir = tmp(t); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('a qualified CALL argument does not put the sink on the whole record', () => {
  inTmp('qual', (dir) => {
    write(dir, 'Q.cbl', run(dir, ["           ACCEPT WS-IN FROM COMMAND-LINE", '           MOVE WS-IN TO REQ-USER OF REQ', "           CALL 'SYSTEM' USING REQ-CMD OF REQ"],
      ['       01 WS-IN      PIC X(40).', '       01 REQ.', '          05 REQ-USER PIC X(20).', "          05 REQ-CMD  PIC X(20) VALUE 'ls'."]));
    assert.deepEqual(rules(dir), {}, 'the command field is never written from input');
  });
});

test('a qualified argument does not shift the arguments after it', () => {
  inTmp('shift', (dir) => {
    write(dir, 'M.cbl', [...head, '       01 WS-HDR.', '          05 WS-MODE PIC X(4).', '       01 WS-ARG PIC X(40).',
      '       PROCEDURE DIVISION.', '           ACCEPT WS-ARG FROM COMMAND-LINE', "           CALL 'RUNNER' USING WS-MODE OF WS-HDR WS-ARG", '           GOBACK.', ''].join('\n'));
    write(dir, 'RUNNER.cbl', ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. RUNNER.', '       DATA DIVISION.', '       LINKAGE SECTION.',
      '       01 LK-MODE PIC X(4).', '       01 LK-CMD PIC X(40).', '       PROCEDURE DIVISION USING LK-MODE LK-CMD.', "           CALL 'SYSTEM' USING LK-CMD", '           GOBACK.', ''].join('\n'));
    assert.deepEqual(rules(dir), { 'argv-or-env-to-os-command': 1 }, 'argument 2 must still map to parameter 2');
  });
});

test('a value passed through an intrinsic function keeps its taint, and a subscript is not data', () => {
  inTmp('func', (dir) => {
    write(dir, 'F.cbl', run(dir, ['           ACCEPT WS-IN FROM COMMAND-LINE', '           MOVE FUNCTION TRIM(WS-IN) TO WS-CMD', "           CALL 'SYSTEM' USING WS-CMD"],
      ['       01 WS-IN  PIC X(40).', '       01 WS-CMD PIC X(60).']));
    assert.deepEqual(rules(dir), { 'argv-or-env-to-os-command': 1 });
  });
  inTmp('sub', (dir) => {
    write(dir, 'S.cbl', run(dir, ['           ACCEPT WS-IDX FROM COMMAND-LINE', '           MOVE WS-ROW(WS-IDX) TO WS-CMD', "           CALL 'SYSTEM' USING WS-CMD"],
      ['       01 WS-TAB.', '          05 WS-ROW PIC X(4) OCCURS 5.', '       01 WS-IDX PIC 9(2) VALUE 1.', '       01 WS-CMD PIC X(60).']));
    // The command is clean: a subscript chooses which element, it is not the data moved. That the
    // command line chooses the element, unchecked, is a finding of its own.
    assert.deepEqual(rules(dir), { 'argv-or-env-to-subscript': 1 }, 'a subscript chooses which element, it is not the data moved');
  });
});

test('a host variable in a WHERE clause is not a database value', () => {
  inTmp('where', (dir) => {
    write(dir, 'W.cbl', run(dir, ['           EXEC CICS RECEIVE INTO(WS-ID) LENGTH(WS-LEN) END-EXEC',
      '           EXEC SQL SELECT NAME INTO :WS-NAME FROM CUSTOMER', '                WHERE ID = :WS-ID END-EXEC',
      "           CALL 'EZASOKET' USING 'SEND' WS-SOCK WS-FLAGS WS-LEN", '                WS-ID WS-ERRNO WS-RC'],
      ['       01 WS-ID    PIC X(9).', '       01 WS-NAME  PIC X(30).', '       01 WS-SOCK  PIC 9(4) COMP.', '       01 WS-FLAGS PIC 9(8) COMP VALUE 0.',
        '       01 WS-LEN   PIC 9(8) COMP VALUE 9.', '       01 WS-ERRNO PIC 9(8) COMP.', '       01 WS-RC    PIC S9(8) COMP.']));
    assert.deepEqual(rules(dir), {}, 'terminal input in a WHERE clause is not data at rest leaving the system');
  });
});

test('MQPUT1 puts its buffer sixth, and a socket function code may be a field', () => {
  const mq = (verb) => run(null, ['           EXEC SQL SELECT SSN INTO :WS-SSN FROM PEOPLE', '                WHERE ID = 1 END-EXEC',
    '           MOVE WS-SSN TO WS-MSG', `           CALL '${verb}' USING HCONN HOBJ MQMD MQPMO WS-LEN WS-MSG`, '                WS-CC WS-RC'],
  ['       01 WS-SSN PIC X(9).', '       01 WS-MSG PIC X(100).', '       01 HCONN PIC S9(9) BINARY.', '       01 HOBJ PIC S9(9) BINARY.',
    '       01 MQMD PIC X(364).', '       01 MQPMO PIC X(152).', '       01 WS-LEN PIC S9(9) BINARY VALUE 100.', '       01 WS-CC PIC S9(9) BINARY.', '       01 WS-RC PIC S9(9) BINARY.']);
  for (const verb of ['MQPUT', 'MQPUT1']) {
    inTmp(verb, (dir) => {
      write(dir, 'Q.cbl', mq(verb));
      assert.deepEqual(rules(dir), { 'database-to-message-queue': 1 }, verb);
    });
  }
  inTmp('sockvar', (dir) => {
    write(dir, 'V.cbl', run(null, ['           EXEC SQL SELECT SSN INTO :WS-SSN FROM PEOPLE', '                WHERE ID = 1 END-EXEC',
      '           CALL \'EZASOKET\' USING SOC-FUNCTION WS-SOCK WS-FLAGS WS-LEN', '                WS-SSN WS-ERRNO WS-RC'],
    ["       01 SOC-FUNCTION PIC X(16) VALUE 'SEND'.", '       01 WS-SSN PIC X(9).', '       01 WS-SOCK PIC 9(4) COMP.',
      '       01 WS-FLAGS PIC 9(8) COMP VALUE 0.', '       01 WS-LEN PIC 9(8) COMP VALUE 9.', '       01 WS-ERRNO PIC 9(8) COMP.', '       01 WS-RC PIC S9(8) COMP.']));
    assert.deepEqual(rules(dir), { 'database-to-socket-send': 1 }, "IBM's own examples hold the function code in a field");
  });
});

test('REDEFINES names a sibling, not the first item of that name in the program', () => {
  const two = (writeTo, readFrom) => run(null, [`           ACCEPT F-DATA OF ${writeTo} FROM COMMAND-LINE`, `           CALL 'SYSTEM' USING F-TEXT OF ${readFrom}`],
    ['       01 REC-A.', '          05 F-DATA PIC X(20).', '          05 F-TEXT REDEFINES F-DATA PIC X(20).',
      '       01 REC-B.', '          05 F-DATA PIC X(20).', '          05 F-TEXT REDEFINES F-DATA PIC X(20).']);
  inTmp('redef-fp', (dir) => { write(dir, 'D.cbl', two('REC-A', 'REC-B')); assert.deepEqual(rules(dir), {}, 'the overlay in one record is not the overlay in another'); });
  inTmp('redef-fn', (dir) => { write(dir, 'D.cbl', two('REC-B', 'REC-B')); assert.deepEqual(rules(dir), { 'argv-or-env-to-os-command': 1 }, 'the same record read two ways'); });
});

test('a RENAMES alias is reached by a value that reaches what it covers', () => {
  inTmp('ren', (dir) => {
    write(dir, 'R.cbl', [...head.slice(0, 4), '       01 WS-LINE.', "          05 WS-VERB PIC X(8) VALUE 'ls '.", '          05 WS-ARG  PIC X(40).',
      '       66 WS-CMD RENAMES WS-VERB THRU WS-ARG.', '       PROCEDURE DIVISION.', '           ACCEPT WS-ARG FROM COMMAND-LINE',
      "           CALL 'SYSTEM' USING WS-CMD", '           GOBACK.', ''].join('\n'));
    assert.deepEqual(rules(dir), { 'argv-or-env-to-os-command': 1 });
  });
});

test('two programs sharing a copybook sink are two findings, and each names its program', () => {
  inTmp('shared', (dir) => {
    write(dir, 'RUNCMD.cpy', "           CALL 'SYSTEM' USING WS-CMD\n");
    for (const id of ['PA', 'PB']) {
      write(dir, `${id}.cbl`, ['       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
        '       01 WS-CMD PIC X(80).', '       PROCEDURE DIVISION.', '           ACCEPT WS-CMD FROM COMMAND-LINE', '           COPY RUNCMD.', '           GOBACK.', ''].join('\n'));
    }
    const r = scanAll(dir, { only: ['flow'] });
    assert.deepEqual(r.findings.map(f => f.program).sort(), ['PA', 'PB'], 'the merge key must hold the program');
  });
});

test('an absent copybook whose name merely starts like a system one is missing, not covered', () => {
  inTmp('sysprefix', (dir) => {
    write(dir, 'S.cbl', [...head, '       COPY ATTRIBUTES.', '       COPY DLIPCBMASK.', '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n'));
    const inv = inventory(dir);
    assert.equal(inv.summary.copiesMissing, 2);
    assert.equal(inv.summary.copiesSystem, 0);
    assert.equal(inv.summary.coverageIncomplete, true);
  });
});

test('CICS rules see a program whose EXEC CICS comes from a copybook, and report it at the copybook', () => {
  inTmp('cicsloc', (dir) => {
    write(dir, 'COMMLK.cpy', '       01 DFHCOMMAREA.\n          05 CM-FIELD PIC X(8).\n');
    write(dir, 'XFERPROC.cpy', '           EXEC CICS XCTL PROGRAM(WS-PGM) END-EXEC\n');
    write(dir, 'MAINP.cbl', ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. MAINP.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
      '       01 WS-PGM PIC X(8).', '       LINKAGE SECTION.', '       COPY COMMLK.', '       PROCEDURE DIVISION.', '           MOVE CM-FIELD TO WS-PGM',
      '           COPY XFERPROC.', '           GOBACK.', ''].join('\n'));
    const r = scanAll(dir, { only: ['cics'] });
    assert.deepEqual(r.findings.map(f => `${f.rule}@${f.path}`).sort(),
      ['cics-commarea-without-length-check@COMMLK.cpy', 'cics-transfer-to-variable-program@XFERPROC.cpy']);
  });
});

test('copybook layouts compare by the format of the file, and users come from the parse', () => {
  inTmp('tags', (dir) => {
    for (const [d, tag] of [['a', 'CR1001'], ['b', 'JH0917']]) {
      write(dir, `${d}/CUSTREC.cpy`, `000100 01  CUST-REC.${' '.repeat(52)}${tag}\n000200     05  CUST-ID   PIC X(8).${' '.repeat(40)}${tag}\n`);
    }
    assert.deepEqual(scanCopybooks(dir).findings, [], 'a change tag is not a layout');
  });
  inTmp('nested', (dir) => {
    for (const [d, len] of [['a', 10], ['b', 12]]) {
      write(dir, `${d}/OUTER.cpy`, '       COPY INNER.\n');
      write(dir, `${d}/INNER.cpy`, `       01 CUST-REC PIC X(${len}).\n`);
      write(dir, `${d}/P${d}.cbl`, [...head.slice(0, 2), `       PROGRAM-ID. P${d}.`, ...head.slice(2), '       COPY OUTER.', '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n'));
    }
    const f = scanCopybooks(dir).findings.find(x => x.name === 'INNER');
    assert.ok(f, 'a copybook reached through another copybook is still resolved');
    assert.equal(f.split, true);
    assert.equal(f.sev, 'med');
  });
  inTmp('comment', (dir) => {
    write(dir, 'DFHAID.cpy', '       01 DFHAID-X PIC X.\n');
    write(dir, 'BATCH.cbl', ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. BATCH.', '      * COPY DFHAID is not used here', '       DATA DIVISION.',
      '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n'));
    const f = scanCopybooks(dir).findings.find(x => x.rule === 'copybook-shadows-system');
    assert.equal(f.users, 0, 'a commented-out COPY is not a use');
    assert.equal(f.sev, 'low');
  });
});

test('diff: an unreadable program is not a fix, a second instance shows, and an unchanged finding does not churn', () => {
  const dir = tmp('diffcmp');
  const git = (...a) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  try {
    const prog = (calls) => ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
      '       01 WS-CMD PIC X(80).', '       PROCEDURE DIVISION.', '           ACCEPT WS-CMD FROM COMMAND-LINE', ...calls, '           GOBACK.', ''].join('\n');
    write(dir, 'P.cbl', prog(["           CALL 'SYSTEM' USING WS-CMD"]));
    write(dir, '.gitignore', 'build/\n');
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
    // A second, identical sink in the same program: one more finding, not the same one.
    write(dir, 'P.cbl', prog(["           CALL 'SYSTEM' USING WS-CMD", "           CALL 'SYSTEM' USING WS-CMD"]));
    const r = diffRefs(dir, 'HEAD', null, { only: ['flow'] });
    assert.equal(r.summary.introduced, 1, 'multiplicity is compared, not membership');
    assert.equal(r.summary.resolved, 0, 'the first finding did not go anywhere');

    // An ignored build directory is not part of the comparison: it cannot be in any revision.
    write(dir, 'build/EXTRA.cbl', prog(["           CALL 'SYSTEM' USING WS-CMD"]));
    const r2 = diffRefs(dir, 'HEAD', null, { only: ['flow'] });
    assert.equal(r2.summary.introduced, 1, 'still just the added call, not the ignored copy');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('diff: EXEC CICS RETURN COMMAREA is an interface record', () => {
  const dir = tmp('iface');
  const git = (...a) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  try {
    const rec = (n) => `       01  WS-COMM.\n           05  WS-STATE  PIC X(${n}).\n`;
    write(dir, 'COMM.cpy', rec(8));
    write(dir, 'T.cbl', ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. T.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
      '       COPY COMM.', '       PROCEDURE DIVISION.', "           EXEC CICS RETURN TRANSID('MENU') COMMAREA(WS-COMM)", '                LENGTH(8) END-EXEC', '           GOBACK.', ''].join('\n'));
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
    write(dir, 'COMM.cpy', rec(16));
    const r = diffRefs(dir, 'HEAD', null, { only: ['flow'] });
    assert.equal(r.findings[0].rule, 'diff-interface-layout-changed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the output format is checked, and a command with no SARIF form says so', () => {
  const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'bin', 'cobolwork.mjs'), ...args], { encoding: 'utf8' });
  const bad = cli('scan', ROOT, '--format', 'sraif');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--format takes json,sarif/);
  const noSarif = cli('flow', ROOT, '--format', 'sarif');
  assert.equal(noSarif.status, 2);
  assert.match(noSarif.stderr, /no SARIF form/);
});

test('findings are ordered the same way whatever the locale', () => {
  inTmp('locale', (dir) => {
    for (const id of ['AAPAY', 'ZPAY']) {
      write(dir, `${id}.cbl`, ['       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
        '       01 WS-CMD PIC X(80).', '       PROCEDURE DIVISION.', '           ACCEPT WS-CMD FROM COMMAND-LINE', "           CALL 'SYSTEM' USING WS-CMD", '           GOBACK.', ''].join('\n'));
    }
    const of = (locale) => {
      const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'cobolwork.mjs'), 'scan', dir, '--only', 'flow', '--quiet'],
        { encoding: 'utf8', env: { ...process.env, LC_ALL: locale, LANG: locale } });
      return r.stdout;
    };
    assert.equal(of('en_US.UTF-8'), of('da_DK.UTF-8'), 'the same input must give the same bytes');
  });
});

test('a scan reads nothing outside the tree it was given', () => {
  inTmp('reads', (dir) => {
    write(dir, 'P.cbl', run(null, ['           DISPLAY WS-X'], ['       COPY SCREENIO.', '       01 WS-X PIC X.']));
    const inv = inventory(dir);
    const r = scanAll(dir, { only: ['flow'] });
    assert.equal(inv.summary.copiesMissing, 1, 'a copybook outside the tree is missing, not quietly read from a compiler installation');
    assert.equal(r.summary.nosrc, false);
  });
});

test('an EXEC block whose terminator falls past column 72 is reported, not silently swallowed', () => {
  inTmp('unclosed', (dir) => {
    // 77 characters: END-EXEC starts at column 70 and runs past the end of the text area, so the
    // compiler never sees it either. What must not happen is reading the rest of the program as SQL
    // and saying nothing.
    const long = `           EXEC SQL SELECT SSN INTO :WS-SSN FROM PEOPLE WHERE ID = 1 END-EXEC`;
    const p = write(dir, 'U.cbl', run(null, [long, "           CALL 'SYSTEM' USING WS-SSN"], ['       01 WS-SSN PIC X(9).']));
    assert.ok(p);
    const inv = inventory(dir);
    assert.equal(inv.summary.filesScanned, 1);
    const r = scanAll(dir, { only: ['flow'] });
    assert.equal(r.summary.nosrc, false);
  });
});

test('an 01 that redefines another 01 is the same bytes — the shape a message buffer uses', () => {
  inTmp('redef01', (dir) => {
    write(dir, 'R.cbl', [...head.slice(0, 4), '       01 MQS-BUFFER-INOUT PIC X(100).', '       01 MQS-MOTOR-MESSAGE REDEFINES MQS-BUFFER-INOUT.',
      '          05 MM-TEXT PIC X(100).', '       01 WS-SSN PIC X(9).', '       PROCEDURE DIVISION.',
      '           EXEC SQL SELECT SSN INTO :WS-SSN FROM PEOPLE', '                WHERE ID = 1 END-EXEC',
      '           MOVE WS-SSN TO MM-TEXT', "           CALL 'SYSTEM' USING MQS-BUFFER-INOUT", '           GOBACK.', ''].join('\n'));
    assert.deepEqual(rules(dir), { 'database-to-os-command': 1 }, 'resolving REDEFINES only within a group lost this');
  });
});
