import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const SOURCES = [
  " DCL 1 S BASED(P), 2 A(0:9) FIXED BIN(31) INIT((10)0), 2 B CHAR(8) VAR, 2 C PIC 'S(4)9V99';",
  ' DCL (A, (B, C) FIXED) BIN, F ENTRY (FIXED BIN(31), CHAR(*)) RETURNS (FIXED BIN(31)) OPTIONS(ASM);',
  ' 05 X CHAR(6144), 10 Y CHAR(1024);',
  ' MAIN: PROCEDURE (PARM) OPTIONS(MAIN, REENTRANT) REORDER RETURNS (FIXED BIN(31));',
  ' E: ENTRY (A, B) RETURNS (CHAR(8));',
  ' END MAIN;',
  ' A, B.C(I + 1)->D = SUBSTR(S, 1, LENGTH(T)) || (3)\'AB\', BY NAME;',
  ' X += Y ** -2 * (Z - 1);',
  ' IF A = B & ¬EOF THEN DO;',
  ' ELSE IF X > 0 THEN CALL P(X, Y(*));',
  ' DO I = 1 TO N BY 2 WHILE (OK), 20 REPEAT I * 2 UNTIL (DONE);',
  ' SELECT (CODE);',
  ' WHEN (1, 2) GO TO L(3);',
  ' OTHERWISE RETURN (X + 1);',
  ' CALL PLITDLI (THREE, GU, PCB, IO_AREA, SSA1);',
  ' FETCH MOD SET(P) TITLE(NAME);',
  ' OPEN FILE(IN) INPUT RECORD SEQUENTIAL, FILE(OUT) OUTPUT TITLE(DSN) ENV(VB RECSIZE(100));',
  ' READ FILE(IN) INTO(REC) KEY(K) NOLOCK;',
  ' WRITE FILE(OUT) FROM(REC) KEYFROM(K);',
  " PUT FILE(SYSPRINT) SKIP(2) EDIT ('TOTAL', (A(I) DO I = 1 TO N)) (A, (N) F(5,2), X(2), P'ZZ9V99');",
  ' GET STRING(BUF) LIST(A, B);',
  " DISPLAY ('ENTER CODE') REPLY(ANSWER);",
  ' ON ENDFILE(IN) EOF = \'1\'B;',
  ' ON ERROR SNAP BEGIN;',
  ' SIGNAL CONDITION(BAD);',
  ' L: FORMAT (A(5), SKIP, COL(10), F(7,2));',
];

// Every way of dropping, doubling or swapping one token, and of cutting the statement short.
function* mutations(toks) {
  for (let i = 0; i < toks.length; i++) {
    yield toks.filter((_, k) => k !== i);
    yield [...toks.slice(0, i + 1), toks[i], ...toks.slice(i + 1)];
    if (i + 1 < toks.length) yield [...toks.slice(0, i), toks[i + 1], toks[i], ...toks.slice(i + 2)];
    yield toks.slice(0, i);
  }
}

test('every reference statement parses', () => {
  for (const src of SOURCES) assert.equal(parseStatement(readPli(src).statements[0]).status, 'parsed', src);
});

test('a statement damaged by one token is parsed or refused, never a crash', () => {
  let tried = 0;
  for (const src of SOURCES) {
    const st = readPli(src).statements[0];
    for (const toks of mutations(st.toks)) {
      const r = parseStatement({ ...st, toks });
      tried++;
      assert.ok(['parsed', 'unparsed', 'unknown', 'unbuilt'].includes(r.status), src);
      assert.ok(!r.crash, `${r.reason} on: ${toks.map((t) => t.v ?? t.t).join(' ')}`);
    }
  }
  assert.ok(tried > 1000);
});
