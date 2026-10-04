// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the IMS rules over DBD and PSB source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkIms, IMS_RULES } from '../lib/ims/rules.mjs';
import './pin-machine.mjs';

const src = (...lines) => lines.map((l) => `         ${l}`).join('\n');
const rules = (findings) => findings.map((f) => f.rule);

const DBD = {
  path: 'dbd/ORDERDB.dbd',
  text: src(
    'DBD   NAME=ORDERDB,ACCESS=(HIDAM,VSAM)',
    'SEGM  NAME=ORDER,PARENT=0,BYTES=100',
    'FIELD NAME=(ORDNO,SEQ,U),BYTES=10,START=1',
    'SEGM  NAME=ITEM,PARENT=ORDER,BYTES=60',
    'FIELD NAME=(ITEMNO,SEQ,U),BYTES=6,START=1',
    'DBDGEN',
  ),
};
const psb = (...lines) => ({ path: 'psb/P.psb', text: src(...lines, 'PSBGEN PSBNAME=P,LANG=COBOL') });

test('every rule names a severity, evidence kind, CWE and text', () => {
  for (const [id, r] of Object.entries(IMS_RULES)) {
    assert.match(id, /^ims-/);
    assert.ok(['info', 'low', 'med', 'high', 'crit'].includes(r.sev), id);
    assert.equal(r.evidence, r.sev === 'info' ? 'context' : 'construct', id);
    assert.match(r.cwe, /^CWE-\d+$/);
    assert.ok(r.text.length > 10);
  }
});

test('a database PCB with PROCOPT omitted gets A and is flagged, naming the PSB, PCB, DBD and segments', () => {
  const f = checkIms([DBD, psb('PCB   TYPE=DB,DBDNAME=ORDERDB,KEYLEN=16', 'SENSEG NAME=ORDER', 'SENSEG NAME=ITEM,PARENT=ORDER')]);
  assert.deepEqual(rules(f), ['ims-pcb-procopt-all']);
  assert.equal(f[0].sev, 'info');
  assert.equal(f[0].line, 1);
  assert.equal(f[0].detail, 'PSB P PCB PCB 1 on DBD ORDERDB: PROCOPT omitted, so A, gives get, insert, replace and delete on segments ORDER, ITEM');
});

test('I, R and D together are every option, since R and D imply G', () => {
  const f = checkIms([psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=IRD,KEYLEN=16', 'SENSEG NAME=ORDER')]);
  assert.deepEqual(rules(f), ['ims-pcb-procopt-all']);
  assert.match(f[0].detail, /PROCOPT=IRD gives/);
});

test('a PCB whose SENSEGs narrow PROCOPT is flagged only for the segments that keep every option', () => {
  const some = checkIms([psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=A,KEYLEN=16', 'SENSEG NAME=ORDER,PROCOPT=G', 'SENSEG NAME=ITEM,PARENT=ORDER')]);
  assert.match(some[0].detail, /on segments ITEM$/);
  const none = checkIms([psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=A,KEYLEN=16', 'SENSEG NAME=ORDER,PROCOPT=G', 'SENSEG NAME=ITEM,PARENT=ORDER,PROCOPT=GR')]);
  assert.deepEqual(none, []);
});

test('read-only, insert-only and load PCBs are not flagged', () => {
  for (const opt of ['G', 'GO', 'GR', 'I', 'IR', 'LS']) {
    assert.deepEqual(checkIms([psb(`PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=${opt},KEYLEN=16`, 'SENSEG NAME=ORDER')]), [], opt);
  }
  assert.deepEqual(checkIms([psb('PCB   TYPE=TP,LTERM=OUT')]), []);
});

test('a SENSEG naming a segment its DBD does not define is ims-senseg-unknown-segment', () => {
  const f = checkIms([DBD, psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=G,KEYLEN=16', 'SENSEG NAME=ORDER', 'SENSEG NAME=LINE,PARENT=ORDER')]);
  assert.deepEqual(rules(f), ['ims-senseg-unknown-segment']);
  assert.equal(f[0].line, 3);
  assert.equal(f[0].detail, 'PSB P PCB PCB 1 on DBD ORDERDB: SENSEG LINE is not a segment of DBD ORDERDB');
});

test('unknown segments are not reported when the DBD is missing, ambiguous or not wholly read', () => {
  const pcb = psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=G,KEYLEN=16', 'SENSEG NAME=ORDER', 'SENSEG NAME=LINE,PARENT=ORDER');
  assert.deepEqual(checkIms([pcb]), []);
  assert.deepEqual(checkIms([DBD, { ...DBD, path: 'copy/ORDERDB.dbd' }, pcb]), []);
  const partial = { path: 'dbd/P.dbd', text: DBD.text.replace('SEGM  NAME=ITEM,PARENT=ORDER,BYTES=60', 'SEGM  NAME=ITEM,PARENT=ORDER,BYTES=X') };
  assert.deepEqual(checkIms([partial, pcb]), []);
});

test('a KEYLEN shorter than the longest concatenated key is DFS0919I', () => {
  const f = checkIms([DBD, psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=G,KEYLEN=10', 'SENSEG NAME=ORDER', 'SENSEG NAME=ITEM,PARENT=ORDER')]);
  assert.deepEqual(rules(f), ['ims-definition-inconsistent']);
  assert.equal(f[0].detail, 'DFS0919I: PSB P PCB PCB 1 on DBD ORDERDB has KEYLEN=10, shorter than the 16-byte concatenated key of ITEM');
  assert.deepEqual(checkIms([DBD, psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=G,KEYLEN=16', 'SENSEG NAME=ORDER', 'SENSEG NAME=ITEM,PARENT=ORDER')]), []);
  assert.deepEqual(checkIms([DBD, psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=G,KEYLEN=10', 'SENSEG NAME=ORDER')]), []);
});

test('KEYLEN is not checked through a secondary processing sequence', () => {
  assert.deepEqual(checkIms([DBD, psb('PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=G,KEYLEN=4,PROCSEQ=XI', 'SENSEG NAME=ITEM', 'SENSEG NAME=ORDER,PARENT=ITEM')]), []);
});

test('each problem in a DBD or PSB is ims-definition-inconsistent with its message number', () => {
  const bad = { path: 'dbd/BAD.dbd', text: src('DBD   NAME=BAD,ACCESS=HIDAM', 'SEGM  NAME=ROOT,BYTES=10', 'FIELD NAME=(K,SEQ,U),BYTES=12,START=1') };
  const f = checkIms([bad]);
  assert.deepEqual(rules(f), ['ims-definition-inconsistent']);
  assert.equal(f[0].path, 'dbd/BAD.dbd');
  assert.equal(f[0].line, 3);
  assert.match(f[0].detail, /^FLD170: field K ends at byte 12/);
});
