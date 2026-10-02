// PL/I programs through the unchanged flow engine: a planted path that must be found and its
// near-miss that must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from '../lib/sets/flow.mjs';
import { pliProgram } from '../lib/pli/program.mjs';
import './pin-machine.mjs';

const POSITIVE = ` CUSTINQ: PROCEDURE OPTIONS(MAIN);
   DCL 1 INAREA,
         2 CUST_NAME CHAR(30),
         2 FILLER    CHAR(10);
   DCL INLEN FIXED BIN(15) INIT(40);
   DCL SQL_TEXT CHAR(200) VARYING;
   EXEC CICS RECEIVE INTO(INAREA) LENGTH(INLEN);
   SQL_TEXT = 'SELECT BALANCE FROM ACCOUNT WHERE NAME = ''' || CUST_NAME || '''';
   EXEC SQL PREPARE S1 FROM :SQL_TEXT;
   EXEC SQL EXECUTE S1;
   EXEC CICS RETURN;
 END CUSTINQ;
`;

const NEGATIVE = ` CUSTINQ: PROCEDURE OPTIONS(MAIN);
   DCL 1 INAREA,
         2 CUST_NAME CHAR(30),
         2 FILLER    CHAR(10);
   DCL INLEN FIXED BIN(15) INIT(40);
   DCL SQL_TEXT CHAR(200) VARYING;
   EXEC CICS RECEIVE INTO(INAREA) LENGTH(INLEN);
   SQL_TEXT = 'SELECT BALANCE FROM ACCOUNT WHERE NAME = ?';
   EXEC SQL PREPARE S1 FROM :SQL_TEXT;
   EXEC SQL EXECUTE S1 USING :CUST_NAME;
   EXEC CICS RETURN;
 END CUSTINQ;
`;

function scanOne(text, opts, members = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pli-flow-'));
  try {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'copy'));
    writeFileSync(join(dir, 'src', 'CUSTINQ.pli'), text);
    for (const [name, body] of Object.entries(members)) writeFileSync(join(dir, 'copy', name), body);
    return scan(dir, opts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a PL/I program reads as the engine expects: items with offsets, statements and EXEC blocks', () => {
  const p = pliProgram(POSITIVE, 'CUSTINQ.pli');
  assert.equal(p.id, 'CUSTINQ');
  const name = p.items.find((i) => i.name === 'CUST_NAME');
  assert.deepEqual([name.offset, name.size, name.parent.name], [0, 30, 'INAREA']);
  assert.deepEqual(p.statements.map((s) => s.verb), ['STRING']);
  assert.deepEqual(p.execs.map((e) => e.kind), ['CICS', 'SQL', 'SQL', 'CICS']);
});

test('terminal input concatenated into a prepared statement is found in PL/I', () => {
  const r = scanOne(POSITIVE, { pli: true });
  const f = r.findings.filter((x) => x.rule === 'cics-terminal-to-dynamic-sql');
  assert.equal(f.length, 1);
  assert.equal(f[0].path, 'src/CUSTINQ.pli');
  assert.ok(f[0].trace.some((t) => t.item === 'CUST_NAME'));
});

test('the same input passed as a parameter marker is not a finding', () => {
  const r = scanOne(NEGATIVE, { pli: true });
  assert.deepEqual(r.findings.filter((x) => x.rule === 'cics-terminal-to-dynamic-sql'), []);
});

test('PL/I is read only when asked for', () => {
  const r = scanOne(POSITIVE, { pli: false });
  assert.deepEqual(r.findings.filter((x) => x.rule === 'cics-terminal-to-dynamic-sql'), []);
});

test('a structure whose members come from an %INCLUDE inside its DECLARE carries the path', () => {
  const src = POSITIVE.replace('   DCL 1 INAREA,\n         2 CUST_NAME CHAR(30),\n         2 FILLER    CHAR(10);\n', '   DCL 1 INAREA,\n   %INCLUDE INFLDS;\n');
  assert.ok(src.includes('%INCLUDE INFLDS'));
  const r = scanOne(src, { pli: true }, { 'INFLDS.inc': '         2 CUST_NAME CHAR(30),\n         2 FILLER    CHAR(10);\n' });
  const f = r.findings.filter((x) => x.rule === 'cics-terminal-to-dynamic-sql');
  assert.equal(f.length, 1);
  assert.ok(f[0].trace.some((t) => t.item === 'CUST_NAME'));
});

test('a job step\'s PARM and in-stream data reach the PL/I program it runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pli-jcl-'));
  try {
    writeFileSync(join(dir, 'CUSTLD.pli'), [
      ' CUSTLD: PROCEDURE (PARM) OPTIONS(MAIN);',
      '   DCL PARM CHAR(100) VARYING;',
      '   DCL SYSIN FILE RECORD INPUT;',
      '   DCL 1 REC, 2 NAME CHAR(30), 2 FILLER CHAR(50);',
      '   DCL (SQLTXT, CMD) CHAR(200) VARYING;',
      '   READ FILE(SYSIN) INTO(REC);',
      "   SQLTXT = 'DELETE FROM T WHERE NAME = ''' || NAME || '''';",
      '   EXEC SQL EXECUTE IMMEDIATE :SQLTXT;',
      '   CMD = SUBSTR(PARM, 1, 8);',
      '   EXEC SQL PREPARE S2 FROM :CMD;',
      ' END CUSTLD;',
    ].join('\n'));
    writeFileSync(join(dir, 'RUN.jcl'), "//PLIJOB  JOB (ACCT),'TEST'\n//STEP1   EXEC PGM=CUSTLD,PARM='ABC'\n//SYSIN   DD *\nSMITH\n/*\n");
    const rules = new Set(scan(dir, { pli: true }).findings.map((f) => f.rule));
    assert.ok(rules.has('jcl-instream-to-dynamic-sql'));
    assert.ok(rules.has('jcl-parm-to-dynamic-sql'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('EXEC SQL INCLUDE SQLCA declares IBM\'s PL/I SQLCA, and its SQLERRM text reaching the screen is found', () => {
  const src = (assign) => ` CUSTINQ: PROCEDURE OPTIONS(MAIN);
   DCL MSG CHAR(80);
   EXEC SQL INCLUDE SQLCA;
   EXEC SQL OPEN C1;
   IF SQLCODE ^= 0 THEN DO;
     ${assign}
     EXEC CICS SEND TEXT FROM(MSG) ERASE;
   END;
 END CUSTINQ;
`;
  const p = pliProgram(src('MSG = SQLERRM;'), 'CUSTINQ.pli');
  const errm = p.items.find((i) => i.name === 'SQLERRM');
  assert.deepEqual([errm.parent.name, errm.offset, errm.line], ['SQLCA', 16, 3]);
  const rule = (text) => scanOne(text, { pli: true }).findings.filter((x) => x.rule === 'system-response-to-screen').length;
  assert.equal(rule(src('MSG = SQLERRM;')), 1);
  assert.equal(rule(src("MSG = 'DATABASE ERROR';")), 0);
});
