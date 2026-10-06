import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execReading } from '../lib/exec-reading.mjs';
import { parseSource } from '../lib/parser.mjs';
import './pin-machine.mjs';

// Every line stays inside column 72, past which a fixed-format line is not read.
const program = (lines) => [
  '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. R.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-REC  PIC X(80).', '       01 WS-KEY  PIC X(8).', '       01 WS-FILE PIC X(8).', '       01 WS-PGM  PIC X(8).',
  '       PROCEDURE DIVISION.', ...lines.map((l) => `           ${l}`), '           GOBACK.', ''].join('\n');
const execs = (lines) => parseSource(program(lines), 'R.cbl').programs[0].execs;

test('a command is named by the table however its options are ordered, and DELETEQ is DELETEQ TS', () => {
  const [send, deleteq, read] = execs([
    "EXEC CICS SEND FROM(WS-REC) MAP('MAP1') MAPSET('SET1')", 'END-EXEC',
    "EXEC CICS DELETEQ QUEUE('TSQ1') NOHANDLE END-EXEC",
    'EXEC CICS READ DATASET(WS-FILE) INTO(WS-REC)', '     RIDFLD(WS-KEY) END-EXEC',
  ]);
  assert.deepEqual([execReading(send).command, execReading(send).verb, execReading(send).sub], ['SEND MAP', 'SEND', 'MAP']);
  assert.deepEqual([execReading(deleteq).command, execReading(deleteq).sub], ['DELETEQ TS', 'TS']);
  const r = execReading(read);
  assert.equal(r.command, 'READ');
  assert.deepEqual(r.opts.get('DATASET').map((t) => t.u), ['WS-FILE']);
  assert.deepEqual(['DATASET', 'INTO', 'RIDFLD', 'RESP'].map(r.direction), ['sends', 'receives', 'both', 'receives']);
});

test('a block the table does not hold keeps its own first two words and has no direction', () => {
  const [spool] = execs(["EXEC CICS SPOOLOPEN OUTPUT NODE('N1') TOKEN(WS-KEY)", 'END-EXEC']);
  const r = execReading(spool);
  assert.deepEqual([r.command, r.verb, r.sub, r.direction('TOKEN')], [null, 'SPOOLOPEN', 'OUTPUT', null]);
});

test('one block is read once', () => {
  const [e] = execs(["EXEC CICS LINK PROGRAM(WS-PGM) COMMAREA(WS-REC) END-EXEC"]);
  assert.equal(execReading(e), execReading(e));
});
