import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIms, parseImsStatement } from '../lib/ims/read.mjs';
import './pin-machine.mjs';

const DBD = [
  '         DBD   NAME=DMDDBD,ACCESS=(HDAM,OSAM),                         X',
  '               RMNAME=(DFSHDC40,3,120)',
  '         SEGM  NAME=DMDROOT,PARENT=0,BYTES=32',
  '         FIELD NAME=(SPTNO,SEQ,U),BYTES=22,START=1,TYPE=C',
  '         DBDGEN',
  '         FINISH',
  '         END',
].join('\n');

test('macro cards fold into statements, a column-72 mark continuing one', () => {
  const { statements } = readIms(DBD);
  assert.deepEqual(statements.map((s) => s.operation), ['DBD', 'SEGM', 'FIELD', 'DBDGEN', 'FINISH', 'END']);
  assert.match(statements[0].field, /RMNAME=\(DFSHDC40,3,120\)/);
});

test('assembler instructions parse and anything that is not an IMS macro is unknown', () => {
  const r = readIms('         PROCOPT=A\n         END').statements.map(parseImsStatement);
  assert.deepEqual(r.map((x) => x.status), ['unknown', 'parsed']);
});
