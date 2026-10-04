import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('MNOTE reads its severity, *, or none, and its message', () => {
  assert.deepEqual(parse("         MNOTE 8,'It''s wrong'").node.text, "It's wrong");
  assert.equal(parse("         MNOTE *,'note'").node.severity, '*');
  assert.equal(parse("         MNOTE 'plain'").node.severity, null);
  assert.equal(parse("         MNOTE ,'empty severity'").node.severity, null);
  assert.equal(parse('         MNOTE 8,unquoted').status, 'unparsed');
});

test('COPY names its member, and PUNCH, AINSERT, ICTL and ISEQ take their operands', () => {
  assert.equal(parse('         COPY  regequ').node.member, 'REGEQU');
  assert.equal(parse('         COPY  (A)').status, 'unparsed');
  assert.equal(parse("         PUNCH ' ENTRY MAIN'").node.text, ' ENTRY MAIN');
  assert.equal(parse("         AINSERT ' DC F''1''',BACK").node.where, 'BACK');
  assert.equal(parse("         AINSERT ' DC F''1''',MIDDLE").status, 'unparsed');
  assert.deepEqual(parse('         ICTL  1,71,16').node.values, [1, 71, 16]);
  assert.deepEqual(parse('         ISEQ  73,80').node.values, [73, 80]);
  assert.equal(parse('         ISEQ  73').status, 'unparsed');
});
