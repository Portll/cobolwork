// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 for z/OS ALTER TABLE, after the Db2 13 SQL Reference: each clause as { action, ... } in the order
// written, then the reference's limits on which clauses may share one statement.

import { cursor, Db2Syntax } from '../cursor.mjs';
import {
  readName, readInteger, readNumber, readNameList, only, readDataType, readColumnDefinition, readDefault,
  readTableConstraint, readPeriod, readPartitioning,
} from './table.mjs';

const isName = (t) => !!t && (t.t === 'word' || t.t === 'ident');
const isWord = (t, u) => !!t && t.t === 'word' && (Array.isArray(u) ? u.includes(t.u) : t.u === u);
const isOp = (t, v) => !!t && t.t === 'op' && t.v === v;
const name = (c) => readName(c).join('.');
const yes = (c) => only(c, ['YES', 'NO']) === 'YES';

// What another dialect's ALTER TABLE looks like at the token where a Db2 for z/OS one stops.
const HINTS = [
  [(t) => isOp(t, ','), 'Db2 for z/OS lists ALTER TABLE clauses without commas'],
  [(t) => isOp(t, '/'), "'/' qualifies names in Db2 for i system naming, not Db2 for z/OS"],
  [(t, n) => isWord(t, 'IF') && isWord(n, ['EXISTS', 'NOT']), 'IF [NOT] EXISTS is not Db2 for z/OS syntax'],
  [(t, n) => isWord(t, 'OWNER') && isWord(n, 'TO'), 'OWNER TO is PostgreSQL, not Db2 for z/OS'],
  [(t) => isWord(t, 'MODIFY'), 'MODIFY is Oracle or MySQL; Db2 for z/OS changes a column with ALTER COLUMN'],
  [(t) => isWord(t, 'CHANGE'), 'CHANGE is MySQL; Db2 for z/OS renames a column with RENAME COLUMN'],
  [(t, n) => isWord(t, 'RENAME') && isWord(n, 'TO'), 'Db2 for z/OS renames a table with the RENAME statement'],
  [(t, n) => isWord(t, 'ON') && isWord(n, 'UPDATE'), 'Db2 for z/OS has no ON UPDATE rule; a foreign key takes ON DELETE only'],
  [(t, n) => isWord(t, 'NOT') && isWord(n, 'VALID'), 'NOT VALID is PostgreSQL, not Db2 for z/OS'],
  [(t, n) => isWord(t, ['VALIDATE', 'NOVALIDATE']) || (isWord(t, ['ENABLE', 'DISABLE']) && isWord(n, ['VALIDATE', 'NOVALIDATE'])), 'VALIDATE and NOVALIDATE are Oracle, not Db2 for z/OS'],
  [(t, n) => isWord(t, ['DEFERRABLE', 'INITIALLY']) || (isWord(t, 'NOT') && isWord(n, 'DEFERRABLE')), 'a Db2 for z/OS constraint is not deferrable'],
  [(t) => isWord(t, 'USING'), 'USING here is not Db2 for z/OS syntax'],
  [(t) => isWord(t, ['AFTER', 'FIRST', 'AUTO_INCREMENT', 'ENGINE']), 'a MySQL clause, not Db2 for z/OS'],
  [(t) => isWord(t, 'TYPE'), 'ALTER COLUMN … TYPE is PostgreSQL; Db2 for z/OS writes SET DATA TYPE'],
  [(t, n) => isWord(t, ['SET', 'DROP']) && isWord(n, 'NOT'), 'a Db2 for z/OS column alteration has no SET NOT NULL or DROP NOT NULL'],
  [(t, n) => isWord(t, 'SET') && (isWord(n, ['STATISTICS', 'STORAGE', 'COMPRESSION', 'SCHEMA', 'TABLESPACE', 'LOGGED', 'UNLOGGED']) || isOp(n, '(')), 'a PostgreSQL clause, not Db2 for z/OS'],
  [(t, n) => isWord(t, 'ACTIVATE') && isWord(n, 'NOT'), 'ACTIVATE NOT LOGGED INITIALLY is Db2 for LUW, not Db2 for z/OS'],
  [(t) => isWord(t, ['LOCKSIZE', 'PCTFREE', 'COMPRESS']), 'Db2 for z/OS sets this on the table space, with ALTER TABLESPACE'],
];

