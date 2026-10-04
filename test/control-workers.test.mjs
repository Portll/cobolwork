import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { analyseFile, controlAhead } from '../lib/control-workers.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-workers-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
};

const CALLER = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P1.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-IN            PIC X(80).', '       01 WS-CMD           PIC X(80).', '       PROCEDURE DIVISION.',
  '           ACCEPT WS-IN FROM COMMAND-LINE', '           IF WS-IN = SPACES', '               GOBACK', '           END-IF',
  '           MOVE WS-IN TO WS-CMD', "           CALL 'P2' USING WS-CMD", '           GOBACK.', ''].join('\n');
const CALLEE = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P2.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-LOCAL         PIC X(120).', '       COPY WSREC.', '       LINKAGE SECTION.', '       01 LK-CMD           PIC X(80).',
  '       PROCEDURE DIVISION USING LK-CMD.', '           MOVE LK-CMD TO WS-LOCAL', '           IF WS-LOCAL IS NUMERIC',
  '               DISPLAY WS-LOCAL', '           END-IF', "           CALL 'SYSTEM' USING WS-LOCAL", '           GOBACK.', ''].join('\n');
const NO_PROCEDURE = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P3.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-X             PIC X(8).', ''].join('\n');
const PLI = [' CUSTINQ: PROCEDURE OPTIONS(MAIN);', '   DCL 1 INAREA,', '         2 CUST_NAME CHAR(30),', '         2 FILLER    CHAR(10);',
  '   DCL INLEN FIXED BIN(15) INIT(40);', '   DCL SQL_TEXT CHAR(200) VARYING;', '   EXEC CICS RECEIVE INTO(INAREA) LENGTH(INLEN);',
  "   SQL_TEXT = 'SELECT BALANCE FROM ACCOUNT WHERE NAME = ''' || CUST_NAME || '''';", '   EXEC SQL PREPARE S1 FROM :SQL_TEXT;',
  '   EXEC SQL EXECUTE S1;', '   EXEC CICS RETURN;', ' END CUSTINQ;', ''].join('\n');
const FILES = { 'src/P1.cbl': CALLER, 'src/P2.cbl': CALLEE, 'src/P3.cbl': NO_PROCEDURE, 'copy/WSREC.cpy': '       01 WS-REC  PIC X(10).\n', 'other/P1.cbl': CALLER, 'src/CUSTINQ.pli': PLI };

const withVerify = (fn) => {
  const was = process.env.COBOLWORK_VERIFY_REUSE;
  process.env.COBOLWORK_VERIFY_REUSE = '1';
  try { return fn(); } finally { if (was === undefined) delete process.env.COBOLWORK_VERIFY_REUSE; else process.env.COBOLWORK_VERIFY_REUSE = was; }
};
const report = (r) => JSON.stringify({ ...r, summary: { ...r.summary, peakHeapBytes: 0 } });

test('a scan whose control analyses are built in workers reports what one built on the main thread does', () => {
  const root = tree(FILES);
  const own = scan(root, { controlWorkers: 0 });
  const built = withVerify(() => scan(root, { controlWorkers: 2, controlWorkerMinBytes: 0 }));
  assert.ok(own.findings.length > 0);
  assert.equal(report(built), report(own));
  const copies = withVerify(() => scan(root, { controlWorkers: 2, controlWorkerMinBytes: 0, reuseMinBytes: 0 }));
  assert.equal(report(copies), report(scan(root, { controlWorkers: 0, reuseMinBytes: 0 })));
  const pli = withVerify(() => scan(root, { controlWorkers: 2, controlWorkerMinBytes: 0, pli: true }));
  assert.ok(pli.findings.some((f) => f.path === 'src/CUSTINQ.pli'));
  assert.equal(report(pli), report(scan(root, { controlWorkers: 0, pli: true })));
});

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test('a worker answers each program of a file as the main thread would analyse it', () => {
  const root = tree(FILES);
  const t = directoryTree(root);
  const files = t.list().filter((f) => f.endsWith('.cbl'));
  const ahead = controlAhead(t.parseSpec, files, () => true, { workers: 1 });
  try {
    assert.equal(ahead.take(files[0], 0), null);
    pause(3000);
    const answer = ahead.take(files[1], 1);
    const own = analyseFile(t.parse(files[1]), files[1]);
    assert.equal(answer.length, own.length);
    assert.deepEqual(answer, own);
  } finally { ahead.close(); }
});

test('a file no worker has started is taken back, and one the main thread has passed is forgotten', () => {
  const root = tree(FILES);
  const t = directoryTree(root);
  const files = t.list().filter((f) => f.endsWith('.cbl'));
  const ahead = controlAhead(t.parseSpec, files, () => true, { workers: 1 });
  try {
    assert.equal(ahead.take(files[0], 0), null);
    assert.equal(ahead.take(files[2], 2), null);
    assert.equal(ahead.take(files[1], 1), null);
    pause(3000);
    assert.ok(Array.isArray(ahead.take(files[3], 3)));
  } finally { ahead.close(); }
});
