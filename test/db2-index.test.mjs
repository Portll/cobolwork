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

test('IBM example: XDEPT1, padded, on storage group DSN8G130 with 1 M pieces', () => {
  const n = node(` CREATE UNIQUE INDEX DSN8D10.XDEPT1
 ON DSN8D10.DEPT
 (DEPTNO ASC)
 PADDED
 USING STOGROUP DSN8G130
 PRIQTY 512
 SECQTY 64
 ERASE NO
 BUFFERPOOL BP1
 CLOSE YES
 PIECESIZE 1 M;`);
  assert.deepEqual(n, {
    kind: 'CREATE INDEX', unique: true, whereNotNull: false, name: 'DSN8D10.XDEPT1', table: 'DSN8D10.DEPT',
    key: [{ column: 'DEPTNO', order: 'ASC' }],
    options: { padded: true, using: { stogroup: 'DSN8G130', priqty: 512, secqty: 64, erase: false }, bufferpool: 'BP1', close: true, piecesize: '1M' },
  });
});

test('ERASE outside USING STOGROUP is refused, as the Db2 13 grammar has it', () => {
  assert.equal(parse('CREATE UNIQUE INDEX X ON T (A ASC) ERASE NO CLOSE NO;').status, 'unparsed');
});

test('a key of ordered columns, with storage clauses in any order', () => {
  const n = node('CREATE UNIQUE INDEX XFCHS01 ON CABSFCHS (OCN, STATE_CD DESC, LATA RANDOM) BUFFERPOOL BP2 USING STOGROUP CABSSG01 SECQTY 360 PRIQTY -1 ERASE NO CLOSE NO COPY YES;');
  assert.deepEqual([n.unique, n.name, n.table], [true, 'XFCHS01', 'CABSFCHS']);
  assert.deepEqual(n.key, [{ column: 'OCN', order: 'ASC' }, { column: 'STATE_CD', order: 'DESC' }, { column: 'LATA', order: 'RANDOM' }]);
  assert.deepEqual(n.options, { bufferpool: 'BP2', using: { stogroup: 'CABSSG01', secqty: 360, priqty: -1, erase: false }, close: false, copy: true });
});

test('UNIQUE WHERE NOT NULL, INCLUDE columns, a key expression and BUSINESS_TIME', () => {
  const n = node('CREATE UNIQUE WHERE NOT NULL INDEX S.X ON S.T (UPPER(LASTNAME) DESC, ID, BUSINESS_TIME WITHOUT OVERLAPS) INCLUDE (A, B) NOT PADDED EXCLUDE NULL KEYS;');
  assert.equal(n.whereNotNull, true);
  assert.equal(n.key[0].order, 'DESC');
  assert.ok(Array.isArray(n.key[0].expression));
  assert.deepEqual(n.key.slice(1), [{ column: 'ID', order: 'ASC' }, { period: 'BUSINESS_TIME', overlaps: false }]);
  assert.deepEqual(n.options, { include: ['A', 'B'], padded: false, nullKeys: 'EXCLUDE' });
});

test('partitions by PARTITION BY RANGE, by a bare list, and by the older PART n VALUES', () => {
  const a = node('CREATE INDEX X ON T (A) PARTITION BY RANGE (PARTITION 1 USING VCAT CAT1, PARTITION 2 FREEPAGE 0 DSSIZE 4G);');
  assert.deepEqual(a.options.partitions, [{ number: 1, using: { vcat: 'CAT1' } }, { number: 2, freepage: 0, dssize: '4G' }]);
  const b = node('CREATE INDEX X ON T (A) CLUSTER (PARTITION 1 ENDING AT (100), PARTITION 2 ENDING AT (MAXVALUE));');
  assert.deepEqual(b.options.partitions.map((p) => p.limits), [['100'], ['MAXVALUE']]);
  const c = node("CREATE INDEX X ON T (A) CLUSTER (PART 1 VALUES ('M'), PART 2 VALUES ('Z'));");
  assert.deepEqual(c.options.partitions.map((p) => p.limits), [['M'], ['Z']]);
});

test('an XML index and an index on an auxiliary table', () => {
  const x = node("CREATE INDEX XI ON T (DOC) GENERATE KEY USING XMLPATTERN '/order/id' AS SQL VARCHAR(20);");
  assert.deepEqual(x.options.xml, { pattern: '/order/id', type: { name: 'VARCHAR', length: 20 } });
  const a = node('CREATE UNIQUE INDEX AXI ON AUXT;');
  assert.equal(a.key, null);
});

test('forms Db2 for z/OS does not take are refused', () => {
  for (const sql of [
    'CREATE INDEX IF NOT EXISTS X ON T (C);',
    'CREATE INDEX X ON T USING hnsw (C);',
    'CREATE INDEX X ON T (C) ALLOW REVERSE SCANS;',
    'CREATE INDEX X ON T (C) IN TS1;',
    'CREATE INDEX X ON T (C) CLOSE NO CLOSE YES;',
    "CREATE INDEX X ON T (C) GENERATE KEY USING XMLPATTERN '/a' AS SQL INTEGER;",
  ]) assert.equal(parse(sql).status, 'unparsed', sql);
});