function hint(c) {
  const t = c.peek();
  const found = t && HINTS.find(([test]) => test(t, c.peek(1)));
  return found ? ` (${found[1]})` : '';
}

function refuse(c, what) {
  const t = c.peek();
  throw new Db2Syntax(`expected ${what}${t ? ` at '${t.v}'` : ' at end of statement'}${hint(c)}`, t || c.peek(-1));
}

function setter(c, into) {
  return (key, value) => {
    if (key in into) c.fail(`no second ${key}`);
    into[key] = value;
  };
}

function columnName(c) {
  const t = c.next();
  if (!isName(t)) { c.pos -= t ? 1 : 0; refuse(c, 'a column name'); }
  if (c.isOp('.')) refuse(c, 'an unqualified column name');
  return t.v;
}

// Whether t (n after it) opens another clause, so an added column's definition ends before it.
function opensClause(t, n) {
  if (!t || isOp(t, ',')) return true;
  if (t.t !== 'word') return false;
  if (['ADD', 'ALTER', 'DROP', 'RENAME', 'ROTATE', 'VOLATILE', 'ACTIVATE', 'DEACTIVATE', 'APPEND', 'AUDIT', 'VALIDPROC'].includes(t.u)) return true;
  if (t.u === 'DATA') return isWord(n, 'CAPTURE');
  if (t.u === 'NOT') return isWord(n, 'VOLATILE');
  if (t.u === 'ENABLE' || t.u === 'DISABLE') return isWord(n, 'ARCHIVE');
  if (t.u === 'KEY') return isWord(n, 'LABEL');
  if (t.u === 'NO') return isWord(n, 'KEY');
  if (t.u === 'SET') return isWord(n, ['MATERIALIZED', 'SUMMARY']);
  return false;
}

// An added column's references-clause or check-constraint; PRIMARY KEY and UNIQUE are clauses of their own.
function readAddedColumn(c) {
  if (c.isWord('IF')) refuse(c, 'a column definition');
  const rest = c.rest();
  let end = 1;
  for (let depth = 0; end < rest.length; end++) {
    if (depth === 0 && opensClause(rest[end], rest[end + 1])) break;
    if (isOp(rest[end], '(')) depth++;
    else if (isOp(rest[end], ')')) depth--;
  }
  if (isOp(rest[1], '.')) { c.next(); refuse(c, 'an unqualified column name'); }
  const s = cursor(rest.slice(0, end));
  let column;
  try {
    column = readColumnDefinition(s);
  } catch (e) {
    if (e instanceof Db2Syntax && hint(s)) throw new Db2Syntax(e.message + hint(s), s.peek() || s.peek(-1));
    throw e;
  }
  const key = column.constraints.find((k) => k.type === 'PRIMARY KEY' || k.type === 'UNIQUE');
  if (key) throw new Db2Syntax(`an added column takes REFERENCES or CHECK, not ${key.type}; ADD ${key.type} is a clause of its own`, rest[0]);
  c.pos += end;
  return { action: 'ADD COLUMN', column };
}

function readAlteredType(c) {
  const at = c.peek();
  const type = readDataType(c);
  const refused = type.name === 'DISTINCT' ? `a distinct type (${type.distinct})`
    : ['DATE', 'TIME', 'ROWID'].includes(type.name) ? type.name
      : type.long ? `LONG ${type.name}`
        : 'ccsid' in type ? 'a CCSID'
          : type.name === 'CLOB' && type.forData === 'BIT' ? 'CLOB FOR BIT DATA' : null;
  if (refused) throw new Db2Syntax(`SET DATA TYPE does not take ${refused} in Db2 for z/OS`, at);
  return type;
}

