// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../lib/sets/flow.mjs';
import { parseSource } from '../lib/parser.mjs';
import './pin-machine.mjs';

// A program that runs as a command whatever one EXEC SQL statement leaves in WS-SCRIPT.
const program = (sql) => { for (const l of sql) if (l.length > 61) throw new Error(`past column 72: ${l}`); return [
  '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. DBCMD.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-KEY               PIC X(8).', '       01 WS-SCRIPT            PIC X(120).', '       01 WS-CMD               PIC X(200).',
  '       01 WS-ROW.', '          05 WS-NAME            PIC X(120).',
  '       PROCEDURE DIVISION.', ...sql.map((l) => `           ${l}`),
  "           STRING 'sh ' WS-SCRIPT DELIMITED BY SIZE INTO WS-CMD", "           CALL 'SYSTEM' USING WS-CMD", '           GOBACK.', '',
].join('\n'); };
const rules = (sql) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-esql-'));
  writeFileSync(join(root, 'DBCMD.cbl'), program(sql));
  return scan(root).findings.map((f) => f.rule);
};

test('E1.1 What a statement writes by Db2\'s rules is a database value: INTO, SET, CALL and a qualified INTO', () => {
  for (const sql of [
    ['EXEC SQL SELECT NAME INTO :WS-SCRIPT FROM T', '    WHERE ID = :WS-KEY END-EXEC'],
    ['EXEC SQL SET :WS-SCRIPT =', '    (SELECT NAME FROM T WHERE ID = 1) END-EXEC'],
    ['EXEC SQL CALL GETSCRIPT(:WS-KEY, :WS-SCRIPT) END-EXEC'],
    ['EXEC SQL SELECT NAME INTO :WS-ROW.WS-NAME', '    FROM T END-EXEC', 'MOVE WS-NAME TO WS-SCRIPT'],
  ]) assert.ok(rules(sql).includes('database-to-os-command'), sql[0]);
});

test('E1.2 A host variable a statement only reads is not a database value', () => {
  for (const sql of [
    ['EXEC SQL SELECT NAME INTO :WS-KEY FROM T', '    WHERE ID = :WS-SCRIPT END-EXEC'],
    ['EXEC SQL UPDATE T SET NAME = :WS-SCRIPT WHERE ID = 1 END-EXEC'],
    ['EXEC SQL INSERT INTO T VALUES (:WS-SCRIPT) END-EXEC'],
  ]) assert.ok(!rules(sql).includes('database-to-os-command'), sql[0]);
});

test('E1.3 The parser marks each host variable written or read, and resolves a qualified one to its field', () => {
  const r = parseSource(program(['EXEC SQL SELECT NAME INTO :WS-ROW.WS-NAME', '    FROM T WHERE ID = :WS-KEY END-EXEC']), 'DBCMD.cbl');
  const exec = r.programs[0].execs.find((e) => e.kind === 'SQL');
  assert.deepEqual(exec.hostVariables.map((h) => [h.tok.u, h.written]), [['WS-NAME', true], ['WS-KEY', false]]);
});
