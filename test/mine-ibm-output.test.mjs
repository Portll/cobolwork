import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryOf, markdown } from '../diag/mine-ibm-output.mjs';
import './pin-machine.mjs';

const LISTING = [
  '1PP 5655-EC6 IBM Enterprise COBOL for z/OS  6.4.0 P231130            Date 10/07/2026  Time 09:00:00   Page     1',
  '0Options in effect:',
  '      ARCH(10)',
  '0 LineID  PL SL  ----+-*A-1-B--+----2',
  '     12  IGYPS2121-S "PRINT-REX" was not defined as a data-name.  The statement was discarded.',
  'The course notes mention IGYPS2121-S and IGYPS2072-S without a listing.',
  'IGZ0035S There was an unsuccessful OPEN or CLOSE of file ACCTREC in program CBL0001.',
  "  CEE3204S: 'a code mention, not the system writing it',",
  '09.00.01 JOB12345  IEF450I JOB PAYROLL1 ABENDED S0C7',
  'Prose that names S0C7 again.',
  'Data Division Map',
  'End of compilation 1,  program ORAC01,  no statements flagged.',
  '',
].join('\n');

test('the inventory separates what the system wrote from what a file quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mine-ibm-'));
  try {
    mkdirSync(join(dir, 'repo-a'));
    const file = join(dir, 'repo-a', 'job.txt');
    writeFileSync(file, LISTING);
    const inv = inventoryOf([file], [dir]);
    assert.equal(inv.files, 1);
    assert.equal(inv.withHeader, 1);
    assert.deepEqual(Object.keys(inv.compilers), ['5655-EC6 IBM Enterprise COBOL for z/OS 6.4.0 P231130']);
    assert.deepEqual(Object.keys(inv.repos), ['repo-a']);
    for (const section of ['Options in effect', 'Source listing', 'Data Division Map', 'Diagnostic messages', 'End of compilation']) {
      assert.ok(inv.sections[section], `${section} is seen`);
    }
    assert.equal(inv.compileMessages['IGYPS2121-S'].emitted, 1);
    assert.equal(inv.compileMessages['IGYPS2121-S'].count, 2);
    assert.equal(inv.compileMessages['IGYPS2072-S'].emitted, 0);
    assert.equal(inv.runtimeMessages['IGZ0035S'].emitted, 1);
    assert.equal(inv.runtimeMessages['CEE3204S'].emitted, 0);
    assert.equal(inv.runtimeMessages['IEF450I'].emitted, 1);
    assert.equal(inv.abends['S0C7'].emitted, 1);
    assert.equal(inv.abends['S0C7'].count, 2);

    const text = markdown(inv, false);
    assert.match(text, /\| IGYPS2121-S \| 1 \| 1 \| "PRINT-REX" was not defined/);
    assert.ok(!text.includes('IGYPS2072-S'), 'a message only quoted is left to the JSON');
    assert.match(text, /\| IGZ0035S \| 1 \| 0 \| 1 \| There was an unsuccessful OPEN/);
    assert.match(text, /\| CEE3204S \| 0 \| 1 \| 1 \| /);
    assert.match(text, /\| S0C7 \| 1 \| 1 \| 1 \| .*IEF450I JOB PAYROLL1 ABENDED S0C7 \|/);
    assert.match(text, /\| repo-a \| 1 \| IBM Enterprise COBOL for z\/OS 6\.4\.0 P231130 \|/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
