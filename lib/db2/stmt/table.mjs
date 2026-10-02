// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 for z/OS CREATE TABLE, CREATE GLOBAL TEMPORARY TABLE and CREATE AUXILIARY TABLE, after the
// Db2 13 SQL Reference: columns with their types, nullability, defaults and constraints, the table's
// constraints and periods, and the clauses that place and describe the table.

import { cursor } from '../cursor.mjs';

const isName = (t) => !!t && (t.t === 'word' || t.t === 'ident');

export function readName(c) {
  const t = c.next();
  if (!isName(t)) { c.pos -= t ? 1 : 0; c.fail('a name'); }
  const parts = [t.v];
  while (c.op('.')) {
    const p = c.next();
    if (!isName(p)) { c.pos -= p ? 1 : 0; c.fail('a name part'); }
    parts.push(p.v);
  }
  return parts;
}

function readInteger(c) {
  const t = c.next();
  if (!t || t.t !== 'num' || !/^\d+$/.test(t.v)) { c.pos -= t ? 1 : 0; c.fail('an integer'); }
  return Number(t.v);
}

function readNumber(c) {
  const sign = c.op('-') ? '-' : (c.op('+'), '');
  const t = c.next();
  if (!t || t.t !== 'num') { c.pos -= t ? 1 : 0; c.fail('a number'); }
  return sign + t.v;
}

function readNameList(c) {
  return c.items().map((item) => {
    const s = cursor(item);
    const name = readName(s);
    if (!s.done()) s.fail("',' or ')'");
    return name.join('.');
  });
}

function only(c, words) {
  const t = c.expectWord(words);
  return t.u;
}

// (n) or (nK), (nM), (nG): a LOB or DSSIZE length.
function readSize(c) {
  const n = readInteger(c);
  const unit = c.word(['K', 'M', 'G']);
  return unit ? `${n}${unit.u}` : n;
}

function readLength(c, withUnit = false) {
  const s = cursor(c.group());
  const length = withUnit ? readSize(s) : readInteger(s);
  if (!s.done()) s.fail("')'");
  return length;
}

function readCcsidAndData(c, type) {
  for (;;) {
    if (c.isWord('FOR') && c.isWord(['SBCS', 'MIXED', 'BIT'], 1) && c.isWord('DATA', 2)) {
      c.next();
      type.forData = c.next().u;
      c.next();
    } else if (c.isWord('CCSID') && c.peek(1) && c.peek(1).t === 'num') {
      c.next();
      type.ccsid = readInteger(c);
    } else return type;
  }
}