const NO_OPTION = { MINVALUE: 'minValue', MAXVALUE: 'maxValue', CYCLE: 'cycle', CACHE: 'cache', ORDER: 'order' };
const IDENTITY_SET = ['INCREMENT', 'NO', ...Object.keys(NO_OPTION), ...Object.keys(NO_OPTION).map((w) => `NO${w}`)];
const startsIdentityAlteration = (c) => c.isWord('RESTART') || (c.isWord('SET') && c.isWord(IDENTITY_SET, 1));

// RESTART [WITH n] and SET INCREMENT BY, SET [NO] MINVALUE and the rest, each at most once; NOCACHE and
// the other one-word forms are IBM's synonyms. restart: null restarts at the original START WITH.
function readIdentityAlteration(c) {
  const identity = {};
  const set = setter(c, identity);
  while (startsIdentityAlteration(c)) {
    if (c.word('RESTART')) { set('restart', c.word('WITH') ? readNumber(c) : null); continue; }
    c.next();
    if (c.word('INCREMENT')) { c.expectWord('BY'); set('incrementBy', readNumber(c)); }
    else if (c.word('MINVALUE')) set('minValue', readNumber(c));
    else if (c.word('MAXVALUE')) set('maxValue', readNumber(c));
    else if (c.word('CYCLE')) set('cycle', true);
    else if (c.word('ORDER')) set('order', true);
    else if (c.word('CACHE')) set('cache', readInteger(c));
    else if (c.word('NO')) set(NO_OPTION[only(c, Object.keys(NO_OPTION))], false);
    else set(NO_OPTION[c.next().u.slice(2)], false);
  }
  return identity;
}

function readRowGenerated(c) {
  c.expectWord('AS');
  if (c.word('TRANSACTION')) { c.expectWord('START'); c.expectWord('ID'); return 'TRANSACTION START ID'; }
  c.expectWord('ROW');
  const which = only(c, ['BEGIN', 'START', 'END']);
  return `ROW ${which === 'START' ? 'BEGIN' : which}`;
}

function readColumnAlteration(c) {
  const clause = { action: 'ALTER COLUMN', column: columnName(c), change: null };
  if (c.isWord('SET') && c.isWord('DATA', 1) && c.isWord('TYPE', 2)) {
    c.pos += 3;
    clause.change = 'SET DATA TYPE';
    clause.type = readAlteredType(c);
    if (c.isWord('INLINE') && c.isWord('LENGTH', 1)) { c.pos += 2; clause.inlineLength = readInteger(c); }
  } else if (c.isWord('SET') && (c.isWord('DEFAULT', 1) || (c.isWord('WITH', 1) && c.isWord('DEFAULT', 2)))) {
    c.pos += c.isWord('WITH', 1) ? 3 : 2;
    clause.change = 'SET DEFAULT';
    clause.default = readDefault(c);
    if (clause.default.implicit && !c.done() && !opensClause(c.peek(), c.peek(1))) refuse(c, 'a constant, SESSION_USER, USER, CURRENT SQLID or NULL after DEFAULT');
  } else if (c.isWord('SET') && c.isWord('INLINE', 1)) {
    c.pos += 2;
    c.expectWord('LENGTH');
    clause.change = 'SET INLINE LENGTH';
    clause.inlineLength = readInteger(c);
  } else if (c.isWord('SET') && c.isWord('GENERATED', 1)) {
    c.pos += 2;
    clause.change = 'SET GENERATED';
    const when = c.word('ALWAYS') ? 'ALWAYS' : c.word('BY') ? (c.expectWord('DEFAULT'), 'BY DEFAULT') : null;
    if (when !== 'BY DEFAULT' && c.isWord('AS')) clause.generated = { when: 'ALWAYS', as: readRowGenerated(c) };
    else {
      if (!when) refuse(c, 'ALWAYS, BY DEFAULT or AS');
      clause.generated = { when };
      if (startsIdentityAlteration(c)) clause.identity = readIdentityAlteration(c);
    }
  } else if (c.isWord('DROP') && c.isWord('DEFAULT', 1)) {
    c.pos += 2;
    clause.change = 'DROP DEFAULT';
  } else if (startsIdentityAlteration(c)) {
    clause.change = 'IDENTITY';
    clause.identity = readIdentityAlteration(c);
  } else refuse(c, 'SET DATA TYPE, SET DEFAULT, SET INLINE LENGTH, SET GENERATED, DROP DEFAULT, RESTART or SET and an identity attribute');
  return clause;
}

