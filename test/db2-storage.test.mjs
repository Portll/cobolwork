// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDb2, parseDb2Statement } from '../lib/db2/read.mjs';
import './pin-machine.mjs';

const parse = (sql) => parseDb2Statement(readDb2(sql).statements[0]);
const node = (sql) => {
  const r = parse(sql);
  assert.equal(r.status, 'parsed', r.reason);
  return r.node;
};

test('IBM examples: databases with a storage group and buffer pools, and with an encoding', () => {
  assert.deepEqual(node(' CREATE DATABASE DSN8D13P\n STOGROUP DSN8G130\n BUFFERPOOL BP8K1\n INDEXBP BP2;'),
    { kind: 'CREATE DATABASE', name: 'DSN8D13P', options: { stogroup: 'DSN8G130', bufferpool: 'BP8K1', indexbp: 'BP2' } });
  assert.deepEqual(node(' CREATE DATABASE DSN8TEMP\n CCSID ASCII;').options, { ccsid: 'ASCII' });
  assert.deepEqual(node('CREATE DATABASE WRK1 AS WORKFILE FOR DB2A;').options, { workfile: { member: 'DB2A' } });
});

test('IBM examples: storage groups on volumes, one with a key label', () => {
  assert.deepEqual(node(' CREATE STOGROUP DSN8G130\n VOLUMES (ABC005,DEF008)\n VCAT DSNCAT;'),
    { kind: 'CREATE STOGROUP', name: 'DSN8G130', options: { volumes: ['ABC005', 'DEF008'], vcat: 'DSNCAT' } });
  assert.equal(node(' CREATE STOGROUP DSNCG100\n VOLUMES (ABC001,DEF003) VCAT DSNCAT\n KEY LABEL STG01KLABEL;').options.keyLabel, 'STG01KLABEL');
  assert.deepEqual(node("CREATE STOGROUP SG1 VOLUMES ('*') VCAT CAT1 STORCLAS SC1;").options, { volumes: ['*'], vcat: 'CAT1', storclas: 'SC1' });
});

test('IBM example 1: a partition-by-growth table space on a storage group', () => {
  const n = node(` CREATE TABLESPACE DSN8S13D
 IN DSN8D13A
 USING STOGROUP DSN8G130
 PRIQTY 52
 SECQTY 20
 ERASE NO
 LOCKSIZE PAGE
 BUFFERPOOL BP1
 CLOSE YES;`);
  assert.deepEqual(n.options, {
    in: 'DSN8D13A', using: { stogroup: 'DSN8G130', priqty: 52, secqty: 20, erase: false }, locksize: 'PAGE', bufferpool: 'BP1', close: true,
  });
});

test('IBM example 2: NUMPARTS with per-partition COMPRESS and USING', () => {
  const n = node(` CREATE TABLESPACE SALESHX
 IN DSN8D13A
 USING STOGROUP DSN8G130
 PRIQTY 4000
 SECQTY 130
 ERASE NO
 NUMPARTS 82
 (PARTITION 80
 COMPRESS YES,
 PARTITION 81
 COMPRESS YES,
 PARTITION 82
 COMPRESS YES
 USING STOGROUP DSN8G120
 ERASE YES)
 LOCKSIZE PAGE
 BUFFERPOOL BP1
 CLOSE NO;`);
  assert.equal(n.options.numparts, 82);
  assert.deepEqual(n.options.partitions, [
    { number: 80, compress: 'YES' }, { number: 81, compress: 'YES' },
    { number: 82, compress: 'YES', using: { stogroup: 'DSN8G120', erase: true } },
  ]);
});

test('IBM example: a LOB table space, not logged', () => {
  const n = node(` CREATE LOB TABLESPACE PHOTOLTS
 IN DSN8D13A
 USING STOGROUP DSN8G130
 PRIQTY 3200
 SECQTY 1600
 LOCKSIZE LOB
 BUFFERPOOL BP16K0
 GBPCACHE SYSTEM
 NOT LOGGED
 CLOSE NO;`);
  assert.deepEqual([n.lob, n.options.locksize, n.options.gbpcache, n.options.logged], [true, 'LOB', 'SYSTEM', false]);
});

test("IBM's tolerated synonyms: PART, LOG NO, LOCKSIZE TABLE, LOCKPART and LARGE", () => {
  const n = node('CREATE LARGE TABLESPACE TS1 IN DB1 NUMPARTS 2 (PART 1 FREEPAGE 0, PART 2 PCTFREE 10 FOR UPDATE 5) LOG NO LOCKSIZE TABLE LOCKPART YES;');
  assert.equal(n.large, true);
  assert.deepEqual(n.options.partitions, [{ number: 1, freepage: 0 }, { number: 2, pctfree: { pctfree: 10, forUpdate: 5 } }]);
  assert.deepEqual([n.options.logged, n.options.locksize, n.options.lockpart], [false, 'TABLESPACE', true]);
});

test('Db2 LUW forms and repeated clauses are refused', () => {
  for (const sql of [
    'CREATE DATABASE IF NOT EXISTS D1;',
    "CREATE DATABASE D1 ON 'C:';",
    'CREATE DATABASE D1 USING CODESET UTF-8 TERRITORY US;',
    'CREATE TABLESPACE TS1 MANAGED BY AUTOMATIC STORAGE;',
    'CREATE TABLESPACE TS1 PAGESIZE 32 K;',
    'CREATE BUFFERPOOL BP1 SIZE 1000;',
    'CREATE STOGROUP SG1 VOLUMES (V1);',
    'CREATE TABLESPACE TS1 IN D1 CLOSE YES CLOSE NO;',
  ]) assert.equal(parse(sql).status === 'parsed', false, sql);
});
