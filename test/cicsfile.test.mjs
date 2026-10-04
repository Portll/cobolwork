// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the file a CICS file-control command names as a sink: FILE or DATASET from input picks
// any file the region defines, as ASSIGN TO a variable does in batch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { verificationPlan } from '../lib/verify.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cicsfile');
const report = scan(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file).map((f) => [f.rule, f.line, f.sev]).sort();

test('a file named by the terminal is reported at the READ and the STARTBR that pick it', () => {
  assert.deepEqual(of('FILEPICK.cbl'), [
    ['cics-terminal-to-dynamic-file-path', 17, 'high'],
    ['cics-terminal-to-dynamic-file-path', 19, 'high'],
  ]);
  assert.match(report.findings.find((f) => f.path === 'FILEPICK.cbl' && f.line === 19).detail, /EXEC CICS STARTBR DATASET\(WS-FILE\), which decides the file the command acts on/);
});

test('a file named by a web request is reported at the WRITE', () => {
  assert.deepEqual(of('FILEWEB.cbl'), [['cics-web-to-dynamic-file-path', 15, 'high']]);
});

test('a literal, a constant, a program-chosen name and a name checked against a list are not reported', () => {
  assert.deepEqual(of('FILEFIXED.cbl'), []);
});

test('the verification plan for a CICS file names FILENOTFOUND, not a file status', () => {
  const f = report.findings.find((x) => x.path === 'FILEWEB.cbl');
  const p = verificationPlan({ ...f, startedBy: [{ transaction: 'FW00', file: 'REGION.csd', line: 2 }] });
  assert.match(p.run, /FILENOTFOUND/);
  assert.match(p.observe, /as the file the program names/);
});