function readLimits(c) {
  const limits = c.items().map((v) => {
    const s = cursor(v);
    const limit = s.word(['MAXVALUE', 'MINVALUE']) ? v[0].u : s.peek() && s.peek().t === 'lit' ? s.next().v : readNumber(s);
    if (!s.done()) s.fail("',' or ')'");
    return limit;
  });
  if (!limits.length) c.fail('a limit key value');
  return limits;
}

// ENDING [AT] (…) [INCLUSIVE]; VALUES is IBM's synonym for ENDING AT.
function readBoundary(c) {
  if (!c.word('VALUES')) { c.expectWord('ENDING'); c.word('AT'); }
  const boundary = { limits: readLimits(c) };
  if (c.word('INCLUSIVE')) boundary.inclusive = true;
  return boundary;
}

function readHashSpace(c) {
  c.expectWord('HASH');
  c.expectWord('SPACE');
  const n = readInteger(c);
  return `${n}${only(c, ['K', 'M', 'G'])}`;
}

function readQueryOptions(c, into, required) {
  const set = setter(c, into);
  let read = false;
  for (;;) {
    if (c.word('MAINTAINED')) { c.expectWord('BY'); set('maintainedBy', only(c, ['SYSTEM', 'USER'])); }
    else if (c.isWord(['ENABLE', 'DISABLE']) && c.isWord('QUERY', 1)) { set('queryOptimization', c.next().u === 'ENABLE'); c.next(); c.expectWord('OPTIMIZATION'); }
    else break;
    read = true;
  }
  if (required && !read) refuse(c, 'MAINTAINED BY, ENABLE QUERY OPTIMIZATION or DISABLE QUERY OPTIMIZATION');
}

function readMaterializedQuery(c) {
  if (!c.isOp('(')) refuse(c, "'(' and the materialized query's fullselect");
  const clause = { action: 'ADD MATERIALIZED QUERY', fullselect: c.group() };
  for (const w of ['DATA', 'INITIALLY', 'DEFERRED', 'REFRESH', 'DEFERRED']) c.expectWord(w);
  readQueryOptions(c, clause, false);
  return clause;
}

// SET MATERIALIZED QUERY AS and SET SUMMARY AS: IBM's synonyms for ADD and DROP MATERIALIZED QUERY.
function readSetQuery(c) {
  c.next();
  if (c.next().u === 'MATERIALIZED') c.expectWord('QUERY');
  c.expectWord('AS');
  if (c.word('DEFINITION')) { c.expectWord('ONLY'); return { action: 'DROP MATERIALIZED QUERY' }; }
  return readMaterializedQuery(c);
}

const startsConstraint = (c) => c.isWord(['CONSTRAINT', 'PRIMARY', 'FOREIGN']) || (c.isWord(['UNIQUE', 'CHECK']) && c.isOp('(', 1));

// FOREIGN KEY name (…) is the place earlier releases gave a referential constraint its name.
function readConstraint(c) {
  if (c.isWord('FOREIGN') && c.isWord('KEY', 1) && isName(c.peek(2)) && c.isOp('(', 3)) {
    const rest = c.rest();
    const s = cursor([rest[0], rest[1], ...rest.slice(3)]);
    const constraint = readTableConstraint(s);
    c.pos += s.pos + 1;
    return { action: 'ADD CONSTRAINT', constraint: { ...constraint, name: rest[2].v } };
  }
  return { action: 'ADD CONSTRAINT', constraint: readTableConstraint(c) };
}

