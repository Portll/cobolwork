import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('EXEC CICS names the command the CICS table identifies, and an unknown command is refused', () => {
  const r = parse("         EXEC CICS SEND MAP('M1') MAPSET('S1') ERASE");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.command, 'SEND MAP');
  assert.deepEqual(r.node.options.map((o) => o.word), ['SEND', 'MAP', 'MAPSET', 'ERASE']);
  assert.equal(parse('         EXEC CICS FROBNICATE X(1)').status, 'unparsed');
});

test('EXEC SQL keeps the statement and its host variables, and EXEC DLI its command', () => {
  const src = [`${'         EXEC SQL UPDATE DEPT SET MGRNO = :MGR WHERE'.padEnd(71)}X`, '               DEPTNO = :D'].join('\n');
  const r = parse(src);
  assert.deepEqual(r.node.hostVariables.sending, ['MGR', 'D']);
  assert.equal(parse('         EXEC SQL').status, 'unparsed');
  assert.equal(parse("         EXEC DLI GU USING PCB(1) SEGMENT(ROOT)").node.command, 'GU');
});
