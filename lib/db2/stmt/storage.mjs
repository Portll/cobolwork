// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 for z/OS CREATE DATABASE, CREATE STOGROUP and CREATE [LOB | LARGE] TABLESPACE, after the Db2 13
// SQL Reference; every clause at most once, in any order.

import { cursor } from '../cursor.mjs';
import { readName, readInteger, only } from './table.mjs';
import { readUsing } from './index.mjs';

const CCSIDS = ['ASCII', 'EBCDIC', 'UNICODE'];

function setter(c, into) {
  return (key, value) => {
    if (key in into) c.fail(`no second ${key}`);
    into[key] = value;
  };
}

const yes = (c) => only(c, ['YES', 'NO']) === 'YES';
const name = (c) => readName(c).join('.');

function readDatabase(c) {
  c.expectWord('DATABASE');
  const node = { kind: 'CREATE DATABASE', name: name(c), options: {} };
  const set = setter(c, node.options);
  while (!c.done()) {
    if (c.word('BUFFERPOOL')) set('bufferpool', name(c));
    else if (c.word('INDEXBP')) set('indexbp', name(c));
    else if (c.isWord('AS') && c.isWord('WORKFILE', 1)) { c.next(); c.next(); set('workfile', c.word('FOR') ? { member: name(c) } : {}); }
    else if (c.word('STOGROUP')) set('stogroup', name(c));
    else if (c.word('CCSID')) set('ccsid', only(c, CCSIDS));
    else c.fail('a database clause');
  }
  return node;
}

// The volume list holds volume serials or '*', which lets SMS choose.
function readStogroup(c) {
  c.expectWord('STOGROUP');
  const node = { kind: 'CREATE STOGROUP', name: name(c), options: {} };
  const set = setter(c, node.options);
  while (!c.done()) {
    if (c.word('VOLUMES')) {
      set('volumes', c.items().map((item) => {
        const s = cursor(item);
        const t = s.next();
        if (!t || !['word', 'ident', 'lit', 'num'].includes(t.t) || !s.done()) s.fail("a volume serial or '*'");
        return t.v;
      }));
    } else if (c.word('VCAT')) set('vcat', name(c));
    else if (c.isWord(['DATACLAS', 'MGMTCLAS', 'STORCLAS'])) set(c.next().u.toLowerCase(), name(c));
    else if (c.isWord('NO') && c.isWord('KEY', 1)) { c.next(); c.next(); c.expectWord('LABEL'); set('keyLabel', null); }
    else if (c.isWord('KEY') && c.isWord('LABEL', 1)) { c.next(); c.next(); set('keyLabel', name(c)); }
    else c.fail('a storage group clause');
  }
  if (!('vcat' in node.options)) c.fail('VCAT');
  return node;
}

function readCompress(c) {
  if (!yes(c)) return 'NO';
  const how = c.word(['FIXEDLENGTH', 'HUFFMAN']);
  return how ? how.u : 'YES';
}

function readDssize(c) {
  const n = readInteger(c);
  c.expectWord('G');
  return `${n}G`;
}

// USING, FREEPAGE, PCTFREE [FOR UPDATE n], GBPCACHE, COMPRESS, TRACKMOD and DSSIZE: the clauses a
// partition may carry as well as the table space.
function readSpaceClause(c, set) {
  if (c.isWord('USING')) set('using', readUsing(c));
  else if (c.word('FREEPAGE')) set('freepage', readInteger(c));
  else if (c.word('PCTFREE')) {
    const pctfree = readInteger(c);
    if (c.isWord('FOR') && c.isWord('UPDATE', 1)) { c.next(); c.next(); set('pctfree', { pctfree, forUpdate: readInteger(c) }); }
    else set('pctfree', pctfree);
  } else if (c.word('GBPCACHE')) set('gbpcache', only(c, ['CHANGED', 'ALL', 'SYSTEM', 'NONE']));
  else if (c.word('COMPRESS')) set('compress', readCompress(c));
  else if (c.word('TRACKMOD')) set('trackmod', yes(c));
  else if (c.word('DSSIZE')) set('dssize', readDssize(c));
  else return false;
  return true;
}

function readPartitions(c) {
  return c.items().map((item) => {
    const s = cursor(item);
    s.expectWord(['PARTITION', 'PART']);
    const part = { number: readInteger(s) };
    const set = setter(s, part);
    while (!s.done()) if (!readSpaceClause(s, set)) s.fail('a partition clause');
    return part;
  });
}

function readTablespace(c, flavour) {
  c.expectWord('TABLESPACE');
  const node = { kind: 'CREATE TABLESPACE', lob: flavour === 'LOB', large: flavour === 'LARGE', name: name(c), options: {} };
  const set = setter(c, node.options);
  while (!c.done()) {
    if (readSpaceClause(c, set)) continue;
    if (c.word('IN')) set('in', name(c));
    else if (c.word('BUFFERPOOL')) set('bufferpool', name(c));
    else if (c.word('MAXPARTITIONS')) set('maxpartitions', readInteger(c));
    else if (c.word('NUMPARTS')) {
      set('numparts', readInteger(c));
      if (c.isOp('(')) set('partitions', readPartitions(c));
    } else if (c.word('PAGENUM')) set('pagenum', only(c, ['RELATIVE', 'ABSOLUTE']));
    else if (c.word('SEGSIZE')) set('segsize', readInteger(c));
    else if (c.word('CCSID')) set('ccsid', only(c, CCSIDS));
    else if (c.word('CLOSE')) set('close', yes(c));
    else if (c.word('DEFINE')) set('define', yes(c));
    else if (c.isWord('INSERT') && c.isWord('ALGORITHM', 1)) { c.next(); c.next(); set('insertAlgorithm', readInteger(c)); }
    else if (c.word('LOCKMAX')) set('lockmax', c.word('SYSTEM') ? 'SYSTEM' : readInteger(c));
    else if (c.word('LOCKSIZE')) {
      const size = only(c, ['ANY', 'TABLESPACE', 'TABLE', 'PAGE', 'ROW', 'LOB']);
      set('locksize', size === 'TABLE' ? 'TABLESPACE' : size);
    } else if (c.word('LOCKPART')) set('lockpart', yes(c));
    else if (c.isWord('NOT') && c.isWord('LOGGED', 1)) { c.next(); c.next(); set('logged', false); }
    else if (c.word('LOGGED')) set('logged', true);
    else if (c.word('LOG')) set('logged', yes(c));
    else if (c.word('MAXROWS')) set('maxrows', readInteger(c));
    else if (c.isWord('MEMBER') && c.isWord('CLUSTER', 1)) { c.next(); c.next(); set('memberCluster', true); }
    else if (c.isWord('FOR') && c.isWord(['SORT', 'DGTT'], 1)) { c.next(); set('for', c.next().u); }
    else c.fail('a table space clause');
  }
  return node;
}

export const parsers = {
  'CREATE DATABASE': (c) => (c.expectWord('CREATE'), readDatabase(c)),
  'CREATE STOGROUP': (c) => (c.expectWord('CREATE'), readStogroup(c)),
  'CREATE TABLESPACE': (c) => {
    c.expectWord('CREATE');
    const flavour = c.word(['LOB', 'LARGE']);
    return readTablespace(c, flavour ? flavour.u : null);
  },
  // Db2 for z/OS sizes buffer pools with the -ALTER BUFFERPOOL command; CREATE BUFFERPOOL is Db2 LUW.
  'CREATE BUFFERPOOL': (c) => {
    c.expectWord('CREATE');
    c.fail('a Db2 for z/OS statement (z/OS has no CREATE BUFFERPOOL)');
  },
};