function readAdd(c) {
  if (c.word('COLUMN')) return readAddedColumn(c);
  if (c.isWord('PERIOD') && c.isWord(['FOR', 'SYSTEM_TIME', 'BUSINESS_TIME'], 1)) return { action: 'ADD PERIOD', period: readPeriod(c) };
  if (startsConstraint(c)) return readConstraint(c);
  if (c.isWord('PARTITION') && c.isWord('BY', 1)) {
    if (c.isWord(['SIZE', 'GROWTH'], 2)) { c.pos += 2; refuse(c, 'RANGE or the partitioning columns'); }
    return { action: 'ADD PARTITION BY RANGE', partitioning: readPartitioning(c) };
  }
  if (c.word('PARTITION')) {
    if (c.isWord('HASH')) refuse(c, 'ENDING AT (an added partition takes no HASH SPACE)');
    return { action: 'ADD PARTITION', ...(c.isWord(['ENDING', 'VALUES']) ? readBoundary(c) : {}) };
  }
  if ((c.isWord('SYSTEM') && c.isWord('VERSIONING', 1)) || (c.isWord('VERSIONING') && c.isWord('USE', 1))) {
    c.word('SYSTEM');
    for (const w of ['VERSIONING', 'USE', 'HISTORY', 'TABLE']) c.expectWord(w);
    const clause = { action: 'ADD VERSIONING', historyTable: name(c), extraRow: false };
    if (c.isWord('ON') && c.isWord('DELETE', 1)) {
      c.pos += 2;
      for (const w of ['ADD', 'EXTRA', 'ROW']) c.expectWord(w);
      clause.extraRow = true;
    }
    return clause;
  }
  if ((c.isWord('MATERIALIZED') && c.isWord('QUERY', 1)) || (c.isWord('QUERY') && c.isOp('(', 1))) {
    c.word('MATERIALIZED');
    c.next();
    return readMaterializedQuery(c);
  }
  if (c.isOp('(')) {
    const at = c.pos;
    c.group();
    const query = c.isWord('DATA') && c.isWord('INITIALLY', 1);
    c.pos = at;
    if (!query) refuse(c, 'a column definition (a parenthesised list after ADD is Oracle, not Db2 for z/OS)');
    return readMaterializedQuery(c);
  }
  if (c.isWord('ORGANIZE') && c.isWord('BY', 1)) {
    c.pos += 2;
    c.expectWord('HASH');
    c.expectWord('UNIQUE');
    const clause = { action: 'ADD ORGANIZATION', columns: readNameList(c) };
    if (c.isWord('HASH')) clause.hashSpace = readHashSpace(c);
    return clause;
  }
  if (c.word('CLONE')) return { action: 'ADD CLONE', clone: name(c) };
  if (c.isWord('RESTRICT') && c.isWord('ON', 1)) { c.pos += 2; c.expectWord('DROP'); return { action: 'ADD RESTRICT ON DROP' }; }
  if (c.isWord(['INDEX', 'KEY', 'FULLTEXT', 'SPATIAL']) || (c.isWord('UNIQUE') && c.isWord(['INDEX', 'KEY'], 1))) {
    refuse(c, 'an ALTER TABLE clause (an index added by ALTER TABLE is MySQL; Db2 for z/OS uses CREATE INDEX)');
  }
  return readAddedColumn(c);
}

function readAlter(c) {
  if (c.word('PARTITIONING')) {
    c.expectWord('TO');
    if (!c.isWord('PARTITION') || !c.isWord('BY', 1)) refuse(c, 'PARTITION BY');
    if (!c.isWord(['GROWTH', 'SIZE'], 2)) return { action: 'ALTER PARTITIONING', to: readPartitioning(c) };
    c.pos += 3;
    const to = { by: 'GROWTH' };
    const set = setter(c, to);
    for (;;) {
      if (c.isWord(['DSSIZE', 'EVERY'])) { c.next(); const n = readInteger(c); c.expectWord('G'); set('dssize', `${n}G`); }
      else if (c.word('MAXPARTITIONS')) set('maxpartitions', readInteger(c));
      else return { action: 'ALTER PARTITIONING', to };
    }
  }
  if (c.isWord(['PARTITION', 'PART']) && c.peek(1) && c.peek(1).t === 'num') {
    c.next();
    const clause = { action: 'ALTER PARTITION', partition: readInteger(c) };
    return c.isWord('HASH') ? { ...clause, hashSpace: readHashSpace(c) } : { ...clause, ...readBoundary(c) };
  }
  if ((c.isWord('MATERIALIZED') && c.isWord('QUERY', 1)) || (c.isWord('QUERY') && c.isWord('SET', 1) && c.isWord(['MAINTAINED', 'ENABLE', 'DISABLE'], 2))) {
    c.word('MATERIALIZED');
    c.next();
    c.expectWord('SET');
    const clause = { action: 'ALTER MATERIALIZED QUERY' };
    readQueryOptions(c, clause, true);
    return clause;
  }
  if (c.isWord('ORGANIZATION') && c.isWord('SET', 1) && c.isWord('HASH', 2)) {
    c.pos += 2;
    return { action: 'ALTER ORGANIZATION', hashSpace: readHashSpace(c) };
  }
  c.word('COLUMN');
  return readColumnAlteration(c);
}

