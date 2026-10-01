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
