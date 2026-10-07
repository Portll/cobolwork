// One walk serves every source at its start, and a walk leaves a state once no sink is left to it
// under its call context: a sink behind the value's own return is still reached, one behind another
// caller's return never was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const program = (id, data, body, using = '') => [
  '       IDENTIFICATION DIVISION.',
  `       PROGRAM-ID. ${id}.`,
  '       DATA DIVISION.',
  ...data,
  `       PROCEDURE DIVISION${using}.`,
  ...body.map((s) => `           ${s}`),
  '           GOBACK.',
  '',
].join('\n');
const STORAGE = ['       WORKING-STORAGE SECTION.', '       01 WS-X               PIC X(40).', '       01 WS-Y               PIC X(40).', '       01 WS-Z               PIC X(40).'];
const LINKAGE = ['       LINKAGE SECTION.', '       01 LK-A               PIC X(40).', '       01 LK-B               PIC X(40).'];
const sub = (id, body) => program(id, LINKAGE, body, ' USING LK-A LK-B');

function estate(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-walk-shared-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, `${name}.cbl`), text);
  return dir;
}
const routes = (dir) => scan(dir).findings
  .filter((f) => f.rule === 'argv-or-env-to-os-command')
  .map((f) => `${f.path}:${f.line}:${f.sources}:${f.trace.map((h) => `${h.program}.${h.item}`).join('>')}`)
  .sort();

test('two sources at one item each report the sink, the second from the first walk', () => {
  const dir = estate({
    APROG: program('APROG', STORAGE, ['ACCEPT WS-X FROM COMMAND-LINE', 'MOVE WS-X TO WS-Y', 'ACCEPT WS-X FROM COMMAND-LINE', "CALL 'SYSTEM' USING WS-Y"]),
  });
  try {
    assert.deepEqual(routes(dir), ['APROG.cbl:12:2:APROG.WS-X>APROG.WS-Y']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sink behind the value\'s own return is reached, beside a caller whose sink is not', () => {
  const dir = estate({
    APROG: program('APROG', STORAGE, ['ACCEPT WS-X FROM COMMAND-LINE', "CALL 'SUBPG' USING WS-X WS-Y", "CALL 'SUBPG2' USING WS-Y WS-Z"]),
    BPROG: program('BPROG', STORAGE, ["MOVE 'ls' TO WS-X", "CALL 'SUBPG' USING WS-X WS-Y", "CALL 'SYSTEM' USING WS-Y"]),
    SUBPG: sub('SUBPG', ['MOVE LK-A TO LK-B']),
    SUBPG2: sub('SUBPG2', ["CALL 'SYSTEM' USING LK-A"]),
  });
  try {
    assert.deepEqual(routes(dir), ['SUBPG2.cbl:8:1:APROG.WS-X>SUBPG.LK-A>SUBPG.LK-B>APROG.WS-Y>SUBPG2.LK-A']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sink two returns up is reached through a nested call', () => {
  const dir = estate({
    APROG: program('APROG', STORAGE, ['ACCEPT WS-X FROM COMMAND-LINE', "CALL 'MIDPG' USING WS-X WS-Y", "CALL 'SUBPG2' USING WS-Y WS-Z"]),
    BPROG: program('BPROG', STORAGE, ["MOVE 'ls' TO WS-X", "CALL 'MIDPG' USING WS-X WS-Y", "CALL 'SYSTEM' USING WS-Y"]),
    MIDPG: sub('MIDPG', ["CALL 'SUBPG' USING LK-A LK-B"]),
    SUBPG: sub('SUBPG', ['MOVE LK-A TO LK-B']),
    SUBPG2: sub('SUBPG2', ["CALL 'SYSTEM' USING LK-A"]),
  });
  try {
    assert.deepEqual(routes(dir), ['SUBPG2.cbl:8:1:APROG.WS-X>MIDPG.LK-A>SUBPG.LK-A>SUBPG.LK-B>MIDPG.LK-B>APROG.WS-Y>SUBPG2.LK-A']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sink inside a callee of the callee is reached under the context', () => {
  const dir = estate({
    APROG: program('APROG', STORAGE, ['ACCEPT WS-X FROM COMMAND-LINE', "CALL 'MIDPG' USING WS-X WS-Y"]),
    BPROG: program('BPROG', STORAGE, ["MOVE 'ls' TO WS-X", "CALL 'MIDPG' USING WS-X WS-Y"]),
    MIDPG: sub('MIDPG', ["CALL 'SUBPG' USING LK-A LK-B"]),
    SUBPG: sub('SUBPG', ["CALL 'SYSTEM' USING LK-A"]),
  });
  try {
    assert.deepEqual(routes(dir), ['SUBPG.cbl:8:1:APROG.WS-X>MIDPG.LK-A>SUBPG.LK-A']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