function readDrop(c) {
  if (c.isWord('PRIMARY') && c.isWord('KEY', 1)) { c.pos += 2; return { action: 'DROP CONSTRAINT', type: 'PRIMARY KEY', name: null }; }
  if (c.isWord('FOREIGN') && c.isWord('KEY', 1)) { c.pos += 2; return { action: 'DROP CONSTRAINT', type: 'FOREIGN KEY', name: name(c) }; }
  if (c.isWord(['UNIQUE', 'CHECK', 'CONSTRAINT'])) {
    const type = c.next().u;
    return { action: 'DROP CONSTRAINT', type: type === 'CONSTRAINT' ? null : type, name: name(c) };
  }
  if ((c.isWord('SYSTEM') && c.isWord('VERSIONING', 1)) || (c.isWord('VERSIONING') && !c.isWord('RESTRICT', 1))) {
    c.word('SYSTEM');
    c.next();
    return { action: 'DROP VERSIONING' };
  }
  if ((c.isWord('MATERIALIZED') && c.isWord('QUERY', 1)) || (c.isWord('QUERY') && !c.isWord('RESTRICT', 1))) {
    c.word('MATERIALIZED');
    c.next();
    return { action: 'DROP MATERIALIZED QUERY' };
  }
  if (c.isWord(['ORGANIZATION', 'CLONE']) && !c.isWord('RESTRICT', 1)) return { action: `DROP ${c.next().u}` };
  if (c.isWord('RESTRICT') && c.isWord('ON', 1)) { c.pos += 2; c.expectWord('DROP'); return { action: 'DROP RESTRICT ON DROP' }; }
  if (c.isWord(['INDEX', 'KEY']) && !c.isWord('RESTRICT', 1)) refuse(c, 'an ALTER TABLE clause (DROP INDEX in ALTER TABLE is MySQL; Db2 for z/OS uses DROP INDEX on its own)');
  c.word('COLUMN');
  if (c.isWord('IF')) refuse(c, 'a column name');
  const column = columnName(c);
  if (!c.word('RESTRICT')) refuse(c, 'RESTRICT (Db2 for z/OS drops a column only with RESTRICT)');
  return { action: 'DROP COLUMN', column };
}

function readRotate(c) {
  c.expectWord('PARTITION');
  const partition = c.word('FIRST') ? 'FIRST' : readInteger(c);
  c.expectWord('TO');
  c.expectWord('LAST');
  const clause = { action: 'ROTATE PARTITION', partition, ...readBoundary(c) };
  c.expectWord('RESET');
  return clause;
}

// ADD may be left out before a unique or referential constraint that is the statement's first clause.
const startsKeyConstraint = (c) => (c.isWord('CONSTRAINT') && c.isWord(['PRIMARY', 'UNIQUE', 'FOREIGN'], 2)) ||
  (c.isWord('PRIMARY') && c.isWord('KEY', 1)) || (c.isWord('UNIQUE') && c.isOp('(', 1)) || (c.isWord('FOREIGN') && c.isWord('KEY', 1));

