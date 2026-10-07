// A subprogram called from many places writes its arguments back to each caller through that
// caller's own CALL, however many callers share it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const program = (id, data, body) => [
  '       IDENTIFICATION DIVISION.',
  `       PROGRAM-ID. ${id}.`,
  '       DATA DIVISION.',
  ...data,
  `       PROCEDURE DIVISION${id.startsWith('SUB') || id.startsWith('MID') ? ' USING LK-A LK-B' : ''}.`,
  ...body.map((s) => `           ${s}`),
  '           GOBACK.',
  '',
].join('\n');
const STORAGE = ['       WORKING-STORAGE SECTION.', '       01 WS-X               PIC X(40).', '       01 WS-Y               PIC X(40).'];
const LINKAGE = ['       LINKAGE SECTION.', '       01 LK-A               PIC X(40).', '       01 LK-B               PIC X(40).'];

function estate(callee, callers) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-return-fan-'));
  writeFileSync(join(dir, 'APROG.cbl'), program('APROG', STORAGE, ['ACCEPT WS-X FROM COMMAND-LINE', `CALL '${callee}' USING WS-X WS-Y`, "CALL 'SYSTEM' USING WS-Y"]));
  for (let i = 1; i <= callers; i++) {
    writeFileSync(join(dir, `BPROG${i}.cbl`), program(`BPROG${i}`, STORAGE, ["MOVE 'ls' TO WS-X", `CALL '${callee}' USING WS-X WS-Y`, "CALL 'SYSTEM' USING WS-Y"]));
  }
  return dir;
}
const commands = (dir) => scan(dir).findings.filter((f) => f.rule === 'argv-or-env-to-os-command').map((f) => f.path).sort();

for (const callers of [2, 12]) {
  test(`taint written back by a subprogram with ${callers + 1} callers returns only to the call it came in through`, () => {
    const dir = estate('SUBPG', callers);
    try {
      writeFileSync(join(dir, 'SUBPG.cbl'), program('SUBPG', LINKAGE, ['MOVE LK-A TO LK-B']));
      assert.deepEqual(commands(dir), ['APROG.cbl']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`a nested call with ${callers + 1} callers returns to its own frame, and that frame to its own caller`, () => {
    const dir = estate('MIDPG', callers);
    try {
      writeFileSync(join(dir, 'MIDPG.cbl'), program('MIDPG', LINKAGE, ["CALL 'SUBPG' USING LK-A LK-B"]));
      writeFileSync(join(dir, 'SUBPG.cbl'), program('SUBPG', LINKAGE, ['MOVE LK-A TO LK-B']));
      assert.deepEqual(commands(dir), ['APROG.cbl']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
