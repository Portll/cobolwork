// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 for z/OS CREATE INDEX, after the Db2 13 SQL Reference: the key, the index's clauses (each at
// most once), its partitions, and the XML index specification.

import { cursor } from '../cursor.mjs';
import { readName, readInteger, readNumber, readSize, readNameList, only, readDataType } from './table.mjs';

const ORDERS = ['ASC', 'DESC', 'RANDOM'];

// Each key part is a column or a key expression, optionally ordered, or the BUSINESS_TIME period.
function readKey(c) {
  return c.items().map((item) => {
    const s = cursor(item);
    if (s.isWord('BUSINESS_TIME') && s.isWord(['WITH', 'WITHOUT'], 1)) {
      s.next();
      const overlaps = s.next().u === 'WITH';
      s.expectWord('OVERLAPS');
      if (!s.done()) s.fail("',' or ')'");
      return { period: 'BUSINESS_TIME', overlaps };
    }
    const last = item[item.length - 1];
    const ordered = item.length > 1 && last.t === 'word' && ORDERS.includes(last.u);
    const order = ordered ? last.u : 'ASC';
    const body = ordered ? item.slice(0, -1) : item;
    if (!body.length) s.fail('a column or key expression');
    const b = cursor(body);
    const column = readName(b);
    return b.done() ? { column: column.join('.'), order } : { expression: body, order };
  });
}

function readUsing(c) {
  c.expectWord('USING');
  if (c.word('VCAT')) return { vcat: readName(c).join('.') };
  c.expectWord('STOGROUP');
  const using = { stogroup: readName(c).join('.') };
  for (;;) {
    const key = c.isWord('PRIQTY') ? 'priqty' : c.isWord('SECQTY') ? 'secqty' : c.isWord('ERASE') ? 'erase' : null;
    if (!key) return using;
    if (key in using) c.fail(`no second ${key.toUpperCase()}`);
    c.next();
    using[key] = key === 'erase' ? only(c, ['YES', 'NO']) === 'YES' : Number(readNumber(c));
  }
}

// USING, FREEPAGE, PCTFREE and GBPCACHE, shared by the index and each of its partitions.
function readSpaceClause(c, set) {
  if (c.isWord('USING')) set('using', readUsing(c));
  else if (c.word('FREEPAGE')) set('freepage', readInteger(c));
  else if (c.word('PCTFREE')) set('pctfree', readInteger(c));
  else if (c.word('GBPCACHE')) set('gbpcache', only(c, ['CHANGED', 'ALL', 'NONE']));
  else return false;
  return true;
}

function setter(c, into) {
  return (key, value) => {
    if (key in into) c.fail(`no second ${key}`);
    into[key] = value;
  };
}

function readPartitions(c) {
  return c.items().map((item) => {
    const s = cursor(item);
    const part = { number: (s.expectWord(['PARTITION', 'PART']), readInteger(s)) };
    const set = setter(s, part);
    if (s.word('VALUES') || (s.word('ENDING') && (s.word('AT'), true))) {
      part.limits = s.items().map((v) => {
        const vs = cursor(v);
        const limit = vs.word(['MAXVALUE', 'MINVALUE']) ? v[0].u : vs.peek() && vs.peek().t === 'lit' ? vs.next().v : readNumber(vs);
        if (!vs.done()) vs.fail("',' or ')'");
        return limit;
      });
      if (s.word('INCLUSIVE')) part.inclusive = true;
    }
    while (!s.done()) {
      if (readSpaceClause(s, set)) continue;
      if (s.word('DSSIZE')) { const n = readInteger(s); s.expectWord('G'); set('dssize', `${n}G`); }
      else s.fail('a partition clause');
    }
    return part;
  });
}

function readXmlIndex(c) {
  c.expectWord('GENERATE');
  c.expectWord(['KEY', 'KEYS']);
  c.expectWord('USING');
  c.expectWord('XMLPATTERN');
  const pattern = c.next();
  if (!pattern || pattern.t !== 'lit') { c.pos -= pattern ? 1 : 0; c.fail('an XML pattern string'); }
  c.expectWord('AS');
  c.expectWord('SQL');
  const type = readDataType(c);
  if (!['VARCHAR', 'DECFLOAT', 'DATE', 'TIMESTAMP'].includes(type.name)) c.fail('VARCHAR, DECFLOAT, DATE or TIMESTAMP');
  return { pattern: pattern.v, type };
}

function readOptions(c, node) {
  const set = setter(c, node.options);
  while (!c.done()) {
    if (readSpaceClause(c, set)) continue;
    if (c.isWord('GENERATE')) set('xml', readXmlIndex(c));
    else if (c.isWord('INCLUDE') && c.isOp('(', 1)) { c.next(); set('include', readNameList(c)); }
    else if (c.isWord(['INCLUDE', 'EXCLUDE']) && c.isWord('NULL', 1)) { set('nullKeys', c.next().u); c.next(); c.expectWord('KEYS'); }
    else if (c.isWord('NOT') && c.isWord(['CLUSTER', 'PADDED'], 1)) { c.next(); set(c.next().u === 'CLUSTER' ? 'cluster' : 'padded', false); }
    else if (c.word('CLUSTER')) set('cluster', true);
    else if (c.word('PADDED')) set('padded', true);
    else if (c.word('PARTITIONED')) set('partitioned', true);
    else if (c.isWord('PARTITION') && c.isWord('BY', 1)) { c.next(); c.next(); c.expectWord('RANGE'); set('partitions', readPartitions(c)); }
    else if (c.isOp('(') && c.isWord(['PARTITION', 'PART'], 1)) set('partitions', readPartitions(c));
    else if (c.word('DEFINE')) set('define', only(c, ['YES', 'NO']) === 'YES');
    else if (c.word('COMPRESS')) set('compress', only(c, ['YES', 'NO']) === 'YES');
    else if (c.word('BUFFERPOOL')) set('bufferpool', readName(c).join('.'));
    else if (c.word('CLOSE')) set('close', only(c, ['YES', 'NO']) === 'YES');
    else if (c.word('DEFER')) set('defer', only(c, ['YES', 'NO']) === 'YES');
    else if (c.word('DSSIZE')) { const n = readInteger(c); c.expectWord('G'); set('dssize', `${n}G`); }
    else if (c.word('PIECESIZE')) set('piecesize', readSize(c));
    else if (c.word('COPY')) set('copy', only(c, ['YES', 'NO']) === 'YES');
    else c.fail('an index clause');
  }
}

export const parsers = {
  'CREATE INDEX': (c) => {
    c.expectWord('CREATE');
    const node = { kind: 'CREATE INDEX', unique: false, whereNotNull: false, name: null, table: null, key: null, options: {} };
    if (c.word('UNIQUE')) {
      node.unique = true;
      if (c.word('WHERE')) { c.expectWord('NOT'); c.expectWord('NULL'); node.whereNotNull = true; }
    }
    c.expectWord('INDEX');
    node.name = readName(c).join('.');
    c.expectWord('ON');
    node.table = readName(c).join('.');
    if (c.isOp('(')) node.key = readKey(c);
    readOptions(c, node);
    return node;
  },
};
