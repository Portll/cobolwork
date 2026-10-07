import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import { inOptable, optableIn, optableLevel, processOptions } from '../lib/hlasm/optable.mjs';
import { scanHlasm } from '../lib/sets/hlasm.mjs';
import './pin-machine.mjs';

const parse = (src, opts) => parseHlasmStatement(readHlasmStatements(src).statements[0], opts);
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-optable-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
};

test('a mnemonic outside the chosen operation code table is a macro call', () => {
  assert.match(parse("         MSG   'COLD START'").reason, /MSG takes 2 operands/);
  const call = parse("         MSG   'COLD START'", { optable: 'ESA' });
  assert.deepEqual([call.kind, call.status], ['MACRO CALL', 'parsed']);
  assert.equal(parse('         DD    0,8(1)', { optable: '370' }).kind, 'RX');
  assert.deepEqual([inOptable('MSG'), inOptable('MSG', 'ZOP'), inOptable('MSG', 'XA'), inOptable('LGR', 'ESA')], [true, true, false, false]);
});

test('OPTABLE and MACHINE suboptions, synonyms and OVERRIDE are read from an option string', () => {
  assert.deepEqual([optableLevel('ZS3'), optableLevel('S390', { machine: true }), optableLevel('NOPE')], ['Z9', 'ESA', null]);
  assert.deepEqual(optableIn('OBJECT,OPTABLE(XA,LIST),RENT'), { level: 'XA', override: false });
  assert.deepEqual(optableIn('MACHINE(ZSERIES-2)'), { level: 'YOP', override: false });
  assert.deepEqual(optableIn('OVERRIDE(OPTABLE(370)),OPTABLE(ZOP)'), { level: '370', override: true });
  assert.equal(processOptions('*PROCESS OPTABLE(ESA)\n*PROCESS RENT\nP CSECT\n*PROCESS NOT'), 'OPTABLE(ESA),RENT');
});

const MSGCALL = "P        CSECT\n         MSG   'COLD START'\n         BR    14\n         END\n";

test('the estate\'s assembly PARM, a file\'s *PROCESS or the scan option chooses the table', () => {
  const plain = scanHlasm(tree({ 'asm/P.asm': MSGCALL }));
  assert.equal(plain.summary.statementsNotRead.RXY.count, 1);
  assert.equal(scanHlasm(tree({ 'asm/P.asm': `*PROCESS OPTABLE(ESA)\n${MSGCALL}` })).summary.statementsNotRead, undefined);
  const jcl = "//ASM      JOB\n//STEP1    EXEC PGM=ASMA90,PARM='OBJECT,OPTABLE(ESA)'\n//SYSIN    DD DSN=SRC(P),DISP=SHR\n";
  const viaJcl = scanHlasm(tree({ 'asm/P.asm': MSGCALL, 'jcl/ASM.jcl': jcl }));
  assert.deepEqual(viaJcl.summary.hlasmOptable, { level: 'ESA', from: 'jcl/ASM.jcl:2' });
  assert.equal(viaJcl.summary.statementsNotRead, undefined);
  const option = scanHlasm(tree({ 'asm/P.asm': `*PROCESS OVERRIDE(OPTABLE(ESA))\n${MSGCALL}` }), { hlasmOptable: 'UNI' });
  assert.equal(option.summary.statementsNotRead.RXY.count, 1);
  const conflict = scanHlasm(tree({ 'asm/P.asm': MSGCALL, 'jcl/A.jcl': jcl, 'jcl/B.jcl': jcl.replace('OPTABLE(ESA)', 'OPTABLE(Z17)') }));
  assert.deepEqual(Object.keys(conflict.summary.hlasmOptableConflict).sort(), ['ESA', 'Z17']);
});