const NUMERIC = { SMALLINT: 'SMALLINT', INTEGER: 'INTEGER', INT: 'INTEGER', BIGINT: 'BIGINT', REAL: 'REAL' };
const NOT_A_TYPE = new Set(['NOT', 'NULL', 'DEFAULT', 'WITH', 'GENERATED', 'CONSTRAINT', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CHECK']);

export function readDataType(c) {
  const t = c.peek();
  if (!isName(t)) c.fail('a data type');
  const u = t.t === 'word' ? t.u : null;
  if (u && NUMERIC[u]) { c.next(); return { name: NUMERIC[u] }; }
  if (u === 'DECIMAL' || u === 'DEC' || u === 'NUMERIC') {
    c.next();
    const type = { name: 'DECIMAL', precision: 5, scale: 0 };
    if (c.isOp('(')) {
      const s = cursor(c.group());
      type.precision = readInteger(s);
      if (s.op(',')) type.scale = readInteger(s);
      if (!s.done()) s.fail("')'");
    }
    return type;
  }
  if (u === 'FLOAT') { c.next(); return { name: 'FLOAT', precision: c.isOp('(') ? readLength(c) : 53 }; }
  if (u === 'DOUBLE') { c.next(); c.word('PRECISION'); return { name: 'DOUBLE' }; }
  if (u === 'DECFLOAT') {
    c.next();
    const precision = c.isOp('(') ? readLength(c) : 34;
    if (precision !== 16 && precision !== 34) c.fail('DECFLOAT(16) or DECFLOAT(34)');
    return { name: 'DECFLOAT', precision };
  }
  // LONG VARCHAR and LONG VARGRAPHIC stay for compatibility; Db2 works out their length.
  if (u === 'LONG' && c.isWord(['VARCHAR', 'VARGRAPHIC'], 1)) {
    c.next();
    const name = c.next().u;
    return name === 'VARCHAR' ? readCcsidAndData(c, { name, long: true }) : { name, long: true };
  }
  if (u === 'CHARACTER' || u === 'CHAR' || u === 'VARCHAR' || u === 'CLOB') {
    c.next();
    let name = u === 'VARCHAR' ? 'VARCHAR' : u === 'CLOB' ? 'CLOB' : 'CHAR';
    if (name === 'CHAR' && c.word('VARYING')) name = 'VARCHAR';
    else if (name === 'CHAR' && c.isWord('LARGE') && c.isWord('OBJECT', 1)) { c.next(); c.next(); name = 'CLOB'; }
    const type = { name };
    if (name === 'VARCHAR') type.length = readLength(c);
    else if (name === 'CLOB') type.length = c.isOp('(') ? readLength(c, true) : '1M';
    else type.length = c.isOp('(') ? readLength(c) : 1;
    return readCcsidAndData(c, type);
  }
  if (u === 'GRAPHIC' || u === 'VARGRAPHIC' || u === 'DBCLOB') {
    c.next();
    const type = { name: u };
    if (u === 'VARGRAPHIC') type.length = readLength(c);
    else if (u === 'DBCLOB') type.length = c.isOp('(') ? readLength(c, true) : '1M';
    else type.length = c.isOp('(') ? readLength(c) : 1;
    if (c.word('CCSID')) type.ccsid = readInteger(c);
    return type;
  }
  if (u === 'BINARY' || u === 'VARBINARY' || u === 'BLOB') {
    c.next();
    let name = u;
    if (u === 'BINARY' && c.word('VARYING')) name = 'VARBINARY';
    else if (u === 'BINARY' && c.isWord('LARGE') && c.isWord('OBJECT', 1)) { c.next(); c.next(); name = 'BLOB'; }
    if (name === 'VARBINARY') return { name, length: readLength(c) };
    if (name === 'BLOB') return { name, length: c.isOp('(') ? readLength(c, true) : '1M' };
    return { name, length: c.isOp('(') ? readLength(c) : 1 };
  }
  if (u === 'DATE' || u === 'TIME' || u === 'ROWID') { c.next(); return { name: u }; }
  if (u === 'TIMESTAMP') {
    c.next();
    const type = { name: 'TIMESTAMP', precision: c.isOp('(') ? readLength(c) : 6, timeZone: false };
    if (c.isWord(['WITH', 'WITHOUT']) && ((c.isWord('TIME', 1) && c.isWord('ZONE', 2)) || c.isWord('TIMEZONE', 1))) {
      type.timeZone = c.next().u === 'WITH';
      if (!c.word('TIMEZONE')) { c.next(); c.next(); }
    }
    return type;
  }
  if (u === 'XML') {
    c.next();
    return c.isOp('(') ? { name: 'XML', modifier: c.group() } : { name: 'XML' };
  }
  if (u && NOT_A_TYPE.has(u)) c.fail('a data type');
  return { name: 'DISTINCT', distinct: readName(c).join('.') };
}

// A default is a constant, SESSION_USER or USER, CURRENT SQLID, NULL, or a distinct type's cast
// function applied to one of those; DEFAULT alone takes the type's own default.
function readDefault(c) {
  const t = c.peek();
  if (!t) return { implicit: true };
  if (t.t === 'lit') { c.next(); return { constant: t.v, prefix: t.prefix }; }
  if (t.t === 'num' || (t.t === 'op' && (t.v === '-' || t.v === '+'))) return { constant: readNumber(c) };
  if (c.word(['SESSION_USER', 'USER'])) return { register: 'SESSION_USER' };
  if (c.word('NULL')) return { null: true };
  if (c.isWord('CURRENT')) {
    c.next();
    c.expectWord('SQLID');
    return { register: 'CURRENT SQLID' };
  }
  if (isName(t) && (c.isOp('(', 1) || (c.isOp('.', 1) && c.isOp('(', 3)))) {
    const cast = readName(c).join('.');
    const s = cursor(c.group());
    const value = readDefault(s);
    if (value.implicit || !s.done()) s.fail('a constant, SESSION_USER, USER, CURRENT SQLID or NULL');
    return { cast, ...value };
  }
  return { implicit: true };
}

const NO_OPTION = { MINVALUE: 'minValue', MAXVALUE: 'maxValue', CYCLE: 'cycle', CACHE: 'cache', ORDER: 'order' };

// NOCACHE, NOCYCLE, NOMINVALUE, NOMAXVALUE and NOORDER are IBM's synonyms for the two-word forms.
function readIdentityOptions(c) {
  const options = {};
  if (!c.isOp('(')) return options;
  const s = cursor(c.group());
  while (!s.done()) {
    if (s.word('START')) { s.expectWord('WITH'); options.startWith = readNumber(s); }
    else if (s.word('INCREMENT')) { s.expectWord('BY'); options.incrementBy = readNumber(s); }
    else if (s.word('MINVALUE')) options.minValue = readNumber(s);
    else if (s.word('MAXVALUE')) options.maxValue = readNumber(s);
    else if (s.word('CYCLE')) options.cycle = true;
    else if (s.word('ORDER')) options.order = true;
    else if (s.word('CACHE')) options.cache = readInteger(s);
    else if (s.word('NO')) options[NO_OPTION[only(s, Object.keys(NO_OPTION))]] = false;
    else if (s.isWord(Object.keys(NO_OPTION).map((w) => `NO${w}`))) options[NO_OPTION[s.next().u.slice(2)]] = false;
    else s.fail('an identity attribute');
    s.op(',');
  }
  return options;
}

function readGenerated(c) {
  c.expectWord('GENERATED');
  const when = c.word('ALWAYS') ? 'ALWAYS' : (c.expectWord('BY'), c.expectWord('DEFAULT'), 'BY DEFAULT');
  if (c.word('FOR')) {
    for (const w of ['EACH', 'ROW', 'ON', 'UPDATE', 'AS', 'ROW', 'CHANGE', 'TIMESTAMP']) c.expectWord(w);
    return { when, as: 'ROW CHANGE TIMESTAMP' };
  }
  if (!c.word('AS')) return { when };
  if (c.word('IDENTITY')) return { when, as: 'IDENTITY', identity: readIdentityOptions(c) };
  if (when !== 'ALWAYS') c.fail('AS IDENTITY or FOR EACH ROW ON UPDATE');
  if (c.word('TRANSACTION')) { c.expectWord('START'); c.expectWord('ID'); return { when, as: 'TRANSACTION START ID' }; }
  if (c.word('ROW')) {
    const which = only(c, ['BEGIN', 'START', 'END']);
    return { when, as: `ROW ${which === 'START' ? 'BEGIN' : which}` };
  }
  return { when, as: 'EXPRESSION', expression: c.group() };
}

function readReferences(c) {
  c.expectWord('REFERENCES');
  const ref = { table: readName(c).join('.'), columns: null };
  if (c.isOp('(')) {
    const parts = c.items();
    ref.columns = [];
    for (const p of parts) {
      const s = cursor(p);
      if (s.word('PERIOD')) { s.expectWord('BUSINESS_TIME'); ref.period = 'BUSINESS_TIME'; }
      else ref.columns.push(readName(s).join('.'));
      if (!s.done()) s.fail("',' or ')'");
    }
  }
  for (;;) {
    if (c.isWord('ON') && c.isWord('DELETE', 1)) {
      c.next();
      c.next();
      if (c.word('NO')) { c.expectWord('ACTION'); ref.onDelete = 'NO ACTION'; }
      else if (c.word('SET')) { c.expectWord('NULL'); ref.onDelete = 'SET NULL'; }
      else ref.onDelete = only(c, ['RESTRICT', 'CASCADE']);
    } else if (c.word('ENFORCED')) ref.enforced = true;
    else if (c.isWord('NOT') && c.isWord('ENFORCED', 1)) { c.next(); c.next(); ref.enforced = false; }
    else if (c.isWord('ENABLE') && c.isWord('QUERY', 1)) { c.next(); c.next(); c.expectWord('OPTIMIZATION'); ref.queryOptimization = true; }
    else return ref;
  }
}

function readColumnConstraint(c) {
  const name = c.word('CONSTRAINT') ? readName(c).join('.') : null;
  if (c.word('PRIMARY')) { c.expectWord('KEY'); return { type: 'PRIMARY KEY', name }; }
  if (c.word('UNIQUE')) return { type: 'UNIQUE', name };
  if (c.isWord('REFERENCES')) return { type: 'FOREIGN KEY', name, references: readReferences(c) };
  if (c.word('CHECK')) return { type: 'CHECK', name, condition: c.group() };
  c.fail('PRIMARY KEY, UNIQUE, REFERENCES or CHECK');
}

const startsColumnConstraint = (c) => c.isWord(['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'REFERENCES']) || (c.isWord('CHECK') && c.isOp('(', 1));

export function readColumnDefinition(c) {
  const col = { name: readName(c).join('.'), type: null, notNull: false, constraints: [] };
  if (!c.isWord('GENERATED')) col.type = readDataType(c);
  const once = (key) => { if (key in col) c.fail(`no second ${key}`); };
  while (!c.done()) {
    if (c.isWord('NOT') && c.isWord('NULL', 1)) { c.next(); c.next(); col.notNull = true; }
    else if (c.isWord('WITH') && c.isWord('DEFAULT', 1)) { once('default'); c.next(); c.next(); col.default = readDefault(c); }
    else if (c.word('DEFAULT')) { once('default'); col.default = readDefault(c); }
    else if (c.isWord('GENERATED')) { once('generated'); col.generated = readGenerated(c); }
    else if (startsColumnConstraint(c)) col.constraints.push(readColumnConstraint(c));
    else if (c.word('FIELDPROC')) {
      col.fieldproc = { program: readName(c).join('.'), args: c.isOp('(') ? c.items() : [] };
    } else if (c.isWord('AS') && c.isWord('SECURITY', 1)) { c.next(); c.next(); c.expectWord('LABEL'); col.securityLabel = true; }
    else if (c.word('IMPLICITLY')) { c.expectWord('HIDDEN'); col.hidden = true; }
    else if (c.word('INLINE')) { c.expectWord('LENGTH'); col.inlineLength = readInteger(c); }
    else c.fail('a column attribute');
  }
  if (!col.type && !(col.generated && col.generated.as === 'ROW CHANGE TIMESTAMP')) c.fail('a data type');
  return col;
}

function readKeyColumns(c, allowPeriod) {
  const columns = [];
  let period = null;
  for (const p of c.items()) {
    const s = cursor(p);
    if (allowPeriod === 'unique' && s.isWord('BUSINESS_TIME') && s.isWord('WITHOUT', 1)) {
      s.next(); s.next(); s.expectWord('OVERLAPS'); period = 'BUSINESS_TIME WITHOUT OVERLAPS';
    } else if (allowPeriod === 'foreign' && s.word('PERIOD')) { s.expectWord('BUSINESS_TIME'); period = 'BUSINESS_TIME'; }
    else columns.push(readName(s).join('.'));
    if (!s.done()) s.fail("',' or ')'");
  }
  return period ? { columns, period } : { columns };
}

function readTableConstraint(c) {
  const name = c.word('CONSTRAINT') ? readName(c).join('.') : null;
  if (c.word('PRIMARY')) { c.expectWord('KEY'); return { type: 'PRIMARY KEY', name, ...readKeyColumns(c, 'unique') }; }
  if (c.word('UNIQUE')) return { type: 'UNIQUE', name, ...readKeyColumns(c, 'unique') };
  if (c.word('FOREIGN')) {
    c.expectWord('KEY');
    const key = readKeyColumns(c, 'foreign');
    return { type: 'FOREIGN KEY', name, ...key, references: readReferences(c) };
  }
  if (c.word('CHECK')) return { type: 'CHECK', name, condition: c.group() };
  c.fail('PRIMARY KEY, UNIQUE, FOREIGN KEY or CHECK');
}

function readPeriod(c) {
  c.expectWord('PERIOD');
  c.word('FOR');
  const period = { name: only(c, ['SYSTEM_TIME', 'BUSINESS_TIME']) };
  const s = cursor(c.group());
  period.begin = readName(s).join('.');
  s.expectOp(',');
  period.end = readName(s).join('.');
  if (period.name === 'BUSINESS_TIME') { const k = s.word(['EXCLUSIVE', 'INCLUSIVE']); if (k) period.endpoint = k.u; }
  if (!s.done()) s.fail("')'");
  return period;
}

const startsTableConstraint = (c) =>
  c.isWord('CONSTRAINT') || (c.isWord('PRIMARY') && c.isWord('KEY', 1)) || (c.isWord('UNIQUE') && c.isOp('(', 1)) ||
  (c.isWord('FOREIGN') && c.isWord('KEY', 1)) || (c.isWord('CHECK') && c.isOp('(', 1));

function readElements(c, node) {
  for (const item of c.items()) {
    const s = cursor(item);
    if (!item.length) c.fail('a column definition');
    if (s.isWord('PERIOD') && (s.isWord('FOR', 1) || s.isWord(['SYSTEM_TIME', 'BUSINESS_TIME'], 1))) node.periods.push(readPeriod(s));
    else if (startsTableConstraint(s)) node.constraints.push(readTableConstraint(s));
    else node.columns.push(readColumnDefinition(s));
    if (!s.done()) s.fail("',' or ')'");
  }
}

function readCopyOptions(c, node) {
  for (;;) {
    const verb = c.isWord(['EXCLUDING', 'INCLUDING']) ? c.peek().u : null;
    if (verb && c.isWord('IDENTITY', 1)) { c.next(); c.next(); if (c.word('COLUMN')) c.expectWord('ATTRIBUTES'); node.copy.identity = verb; }
    else if (verb && c.isWord('ROW', 1)) {
      c.next(); c.next(); c.expectWord('CHANGE'); c.expectWord('TIMESTAMP');
      if (c.word('COLUMN')) c.expectWord('ATTRIBUTES');
      node.copy.rowChangeTimestamp = verb;
    } else if (verb && (c.isWord('COLUMN', 1) || c.isWord('DEFAULTS', 1))) { c.next(); c.word('COLUMN'); c.expectWord('DEFAULTS'); node.copy.defaults = verb; }
    else if (c.isWord('USING') && c.isWord('TYPE', 1)) { c.next(); c.next(); c.expectWord('DEFAULTS'); node.copy.defaults = 'USING TYPE'; }
    else if (verb === 'EXCLUDING' && c.isWord('XML', 1)) { c.next(); c.next(); c.expectWord('TYPE'); c.expectWord('MODIFIERS'); node.copy.xmlTypeModifiers = 'EXCLUDING'; }
    else return;
  }
}

function readRefreshOptions(c, node) {
  const mq = node.asResult;
  for (;;) {
    if (c.isWord('DATA') && c.isWord('INITIALLY', 1)) { c.next(); c.next(); c.expectWord('DEFERRED'); mq.dataInitiallyDeferred = true; }
    else if (c.isWord('REFRESH') && c.isWord('DEFERRED', 1)) { c.next(); c.next(); mq.refreshDeferred = true; }
    else if (c.word('MAINTAINED')) { c.expectWord('BY'); mq.maintainedBy = only(c, ['SYSTEM', 'USER']); }
    else if (c.isWord(['ENABLE', 'DISABLE']) && c.isWord('QUERY', 1)) { mq.queryOptimization = c.next().u === 'ENABLE'; c.next(); c.expectWord('OPTIMIZATION'); }
    else return;
  }
}

function readPartitioning(c) {
  c.expectWord('PARTITION');
  c.expectWord('BY');
  if (c.word('SIZE')) {
    const p = { by: 'SIZE' };
    if (c.word('EVERY')) { p.every = readInteger(c); c.expectWord('G'); }
    return p;
  }
  c.word('RANGE');
  const p = { by: 'RANGE', columns: [], partitions: [] };
  for (const item of c.items()) {
    const s = cursor(item);
    const col = { name: readName(s).join('.') };
    if (s.word('NULLS')) { s.expectWord('LAST'); col.nullsLast = true; }
    const order = s.word(['ASC', 'DESC']);
    if (order) col.order = order.u;
    if (!s.done()) s.fail("',' or ')'");
    p.columns.push(col);
  }
  for (const item of c.items()) {
    const s = cursor(item);
    s.expectWord(['PARTITION', 'PART']);
    const part = { number: readInteger(s) };
    if (!s.word('VALUES')) { s.expectWord('ENDING'); s.word('AT'); }
    part.limits = s.items().map((v) => {
      const vs = cursor(v);
      const limit = vs.word(['MAXVALUE', 'MINVALUE']) ? v[0].u : vs.peek() && vs.peek().t === 'lit' ? vs.next().v : readNumber(vs);
      if (!vs.done()) vs.fail("',' or ')'");
      return limit;
    });
    if (s.word('INCLUSIVE')) part.inclusive = true;
    if (s.word('HASH')) { s.expectWord('SPACE'); part.hashSpace = readSize(s); }
    if (!s.done()) s.fail("',' or ')'");
    p.partitions.push(part);
  }
  return p;
}

function readOrganization(c) {
  c.expectWord('ORGANIZE');
  c.expectWord('BY');
  c.expectWord('HASH');
  c.expectWord('UNIQUE');
  const org = { by: 'HASH', columns: readNameList(c) };
  if (c.word('HASH')) { c.expectWord('SPACE'); org.space = readSize(c); }
  return org;
}

// Placement and attribute clauses, in any order, each at most once.
function readTableOptions(c, node) {
  const set = (key, value) => {
    if (key in node.options) c.fail(`no second ${key}`);
    node.options[key] = value;
  };
  while (!c.done()) {
    if (c.word('IN')) {
      if (c.word('DATABASE')) set('in', { database: readName(c).join('.') });
      else if (c.word('ACCELERATOR')) set('in', { accelerator: readName(c).join('.') });
      else {
        const parts = readName(c);
        if (parts.length > 2) c.fail('database-name.table-space-name');
        set('in', parts.length === 2 ? { database: parts[0], tableSpace: parts[1] } : { tableSpace: parts[0] });
      }
    } else if (c.isWord('PARTITION') && c.isWord('BY', 1)) set('partitioning', readPartitioning(c));
    else if (c.isWord('ORGANIZE')) set('organization', readOrganization(c));
    else if (c.word('EDITPROC')) {
      const editproc = { program: readName(c).join('.') };
      if (c.isWord(['WITH', 'WITHOUT']) && c.isWord('ROW', 1)) { editproc.rowAttributes = c.next().u === 'WITH'; c.next(); c.expectWord('ATTRIBUTES'); }
      set('editproc', editproc);
    } else if (c.word('VALIDPROC')) set('validproc', readName(c).join('.'));
    else if (c.word('AUDIT')) set('audit', only(c, ['NONE', 'CHANGES', 'ALL']));
    else if (c.word('OBID')) set('obid', readInteger(c));
    else if (c.isWord('DATA') && c.isWord('CAPTURE', 1)) { c.next(); c.next(); set('dataCapture', only(c, ['NONE', 'CHANGES'])); }
    else if (c.isWord('WITH') && c.isWord('RESTRICT', 1)) { c.next(); c.next(); c.expectWord('ON'); c.expectWord('DROP'); set('restrictOnDrop', true); }
    else if (c.word('CCSID')) set('ccsid', only(c, ['ASCII', 'EBCDIC', 'UNICODE']));
    else if (c.isWord('NOT') && c.isWord('VOLATILE', 1)) { c.next(); c.next(); c.word('CARDINALITY'); set('volatile', false); }
    else if (c.word('VOLATILE')) { c.word('CARDINALITY'); set('volatile', true); }
    else if (c.isWord('NOT') && c.isWord('LOGGED', 1)) { c.next(); c.next(); set('logged', false); }
    else if (c.word('LOGGED')) set('logged', true);
    else if (c.word('COMPRESS')) {
      const yes = only(c, ['YES', 'NO']) === 'YES';
      const how = yes && c.word(['FIXEDLENGTH', 'HUFFMAN']);
      set('compress', yes ? (how ? how.u : 'YES') : 'NO');
    } else if (c.word('APPEND')) set('append', only(c, ['YES', 'NO']) === 'YES');
    else if (c.word('DSSIZE')) { const n = readInteger(c); c.expectWord('G'); set('dssize', `${n}G`); }
    else if (c.word('BUFFERPOOL')) set('bufferpool', readName(c).join('.'));
    else if (c.isWord('MEMBER') && c.isWord('CLUSTER', 1)) { c.next(); c.next(); set('memberCluster', true); }
    else if (c.word('TRACKMOD')) set('trackmod', only(c, ['YES', 'NO']) === 'YES');
    else if (c.word('PAGENUM')) set('pagenum', only(c, ['RELATIVE', 'ABSOLUTE']));
    else if (c.isWord('NO') && c.isWord('KEY', 1)) { c.next(); c.next(); c.expectWord('LABEL'); set('keyLabel', null); }
    else if (c.isWord('KEY') && c.isWord('LABEL', 1)) { c.next(); c.next(); set('keyLabel', readName(c).join('.')); }
    else c.fail('a table clause');
  }
}

function readBaseTable(c, kind) {
  const node = { kind, table: 'BASE', name: readName(c).join('.'), columns: [], constraints: [], periods: [], options: {} };
  if (c.word('LIKE')) {
    node.like = readName(c).join('.');
    node.copy = {};
    readCopyOptions(c, node);
  } else {
    let names = null;
    if (c.isOp('(')) {
      const at = c.pos;
      const group = c.group();
      if (c.isWord('AS')) names = cursor([{ t: 'op', v: '(' }, ...group, { t: 'op', v: ')' }]);
      else { c.pos = at; readElements(c, node); }
    }
    if (c.word('AS')) {
      node.asResult = { columns: names ? readNameList(names) : null, fullselect: c.group() };
      const withNoData = c.isWord('WITH') && c.isWord('NO', 1) && c.isWord('DATA', 2);
      if (withNoData || (c.isWord('DEFINITION') && c.isWord('ONLY', 1))) {
        c.pos += withNoData ? 3 : 2;
        node.asResult.withNoData = true;
        node.copy = {};
        readCopyOptions(c, node);
      } else {
        node.table = 'MATERIALIZED QUERY';
        readRefreshOptions(c, node);
        if (!node.asResult.dataInitiallyDeferred || !node.asResult.refreshDeferred) c.fail('WITH NO DATA or DATA INITIALLY DEFERRED REFRESH DEFERRED');
      }
    } else if (!node.columns.length && !node.constraints.length) c.fail("'(', LIKE or AS");
  }
  readTableOptions(c, node);
  return node;
}

function readTemporaryTable(c, kind) {
  c.expectWord('GLOBAL');
  c.expectWord('TEMPORARY');
  c.expectWord('TABLE');
  const node = { kind, table: 'GLOBAL TEMPORARY', name: readName(c).join('.'), columns: [] };
  if (c.word('LIKE')) node.like = readName(c).join('.');
  else {
    for (const item of c.items()) {
      const s = cursor(item);
      const col = { name: readName(s).join('.'), type: readDataType(s), notNull: false };
      if (s.isWord('NOT') && s.isWord('NULL', 1)) { s.next(); s.next(); col.notNull = true; }
      if (!s.done()) s.fail("NOT NULL, ',' or ')'");
      node.columns.push(col);
    }
  }
  if (c.word('CCSID')) node.ccsid = only(c, ['ASCII', 'EBCDIC', 'UNICODE']);
  return node;
}

function readAuxiliaryTable(c, kind) {
  c.expectWord(['AUXILIARY', 'AUX']);
  c.expectWord('TABLE');
  const node = { kind, table: 'AUXILIARY', name: readName(c).join('.') };
  c.expectWord('IN');
  const space = readName(c);
  if (space.length > 2) c.fail('database-name.table-space-name');
  node.in = space.length === 2 ? { database: space[0], tableSpace: space[1] } : { tableSpace: space[0] };
  c.expectWord('STORES');
  node.stores = readName(c).join('.');
  if (c.word('APPEND')) node.append = only(c, ['YES', 'NO']) === 'YES';
  c.expectWord('COLUMN');
  node.column = readName(c).join('.');
  if (c.word('PART')) node.part = readInteger(c);
  return node;
}

export const parsers = {
  'CREATE TABLE': (c) => {
    c.expectWord('CREATE');
    if (c.isWord('GLOBAL')) return readTemporaryTable(c, 'CREATE TABLE');
    if (c.isWord(['AUXILIARY', 'AUX'])) return readAuxiliaryTable(c, 'CREATE TABLE');
    c.word('SUMMARY');
    c.expectWord('TABLE');
    return readBaseTable(c, 'CREATE TABLE');
  },
};