function readClause(c, first) {
  if (c.word('ADD')) return readAdd(c);
  if (c.word('ALTER')) return readAlter(c);
  if (c.word('DROP')) return readDrop(c);
  if (c.isWord('RENAME') && c.isWord('COLUMN', 1)) {
    c.pos += 2;
    const from = columnName(c);
    c.expectWord('TO');
    return { action: 'RENAME COLUMN', from, to: columnName(c) };
  }
  if (c.word('ROTATE')) return readRotate(c);
  if (c.isWord('DATA') && c.isWord('CAPTURE', 1)) { c.pos += 2; return { action: 'DATA CAPTURE', value: only(c, ['NONE', 'CHANGES']) }; }
  if (c.word('VOLATILE')) { c.word('CARDINALITY'); return { action: 'VOLATILE', value: true }; }
  if (c.isWord('NOT') && c.isWord('VOLATILE', 1)) { c.pos += 2; c.word('CARDINALITY'); return { action: 'VOLATILE', value: false }; }
  if (c.isWord(['ACTIVATE', 'DEACTIVATE']) && c.isWord(['ROW', 'COLUMN'], 1)) {
    const verb = c.next().u;
    const what = c.next().u;
    c.expectWord('ACCESS');
    c.expectWord('CONTROL');
    return { action: `${verb} ${what} ACCESS CONTROL` };
  }
  if (c.word('APPEND')) {
    if (c.isWord(['ON', 'OFF'])) refuse(c, 'YES or NO (APPEND ON and APPEND OFF are Db2 for LUW)');
    return { action: 'APPEND', value: yes(c) };
  }
  if (c.word('AUDIT')) return { action: 'AUDIT', value: only(c, ['NONE', 'CHANGES', 'ALL']) };
  if (c.word('VALIDPROC')) return { action: 'VALIDPROC', program: c.word('NULL') ? null : name(c) };
  if (c.isWord('ENABLE') && c.isWord('ARCHIVE', 1)) { c.pos += 2; c.expectWord('USE'); return { action: 'ENABLE ARCHIVE', archiveTable: name(c) }; }
  if (c.isWord('DISABLE') && c.isWord('ARCHIVE', 1)) { c.pos += 2; return { action: 'DISABLE ARCHIVE' }; }
  if (c.isWord('KEY') && c.isWord('LABEL', 1)) { c.pos += 2; return { action: 'KEY LABEL', keyLabel: name(c) }; }
  if (c.isWord('NO') && c.isWord('KEY', 1)) { c.pos += 2; c.expectWord('LABEL'); return { action: 'KEY LABEL', keyLabel: null }; }
  if (c.isWord('SET') && c.isWord(['MATERIALIZED', 'SUMMARY'], 1)) return readSetQuery(c);
  if (first && startsKeyConstraint(c)) return readConstraint(c);
  if (first && (c.isWord('CHECK') || c.isWord('CONSTRAINT'))) refuse(c, 'ADD before a check constraint');
  if (startsKeyConstraint(c)) refuse(c, 'ADD (only a first clause may leave it out before a key)');
  refuse(c, 'an ALTER TABLE clause');
}

const ALONE = new Set(['ADD CLONE', 'DROP CLONE', 'RENAME COLUMN', 'ALTER ORGANIZATION', 'DROP ORGANIZATION', 'ADD VERSIONING', 'DROP VERSIONING', 'DROP COLUMN',
  'ENABLE ARCHIVE', 'DISABLE ARCHIVE', 'ADD MATERIALIZED QUERY', 'DROP MATERIALIZED QUERY']);
// Row and column access control share a statement only with each other, each once (SQLCODE -637).
const ACCESS_CONTROL = /^(?:DE)?ACTIVATE (ROW|COLUMN) ACCESS CONTROL$/;
const REPEATABLE = new Set(['ADD COLUMN', 'ALTER COLUMN', 'ADD CONSTRAINT', 'DROP CONSTRAINT']);
const EXCLUSIVE = ['ALTER COLUMN', 'ADD PARTITION', 'ALTER PARTITION', 'ALTER PARTITIONING', 'ROTATE PARTITION'];

