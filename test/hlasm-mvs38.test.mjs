import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import { readHlasm } from '../lib/hlasm.mjs';
import { scanHlasm } from '../lib/sets/hlasm.mjs';
import './pin-machine.mjs';

const parse = (src, opts) => parseHlasmStatement(readHlasmStatements(src).statements[0], opts);
const OFF = { mvs38: false };

test('MODESET reads MVS 3.8 key names as the key each sets, and refuses them when the forms are off', () => {
  const supr = parse('         MODESET EXTKEY=SUPR');
  assert.equal(supr.status, 'parsed');
  assert.deepEqual(supr.node.mvs38, ['EXTKEY=SUPR']);
  assert.equal(supr.node.pswKey, 0);
  assert.equal(parse('         MODESET EXTKEY=DATAMGT').node.pswKey, 5);
  assert.equal(parse('         MODESET EXTKEY=SCHED,SAVEKEY=(2)').node.pswKey, 1);
  assert.equal(parse('         MODESET EXTKEY=ZERO').node.mvs38, undefined);
  assert.match(parse('         MODESET EXTKEY=SUPR', OFF).reason, /EXTKEY=SUPR is an MVS 3.8 form/);
  assert.match(parse('         MODESET EXTKEY=NOSUCH').reason, /invalid EXTKEY value NOSUCH/);
});

test('GETMAIN and FREEMAIN read the P request type and GETMAIN its HIARCHY', () => {
  assert.deepEqual(parse('         GETMAIN P,BRANCH=YES,SP=(GPR15F)').node.mvs38, ['P']);
  assert.deepEqual(parse('         FREEMAIN P,BRANCH=YES,A=(REG15)').node.mvs38, ['P']);
  assert.deepEqual(parse('         GETMAIN R,LV=(RC),SP=0,HIARCHY=0').node.mvs38, ['HIARCHY=0']);
  assert.match(parse('         GETMAIN R,LV=100,HIARCHY=2').reason, /HIARCHY must be 0 or 1/);
  assert.match(parse('         GETMAIN P,BRANCH=YES,SP=(15)', OFF).reason, /GETMAIN: P is an MVS 3.8 form/);
});

test('ATTACH reads HIARCHY and JSCB, and DCB reads PGFX and AERR', () => {
  assert.deepEqual(parse('         ATTACH EP=SUB,HIARCHY=0,JSCB=(R5)').node.mvs38, ['HIARCHY=0', 'JSCB=(R5)']);
  assert.match(parse('         ATTACH EP=SUB,HIARCHY=0', OFF).reason, /HIARCHY=0 is an MVS 3.8 form/);
  const dcb = parse('XDCB     DCB   DSORG=PS,MACRF=(E),SIOA=P8,PGFX=YES,AERR=ERR');
  assert.deepEqual(dcb.node.mvs38, ['PGFX=YES', 'AERR=ERR']);
  assert.match(parse('XDCB     DCB   DSORG=PS,MACRF=(E),PGFX=YES', OFF).reason, /PGFX=YES is an MVS 3.8 form/);
});

test('READ and WRITE read BTAM types, MF=(E,addr) and VTAM basic mode as MVS 3.8 forms', () => {
  assert.deepEqual(parse('         READ  (1),T,MF=E').node.mvs38, ['type T']);
  assert.match(parse('         READ  DECB1,T,DCB,AREA').reason, /type T is not one/);
  assert.deepEqual(parse('         WRITE DECB2,TI,DCB,AREA,40').node.mvs38, ['type TI']);
  const remote = parse('         READ  BCDECB1,DIF,(REGA),(REG5),,,(REG3),MF=(E,(1))');
  assert.deepEqual([remote.node.mvs38, remote.node.mf, remote.node.list], [['MF=(E,addr)'], 'E', '(1)']);
  const vtam = parse('         WRITE RPL=(RPLPTR),OPTCD=ASY,EXIT=DONE,ARG=(R4)');
  assert.deepEqual([vtam.node.mvs38, vtam.node.rpl], [['RPL='], '(RPLPTR)']);
  assert.match(parse('         READ  RPL=X,COLOUR=RED').reason, /unknown keyword COLOUR/);
  assert.match(parse('         WRITE DECB2,TI,DCB,AREA,40', OFF).reason, /WRITE: type TI is an MVS 3.8 form/);
  assert.match(parse('         WRITE RPL=X', OFF).reason, /WRITE: RPL= is an MVS 3.8 form/);
});

test('WTOR, GETMAIN and FREEMAIN read trailing empty operands as omitted', () => {
  assert.equal(parse('         WTOR  ,,,,,MF=(E,(1))').status, 'parsed');
  assert.equal(parse('         GETMAIN RC,LV=(0),SP=245,').status, 'parsed');
  assert.equal(parse('         FREEMAIN RU,LV=8,A=(1),').status, 'parsed');
  assert.match(parse('         GETMAIN RC,X,LV=8').reason, /extra positional operands: X/);
});

const SUPR = [
  'GOKEY0   CSECT',
  '         MODESET EXTKEY=SUPR',
  '         MODESET EXTKEY=DATAMGT',
  '         BR    14',
  '         END',
].join('\n') + '\n';

test('a switch to a z/OS system key other than zero is high, and one decided at run time is not reported', () => {
  const src = ['SYSKEY   CSECT', '         MODESET EXTKEY=KEY2', '         MODESET EXTKEY=TCB,WORKREG=2', '         BR    14', '         END'].join('\n') + '\n';
  assert.deepEqual(readHlasm(src).operations.map((o) => o.systemKey), [{ written: 'EXTKEY=KEY2', key: 2 }, null]);
  assert.deepEqual(readHlasm(SUPR, OFF).operations.map((o) => o.systemKey ?? null), [null, null]);
});

test('MVS 3.8 names for key zero are a switch to key zero, and only while the forms are read', () => {
  assert.deepEqual(readHlasm(SUPR).operations.map((o) => o.stateChange), ['EXTKEY=SUPR', null]);
  assert.deepEqual(readHlasm(SUPR, OFF).operations.map((o) => o.stateChange), [null, null]);
  const root = mkdtempSync(join(tmpdir(), 'cw-mvs38-'));
  writeFileSync(join(root, 'GOKEY0.asm'), SUPR);
  const on = scanHlasm(root);
  assert.deepEqual(on.findings.filter((f) => f.rule === 'hlasm-supervisor-state-change').map((f) => [f.line, f.sev]), [[2, 'crit'], [3, 'high']]);
  assert.match(on.findings.find((f) => f.line === 3).detail, /EXTKEY=DATAMGT switches to PSW key 5, a system key/);
  assert.equal(on.summary.mvs38Forms, 2);
  const off = scanHlasm(root, { mvs38Forms: false });
  assert.deepEqual(off.findings.filter((f) => f.rule === 'hlasm-supervisor-state-change'), []);
  assert.equal(off.summary.mvs38Forms, undefined);
});