// The reference's notes on the clause list and SQLCODE -628's mutually exclusive clauses: some clauses
// stand alone, the rest appear at most once (ADD COLUMN, ALTER COLUMN and constraints aside), a column
// is added, altered or renamed once, SET DATA TYPE leads, and the partition clauses and ALTER COLUMN
// exclude one another.
function checkClauses(clauses, at) {
  const fail = (message, k) => { throw new Db2Syntax(message, at[k]); };
  const actions = clauses.map((x) => x.action);
  const seen = new Set();
  const columns = new Set();
  let other = false;
  clauses.forEach((x, k) => {
    if (ALONE.has(x.action) && clauses.length > 1) fail(`${x.action} takes no other clause in the same ALTER TABLE statement`, k);
    const access = ACCESS_CONTROL.exec(x.action);
    if (access && clauses.some((y) => !ACCESS_CONTROL.test(y.action))) fail(`${x.action} takes no clause but the other access control clause`, k);
    const key = x.action === 'ADD PERIOD' ? `ADD PERIOD ${x.period.name}` : access ? `ACTIVATE or DEACTIVATE ${access[1]} ACCESS CONTROL` : REPEATABLE.has(x.action) ? null : x.action;
    if (key && seen.has(key)) fail(`no second ${key} in one ALTER TABLE statement`, k);
    seen.add(key);
    const column = x.action === 'ADD COLUMN' ? x.column.name : x.action === 'ALTER COLUMN' ? x.column : null;
    if (column !== null && columns.has(column.toUpperCase())) fail(`column ${column} is added or altered by a second clause`, k);
    if (column !== null) columns.add(column.toUpperCase());
    const setsType = x.action === 'ALTER COLUMN' && x.change === 'SET DATA TYPE';
    if (setsType && other) fail('ALTER COLUMN … SET DATA TYPE comes before every other clause', k);
    if (!setsType) other = true;
  });
  const partitioning = [...new Set(actions.filter((a) => EXCLUSIVE.includes(a)))];
  if (partitioning.length > 1 && !(partitioning.length === 2 && partitioning.includes('ADD PARTITION') && partitioning.includes('ALTER PARTITION'))) {
    fail(`${partitioning[0]} and ${partitioning[1]} do not share an ALTER TABLE statement`, actions.indexOf(partitioning[1]));
  }
  if (actions.includes('ALTER PARTITIONING') && actions.includes('ADD PARTITION BY RANGE')) fail('ALTER PARTITIONING and ADD PARTITION BY do not share an ALTER TABLE statement', actions.indexOf('ADD PARTITION BY RANGE'));
  if (actions.includes('ALTER COLUMN') && actions.includes('VALIDPROC')) fail('ALTER COLUMN and VALIDPROC do not share an ALTER TABLE statement', actions.indexOf('VALIDPROC'));
  if (actions.includes('ADD ORGANIZATION') && actions.includes('APPEND')) fail('ADD ORGANIZE BY HASH and APPEND do not share an ALTER TABLE statement', actions.indexOf('APPEND'));
  const referencing = clauses.filter((x) => x.action === 'ADD COLUMN' && x.column.constraints.some((k) => k.type === 'FOREIGN KEY'));
  if (referencing.length > 1) fail('at most one added column carries a REFERENCES clause', clauses.indexOf(referencing[1]));
  const drops = clauses.filter((x) => x.action === 'DROP CONSTRAINT');
  if (drops.some((x) => x.type === null) && drops.some((x) => x.type !== null)) {
    fail('DROP CONSTRAINT does not share an ALTER TABLE statement with DROP PRIMARY KEY, UNIQUE, FOREIGN KEY or CHECK', clauses.indexOf(drops[drops.length - 1]));
  }
}

function readAlterTable(c) {
  c.expectWord('ALTER');
  c.expectWord('TABLE');
  if (c.isWord('IF') && c.isWord('EXISTS', 1)) refuse(c, 'a table name');
  const parts = readName(c);
  if (parts.length > 3) refuse(c, 'a table name of at most three parts');
  const node = { kind: 'ALTER TABLE', name: parts.join('.'), clauses: [] };
  const at = [];
  do {
    at.push(c.peek());
    node.clauses.push(readClause(c, node.clauses.length === 0));
  } while (!c.done());
  checkClauses(node.clauses, at);
  return node;
}

export const parsers = {
  'ALTER TABLE': (c) => readAlterTable(c),
};
