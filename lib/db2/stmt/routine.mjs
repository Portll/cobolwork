// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 for z/OS CREATE PROCEDURE (native SQL, external, external SQL) and CREATE FUNCTION (external
// scalar, SQL scalar), after the Db2 13 SQL Reference; an SQL routine body is kept as its tokens.

import { cursor, Db2Syntax } from '../cursor.mjs';
import { readName, readInteger, readNumber, readDataType } from './table.mjs';

// Form codes: N native SQL procedure, E external procedure, X external SQL procedure, F external
// scalar function, S SQL scalar function; c marks a clause a native SQL procedure accepts and ignores.
const ROUTINES = { N: 'NATIVE SQL', E: 'EXTERNAL', X: 'EXTERNAL SQL', F: 'EXTERNAL SCALAR', S: 'SQL SCALAR' };
const LABELS = { N: 'native SQL procedure', E: 'external procedure', X: 'external SQL procedure', F: 'external scalar function', S: 'SQL scalar function' };
const A = { N: 'a native SQL procedure', E: 'an external procedure', X: 'an external SQL procedure', F: 'an external scalar function', S: 'an SQL scalar function' };
const ALL = 'NEXFS';
const ENCODINGS = ['ASCII', 'EBCDIC', 'UNICODE'];
const FORMATS = ['ISO', 'EUR', 'USA', 'JIS', 'LOCAL'];

const isName = (t) => !!t && (t.t === 'word' || t.t === 'ident');
const name = (c) => readName(c).join('.');

function identifier(c) {
  const t = c.next();
  if (!isName(t)) { c.pos -= t ? 1 : 0; c.fail('a name'); }
  return t.v;
}

function string(c) {
  const t = c.next();
  if (!t || t.t !== 'lit') { c.pos -= t ? 1 : 0; c.fail('a string constant'); }
  return t.v;
}

// What another dialect's routine looks like at the token where a Db2 for z/OS one stops.
function hint(t, after) {
  if (!t) return '';
  const next = after && after.t === 'word' ? after.u : null;
  if (t.t === 'op' && t.v === '/' && after && after.v === '/') return ' (a MySQL DELIMITER terminator, not Db2 for z/OS)';
  if (t.t !== 'word') return '';
  if (t.u === 'AS' || t.u === 'IS') return ` (${t.u} before a routine body is PostgreSQL, Oracle or Transact-SQL, not Db2 for z/OS)`;
  if (t.v.startsWith('$')) return ' (a $-quoted body is PostgreSQL or MySQL, not Db2 for z/OS)';
  if (t.v.startsWith('@')) return ' (an @ parameter is Transact-SQL, not Db2 for z/OS)';
  if (t.u === 'PLPGSQL') return ' (PL/pgSQL is PostgreSQL, not Db2 for z/OS)';
  if (t.u === 'DELIMITER') return ' (a MySQL DELIMITER terminator, not Db2 for z/OS)';
  if (t.u === 'COMMENT' && after && after.t === 'lit') return " (COMMENT 'text' is MySQL, not Db2 for z/OS)";
  if (t.u === 'SQL' && next === 'SECURITY') return ' (SQL SECURITY is MySQL, not Db2 for z/OS)';
  if (t.u === 'THREADSAFE' || (t.u === 'NOT' && (next === 'FENCED' || next === 'THREADSAFE')) || ((t.u === 'NEW' || t.u === 'OLD') && next === 'SAVEPOINT')) {
    return ' (a Db2 for LUW clause, not Db2 for z/OS)';
  }
  return '';
}

function refuse(c, what) {
  const t = c.peek();
  throw new Db2Syntax(`expected ${what}${t ? ` at '${t.v ?? t.t}'` : ' at end of statement'}${hint(t, c.peek(1))}`, t || c.peek(-1));
}

// A routine's CCSID names an encoding scheme where a column's gives a number, so a graphic type is
// read on its own and its CCSID here.
const GRAPHIC = ['GRAPHIC', 'VARGRAPHIC', 'DBCLOB'];
const CHARACTER = ['CHAR', 'VARCHAR', 'CLOB'];

function readType(c) {
  const at = c.pos;
  let type;
  if (c.isWord(GRAPHIC)) {
    c.next();
    if (c.isOp('(')) c.group();
    type = readDataType(cursor(c.slice(at)));
  } else type = readDataType(c);
  const read = c.slice(at);
  if (type.long) throw new Db2Syntax(`LONG ${type.name} is not a routine data type in Db2 for z/OS`, read[0]);
  if (typeof type.ccsid === 'number') throw new Db2Syntax('a routine names its CCSID as ASCII, EBCDIC or UNICODE, not a number', read.find((t) => t.t === 'word' && t.u === 'CCSID'));
  if (type.modifier) throw new Db2Syntax('a routine takes XML without a type modifier', read[0]);
  if (type.name === 'DISTINCT') return { name: 'USER-DEFINED', userType: type.distinct };
  if (!CHARACTER.includes(type.name) && !GRAPHIC.includes(type.name)) return type;
  for (;;) {
    if (c.isWord('CCSID') && c.isWord(ENCODINGS, 1)) {
      if ('ccsid' in type) c.fail('no second CCSID');
      c.next();
      type.ccsid = c.next().u;
    } else if (CHARACTER.includes(type.name) && c.isWord('FOR') && c.isWord(['SBCS', 'MIXED', 'BIT'], 1) && c.isWord('DATA', 2)) {
      if ('forData' in type) c.fail('no second FOR … DATA');
      c.next();
      type.forData = c.next().u;
      c.next();
    } else return type;
  }
}

function readParameterType(c, p) {
  if (c.isWord('TABLE') && c.isWord('LIKE', 1)) {
    c.next();
    c.next();
    p.type = { name: 'TABLE LIKE', table: name(c) };
    c.expectWord('AS');
    c.expectWord('LOCATOR');
    p.locator = true;
    return;
  }
  p.type = readType(c);
  if (c.isWord('AS') && c.isWord('LOCATOR', 1)) { c.next(); c.next(); p.locator = true; }
}

// A parameter's name may be left out where the routine allows it: the type is tried first, and only
// when it does not take the whole declaration is the first word a name.
function readParameter(item, procedure, checks) {
  const s = cursor(item);
  if (!item.length) s.fail('a parameter declaration');
  const p = { mode: 'IN', name: null, type: null, locator: false };
  if (item.length > 1 && s.isWord(['IN', 'OUT', 'INOUT'])) {
    if (!procedure) s.fail("a parameter (a Db2 for z/OS function's parameters take no IN, OUT or INOUT)");
    p.mode = s.next().u;
  }
  const at = s.pos;
  let unnamed = false;
  try {
    readParameterType(s, p);
    unnamed = s.done();
  } catch (e) {
    if (!(e instanceof Db2Syntax)) throw e;
  }
  if (!unnamed) {
    s.pos = at;
    p.locator = false;
    p.name = identifier(s);
    if (s.isWord(['IN', 'OUT', 'INOUT'])) s.fail('a data type (a mode after the parameter name is Oracle, not Db2 for z/OS)');
    readParameterType(s, p);
    if (!s.done()) s.fail("',' or ')'");
  }
  checks.push({ type: p.type, locator: p.locator, named: !unnamed, tok: item[at] });
  return p;
}

function readExternalName(c) {
  if (c.peek() && c.peek().t === 'lit') {
    let v = '';
    while (c.peek() && c.peek().t === 'lit') v += c.next().v;
    return { name: v, implicit: false };
  }
  return { name: identifier(c), implicit: false };
}

// (name,*) runs the routine in its caller's WLM environment when another routine calls it.
function readWlmEnvironment(c) {
  if (!c.isOp('(')) return { name: identifier(c), callerEnvironment: false };
  const s = cursor(c.group());
  const env = { name: identifier(s), callerEnvironment: true };
  s.expectOp(',');
  s.expectOp('*');
  if (!s.done()) s.fail("')'");
  return env;
}

function readPackageOwner(c) {
  const owner = { name: identifier(c), as: null };
  if (c.isWord('AS') && c.isWord(['ROLE', 'USER'], 1)) { c.next(); owner.as = c.next().u; }
  return owner;
}

function readSqlPath(c) {
  const path = [];
  do {
    if (c.isWord('SYSTEM') && c.isWord('PATH', 1)) { c.pos += 2; path.push('SYSTEM PATH'); }
    else if (c.isWord(['SESSION_USER', 'USER'])) path.push(c.next().u);
    else path.push(identifier(c));
  } while (c.op(','));
  return path;
}

// Entries as SET CURRENT PACKAGE PATH takes them: collection ids, string constants and registers.
function readPackagePath(c) {
  const path = [];
  do {
    if (c.isWord('CURRENT') && c.isWord('PACKAGE', 1) && c.isWord('PATH', 2)) { c.pos += 3; path.push('CURRENT PACKAGE PATH'); }
    else if (c.isWord('CURRENT') && c.isWord('PATH', 1)) { c.pos += 2; path.push('CURRENT PATH'); }
    else if (c.isWord(['SESSION_USER', 'USER'])) path.push(c.next().u);
    else if (c.peek() && c.peek().t === 'lit') path.push(c.next().v);
    else path.push(identifier(c));
  } while (c.op(','));
  return path;
}

function readDecimalArithmetic(c) {
  const s = cursor(c.group());
  const d = { precision: readInteger(s) };
  if (d.precision !== 15 && d.precision !== 31) { s.pos--; s.fail('15 or 31'); }
  if (s.op(',')) d.scale = readInteger(s);
  if (!s.done()) s.fail("')'");
  return d;
}

function readDegree(c) {
  if (c.word('ANY')) return 'ANY';
  const t = c.next();
  if (!t || t.t !== 'num' || t.v !== '1') { c.pos -= t ? 1 : 0; c.fail('1 or ANY'); }
  return '1';
}

function readStopAfter(c) {
  const n = readInteger(c);
  c.expectWord('FAILURES');
  return n;
}

function readReturns(c, checks) {
  if (c.isWord('TABLE')) c.fail('a data type (table functions are not read)');
  const returns = { type: null, castFrom: null, locator: false };
  let tok = c.peek();
  returns.type = readType(c);
  checks.push({ type: returns.type, tok, returns: true });
  if (c.isWord('CAST') && c.isWord('FROM', 1)) {
    c.next();
    c.next();
    tok = c.peek();
    returns.castFrom = readType(c);
    checks.push({ type: returns.castFrom, tok, returns: true });
  }
  if (c.isWord('AS') && c.isWord('LOCATOR', 1)) { c.next(); c.next(); returns.locator = true; }
  return returns;
}

const clause = (phrase, key, value, forms) => ({ words: phrase.split(' '), key, value, forms });
const failing = (what) => (c) => refuse(c, what);
const yesNo = (head, key, forms) => [clause(`${head} YES`, key, true, forms), clause(`${head} NO`, key, false, forms), clause(head, key, failing('YES or NO'), forms)];
const withWithout = (tail, key, forms) => [clause(`WITH ${tail}`, key, true, forms), clause(`WITHOUT ${tail}`, key, false, forms)];
const choice = (head, key, values, forms) => [
  ...values.map((v) => clause(`${head} ${v}`, key, v, forms)),
  clause(head, key, failing(`${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}`), forms),
];

// Each clause as the reference spells it, with the forms that take it; IBM's synonyms (VARIANT, NULL
// CALL, RESULT SETS, DB2SQL and the rest) read as the clause they stand for.
const CLAUSES = [
  clause('VERSION', 'version', identifier, 'NS'),
  clause('LANGUAGE SQL', 'language', 'SQL', 'NXS'),
  ...['ASSEMBLE', 'C', 'COBOL', 'JAVA', 'PLI'].map((l) => clause(`LANGUAGE ${l}`, 'language', l, 'EF')),
  clause('LANGUAGE REXX', 'language', 'REXX', 'E'),
  clause('LANGUAGE', 'language', failing('ASSEMBLE, C, COBOL, JAVA, PLI, REXX or SQL'), ALL),
  clause('SPECIFIC', 'specific', name, 'NEFS'),
  clause('DETERMINISTIC', 'deterministic', true, ALL),
  clause('NOT DETERMINISTIC', 'deterministic', false, ALL),
  clause('NOT VARIANT', 'deterministic', true, ALL),
  clause('VARIANT', 'deterministic', false, ALL),
  clause('MODIFIES SQL DATA', 'sqlDataAccess', 'MODIFIES SQL DATA', ALL),
  clause('READS SQL DATA', 'sqlDataAccess', 'READS SQL DATA', ALL),
  clause('CONTAINS SQL', 'sqlDataAccess', 'CONTAINS SQL', ALL),
  clause('NO SQL', 'sqlDataAccess', 'NO SQL', 'EF'),
  clause('CALLED ON NULL INPUT', 'calledOnNullInput', true, ALL),
  clause('NULL CALL', 'calledOnNullInput', true, 'NEFS'),
  clause('RETURNS NULL ON NULL INPUT', 'calledOnNullInput', false, 'FS'),
  clause('NOT NULL CALL', 'calledOnNullInput', false, 'FS'),
  clause('DYNAMIC RESULT SETS', 'dynamicResultSets', readInteger, 'NEX'),
  clause('DYNAMIC RESULT SET', 'dynamicResultSets', readInteger, 'NEX'),
  clause('RESULT SETS', 'dynamicResultSets', readInteger, 'NEX'),
  clause('RESULT SET', 'dynamicResultSets', readInteger, 'NEX'),
  ...['ALLOW', 'DISALLOW', 'DISABLE'].map((v) => clause(`${v} DEBUG MODE`, 'debugMode', v, 'NES')),
  ...choice('PARAMETER CCSID', 'parameterCcsid', ENCODINGS, ALL),
  ...choice('PARAMETER VARCHAR', 'parameterVarchar', ['NULTERM', 'STRUCTURE'], 'EXFc'),
  clause('PARAMETER STYLE SQL', 'parameterStyle', 'SQL', 'EF'),
  clause('PARAMETER STYLE DB2SQL', 'parameterStyle', 'SQL', 'EF'),
  clause('PARAMETER STYLE STANDARD CALL', 'parameterStyle', 'SQL', 'E'),
  clause('PARAMETER STYLE GENERAL', 'parameterStyle', 'GENERAL', 'E'),
  clause('PARAMETER STYLE SIMPLE CALL', 'parameterStyle', 'GENERAL', 'E'),
  clause('PARAMETER STYLE GENERAL WITH NULLS', 'parameterStyle', 'GENERAL WITH NULLS', 'Ec'),
  clause('PARAMETER STYLE SIMPLE CALL WITH NULLS', 'parameterStyle', 'GENERAL WITH NULLS', 'E'),
  clause('PARAMETER STYLE JAVA', 'parameterStyle', 'JAVA', 'EF'),
  clause('PARAMETER STYLE', 'parameterStyle', failing('SQL, GENERAL, GENERAL WITH NULLS or JAVA'), ALL),
  clause('PARAMETER', 'parameter', failing('CCSID, VARCHAR or STYLE'), ALL),
  clause('QUALIFIER', 'qualifier', identifier, 'NS'),
  clause('PACKAGE OWNER', 'packageOwner', readPackageOwner, 'NS'),
  clause('ASUTIME NO LIMIT', 'asutime', 'NO LIMIT', ALL),
  clause('ASUTIME LIMIT', 'asutime', readInteger, ALL),
  clause('ASUTIME', 'asutime', failing('NO LIMIT or LIMIT'), ALL),
  clause('COMMIT ON RETURN NO', 'commitOnReturn', 'NO', 'NEX'),
  clause('COMMIT ON RETURN YES', 'commitOnReturn', 'YES', 'NEX'),
  clause('COMMIT ON RETURN', 'commitOnReturn', failing('YES or NO'), 'NEX'),
  clause('AUTONOMOUS', 'commitOnReturn', 'AUTONOMOUS', 'N'),
  clause('INHERIT SPECIAL REGISTERS', 'specialRegisters', 'INHERIT', ALL),
  clause('DEFAULT SPECIAL REGISTERS', 'specialRegisters', 'DEFAULT', ALL),
  clause('WLM ENVIRONMENT FOR DEBUG MODE', 'debugWlmEnvironment', identifier, 'NS'),
  clause('WLM ENVIRONMENT', 'wlmEnvironment', readWlmEnvironment, 'EXF'),
  clause('DEFER PREPARE', 'deferPrepare', true, 'N'),
  clause('NODEFER PREPARE', 'deferPrepare', false, 'N'),
  ...yesNo('CURRENT DATA', 'currentData', 'NS'),
  clause('DEGREE', 'degree', readDegree, 'NS'),
  ...choice('CONCURRENT ACCESS RESOLUTION', 'concurrentAccessResolution', ['USE CURRENTLY COMMITTED', 'WAIT FOR OUTCOME'], 'NS'),
  ...choice('DYNAMICRULES', 'dynamicRules', ['RUN', 'BIND', 'DEFINEBIND', 'DEFINERUN', 'INVOKEBIND', 'INVOKERUN'], 'NS'),
  ...choice('APPLICATION ENCODING SCHEME', 'applicationEncodingScheme', ENCODINGS, 'NS'),
  ...withWithout('EXPLAIN', 'explain', 'NS'),
  ...withWithout('IMMEDIATE WRITE', 'immediateWrite', 'NS'),
  ...withWithout('KEEP DYNAMIC', 'keepDynamic', 'N'),
  ...withWithout('KEEPDYNAMIC', 'keepDynamic', 'N'),
  ...choice('ISOLATION LEVEL', 'isolation', ['CS', 'RS', 'RR', 'UR'], 'NS'),
  clause('OPTHINT', 'optHint', string, 'NS'),
  clause('SQL PATH', 'sqlPath', readSqlPath, 'NS'),
  ...choice('QUERY ACCELERATION', 'queryAcceleration', ['NONE', 'ENABLE WITH FAILBACK', 'ENABLE', 'ELIGIBLE', 'ALL'], 'NS'),
  ...yesNo('GET_ACCEL_ARCHIVE', 'getAccelArchive', 'NS'),
  clause('ACCELERATION WAITFORDATA', 'accelerationWaitForData', (c) => Number(readNumber(c)), 'NS'),
  clause('ACCELERATOR', 'accelerator', identifier, 'NS'),
  ...choice('RELEASE AT', 'releaseAt', ['COMMIT', 'DEALLOCATE'], 'N'),
  ...choice('REOPT', 'reopt', ['NONE', 'ALWAYS', 'ONCE'], 'NS'),
  ...choice('VALIDATE', 'validate', ['RUN', 'BIND'], 'NS'),
  ...choice('ROUNDING', 'rounding', ['DEC_ROUND_CEILING', 'DEC_ROUND_DOWN', 'DEC_ROUND_FLOOR', 'DEC_ROUND_HALF_DOWN', 'DEC_ROUND_HALF_EVEN', 'DEC_ROUND_HALF_UP', 'DEC_ROUND_UP'], 'NS'),
  ...choice('DATE FORMAT', 'dateFormat', FORMATS, 'NS'),
  ...choice('TIME FORMAT', 'timeFormat', FORMATS, 'NS'),
  clause('DECIMAL', 'decimalArithmetic', readDecimalArithmetic, 'NS'),
  ...choice('FOR UPDATE CLAUSE', 'forUpdateClause', ['REQUIRED', 'OPTIONAL'], 'NS'),
  ...yesNo('BUSINESS_TIME SENSITIVE', 'businessTimeSensitive', 'NS'),
  ...yesNo('SYSTEM_TIME SENSITIVE', 'systemTimeSensitive', 'NS'),
  ...yesNo('ARCHIVE SENSITIVE', 'archiveSensitive', 'NS'),
  clause('APPLCOMPAT', 'applcompat', identifier, 'NS'),
  ...choice('CONCENTRATE STATEMENTS', 'concentrateStatements', ['OFF', 'WITH LITERALS'], 'NS'),
  clause('EXTERNAL NAME', 'external', readExternalName, 'EXF'),
  clause('EXTERNAL', 'external', () => ({ name: null, implicit: true }), 'EF'),
  clause('FENCED', 'fenced', true, 'EXF'),
  clause('PACKAGE PATH', 'packagePath', readPackagePath, 'EF'),
  clause('NO PACKAGE PATH', 'packagePath', null, 'EF'),
  clause('DBINFO', 'dbinfo', true, 'EF'),
  clause('NO DBINFO', 'dbinfo', false, 'EXFc'),
  clause('COLLID', 'collid', identifier, 'EXFc'),
  clause('NO COLLID', 'collid', null, 'EXFc'),
  ...yesNo('STAY RESIDENT', 'stayResident', 'EXFc'),
  ...choice('PROGRAM TYPE', 'programType', ['SUB', 'MAIN'], 'EXFc'),
  ...choice('SECURITY', 'security', ['DB2', 'USER', 'DEFINER'], 'EXFc'),
  clause('STOP AFTER SYSTEM DEFAULT FAILURES', 'stopAfterFailures', 'SYSTEM DEFAULT', 'EXFc'),
  clause('STOP AFTER', 'stopAfterFailures', readStopAfter, 'EXFc'),
  clause('CONTINUE AFTER FAILURE', 'stopAfterFailures', false, 'EXFc'),
  clause('CONTINUE AFTER FAILURES', 'stopAfterFailures', false, 'c'),
  clause('RUN OPTIONS', 'runOptions', string, 'EXFc'),
  clause('RETURNS', 'returns', (c, ctx) => readReturns(c, ctx.checks), 'FS'),
  clause('EXTERNAL ACTION', 'externalAction', true, 'FS'),
  clause('NO EXTERNAL ACTION', 'externalAction', false, 'FS'),
  clause('SCRATCHPAD', 'scratchpad', (c) => (c.peek() && c.peek().t === 'num' ? readInteger(c) : 100), 'F'),
  clause('NO SCRATCHPAD', 'scratchpad', false, 'F'),
  clause('FINAL CALL', 'finalCall', true, 'F'),
  clause('NO FINAL CALL', 'finalCall', false, 'F'),
  clause('ALLOW PARALLEL', 'parallel', true, 'FS'),
  clause('DISALLOW PARALLEL', 'parallel', false, 'FS'),
  clause('STATIC DISPATCH', 'staticDispatch', true, 'FS'),
  clause('SECURED', 'secured', true, 'FS'),
  clause('NOT SECURED', 'secured', false, 'FS'),
].sort((a, b) => b.words.length - a.words.length);

// Clauses in any order, each at most once; VERSION only first in a procedure and straight after a
// leading RETURNS in a function, as the reference places it.
function readClauses(c, ctx) {
  const options = {};
  const used = [];
  for (;;) {
    const k = CLAUSES.find((x) => x.words.every((w, i) => c.isWord(w, i)));
    if (!k) return { options, used };
    const tok = c.peek();
    if (k.key in options) c.fail(`no second ${k.key}`);
    if (k.key === 'version' && (ctx.procedure ? used.length > 0 : used.length !== 1 || used[0].k.key !== 'returns')) {
      throw new Db2Syntax(`VERSION comes ${ctx.procedure ? 'before the other clauses' : 'straight after a leading RETURNS'}`, tok);
    }
    c.pos += k.words.length;
    options[k.key] = typeof k.value === 'function' ? k.value(c, ctx) : k.value;
    used.push({ k, tok });
  }
}

const TYPE_FORMS = { ROWID: 'EFS', XML: 'NS', 'USER-DEFINED': 'NEFS', BIGINT: 'NEFS', DECFLOAT: 'NEFS', BINARY: 'NEFS', VARBINARY: 'NEFS' };
const LOCATABLE = ['BLOB', 'CLOB', 'DBCLOB', 'USER-DEFINED'];

function checkTypes(checks, code) {
  for (const { type, locator, named, tok, returns } of checks) {
    const where = returns ? 'RETURNS' : 'a parameter';
    if (named === false && 'NXS'.includes(code)) throw new Db2Syntax(`expected a parameter name: ${A[code]} names each parameter`, tok);
    const forms = TYPE_FORMS[type.name];
    if ((forms && !forms.includes(code)) || (code === 'X' && type.timeZone)) {
      throw new Db2Syntax(`${type.name === 'USER-DEFINED' ? 'a user-defined type' : type.name} is not a type for ${where} of ${A[code]}`, tok);
    }
    if (locator && type.name !== 'TABLE LIKE') {
      if (!'NEF'.includes(code)) throw new Db2Syntax(`AS LOCATOR is not allowed on ${where} of ${A[code]}`, tok);
      if (!LOCATABLE.includes(type.name)) throw new Db2Syntax(`AS LOCATOR takes a LOB or distinct type, not ${type.name}`, tok);
    }
  }
}

// Clauses the form does not take are refused, except those a native SQL procedure accepts for
// compatibility and ignores, which move to options.ignored.
function settle(options, used, code) {
  for (const { k, tok } of used) {
    if (k.forms.includes(code)) continue;
    if (code === 'N' && k.forms.includes('c')) {
      (options.ignored ||= {})[k.key] = options[k.key];
      delete options[k.key];
      continue;
    }
    throw new Db2Syntax(`${k.words.join(' ')} is not a clause of ${A[code]} in Db2 for z/OS`, tok);
  }
}

const CONTROL = ['BEGIN', 'CALL', 'CASE', 'FOR', 'GET', 'GOTO', 'IF', 'ITERATE', 'LEAVE', 'LOOP', 'REPEAT', 'RESIGNAL', 'RETURN', 'SET', 'SIGNAL', 'WHILE'];
const STATEMENTS = [...CONTROL, 'ALTER', 'COMMENT', 'COMMIT', 'CONNECT', 'CREATE', 'DECLARE', 'DELETE', 'DROP', 'EXCHANGE', 'EXECUTE', 'GRANT', 'INSERT', 'LABEL', 'LOCK', 'MERGE', 'REFRESH', 'RELEASE', 'RENAME', 'REVOKE', 'ROLLBACK', 'SAVEPOINT', 'SELECT', 'TRUNCATE', 'UPDATE', 'VALUES'];
const BODY_STARTS = { N: STATEMENTS, X: STATEMENTS.filter((w) => w !== 'FOR'), S: CONTROL };
// The word after the first, where the first alone also opens another dialect's clause.
const SECOND = { COMMENT: 'ON', LABEL: 'ON', DECLARE: 'GLOBAL' };

// The extent of a compound statement: BEGIN and CASE open, END closes the latest, and END IF, END
// LOOP, END WHILE, END REPEAT and END FOR close statements that opened nothing here.
function readCompound(c) {
  const open = [];
  do {
    const t = c.next();
    if (!t) c.fail('END closing the routine body');
    if (t.t !== 'word') continue;
    if (t.u === 'BEGIN' || t.u === 'CASE') open.push(t.u);
    else if (t.u === 'END') {
      if (c.isWord(['IF', 'LOOP', 'WHILE', 'REPEAT', 'FOR'])) c.next();
      else { c.word('CASE'); open.pop(); }
    }
  } while (open.length);
}

const sameName = (a, b) => a.t === b.t && (a.t === 'word' ? a.u === b.u : a.v === b.v);

// The SQL-routine-body: one statement, optionally labelled, kept as tokens. A compound statement must
// end the routine; any other statement runs to the end of it.
function readBody(c, code) {
  const at = c.pos;
  const label = isName(c.peek()) && c.isOp(':', 1) ? c.peek() : null;
  if (label) c.pos += 2;
  const t = c.peek();
  if (!t || t.t !== 'word' || !BODY_STARTS[code].includes(t.u) || (SECOND[t.u] && !c.isWord(SECOND[t.u], 1))) {
    c.pos = at;
    refuse(c, `a Db2 for z/OS ${LABELS[code]} clause or an SQL routine body`);
  }
  if (t.u !== 'BEGIN') { c.drain(); return c.slice(at); }
  readCompound(c);
  if (label && c.peek() && sameName(c.peek(), label)) c.next();
  if (!c.done()) refuse(c, 'the end of the statement after the routine body');
  return c.slice(at);
}

function routineName(c) {
  const parts = readName(c);
  if (c.isOp('/')) c.fail("'(' or a clause ('/' qualifies names in Db2 for i system naming, not Db2 for z/OS)");
  return parts;
}

function newNode(kind, orReplace, parts) {
  const node = { kind, orReplace, routine: null, name: parts.join('.'), parameters: [] };
  if (kind === 'CREATE FUNCTION') node.returns = null;
  return { ...node, language: null, external: null, security: null, wlmEnvironment: null, version: null, options: {}, body: null, wrapped: null };
}

// The obfuscated text of a WRAPPED statement stands for everything after the parameters.
function readWrapped(c, node, code, checks) {
  if (c.done()) c.fail('the obfuscated statement text');
  node.routine = ROUTINES[code];
  node.language = 'SQL';
  node.wrapped = c.drain();
  checkTypes(checks, code);
  return node;
}

// Moves the clauses a security reading needs onto the node: the language, the program that runs
// (EXTERNAL NAME, or the routine's own name when NAME is left out), SECURITY and WLM ENVIRONMENT.
function lift(node, options, code, parts) {
  const external = 'EXF'.includes(code);
  node.routine = ROUTINES[code];
  node.language = options.language ?? 'SQL';
  if (external) {
    const ext = options.external || { name: null, implicit: true };
    node.external = ext.implicit ? { name: parts[parts.length - 1], implicit: true } : ext;
    node.security = options.security ?? 'DB2';
    node.wlmEnvironment = options.wlmEnvironment ?? null;
  }
  node.version = options.version ?? null;
  for (const key of ['language', 'external', 'security', 'wlmEnvironment', 'version']) delete options[key];
  node.options = options;
}

function readProcedure(c) {
  c.expectWord('CREATE');
  const orReplace = c.isWord('OR') && c.isWord('REPLACE', 1);
  if (orReplace) c.pos += 2;
  c.expectWord('PROCEDURE');
  const parts = routineName(c);
  const node = newNode('CREATE PROCEDURE', orReplace, parts);
  const ctx = { procedure: true, checks: [] };
  if (c.isOp('(')) node.parameters = c.items().map((item) => readParameter(item, true, ctx.checks));
  if (c.word('WRAPPED')) return readWrapped(c, node, 'N', ctx.checks);
  const { options, used } = readClauses(c, ctx);
  const language = options.language;
  let code = 'N';
  if (language && language !== 'SQL') code = 'E';
  else if ('external' in options || 'fenced' in options) {
    if (!language) c.fail('LANGUAGE');
    code = 'X';
  }
  settle(options, used, code);
  if (code === 'E') {
    if (!c.done()) refuse(c, `a Db2 for z/OS ${LABELS[code]} clause`);
  } else node.body = readBody(c, code);
  if (code === 'X' && orReplace) throw new Db2Syntax('an external SQL procedure takes no OR REPLACE', c.slice(0, 1)[0]);
  if (code === 'E' && !('external' in options)) c.fail('EXTERNAL');
  checkTypes(ctx.checks, code);
  lift(node, options, code, parts);
  return node;
}

function readFunction(c) {
  c.expectWord('CREATE');
  if (c.isWord('OR') && c.isWord('REPLACE', 1)) c.fail('FUNCTION (Db2 for z/OS has no CREATE OR REPLACE FUNCTION)');
  c.expectWord('FUNCTION');
  const parts = routineName(c);
  const node = newNode('CREATE FUNCTION', false, parts);
  const ctx = { procedure: false, checks: [] };
  if (!c.isOp('(')) c.fail("'(' (a function lists its parameters, if only as ())");
  node.parameters = c.items().map((item) => readParameter(item, false, ctx.checks));
  if (c.word('WRAPPED')) return readWrapped(c, node, 'S', ctx.checks);
  const { options, used } = readClauses(c, ctx);
  if (c.isWord('SOURCE')) c.fail('an external or SQL scalar function clause (sourced functions are not read)');
  const language = options.language;
  let code = 'S';
  if (language && language !== 'SQL') code = 'F';
  else if ('external' in options) {
    if (!language) c.fail('LANGUAGE');
    code = 'F';
  }
  settle(options, used, code);
  if (code === 'F') {
    if (!c.done()) refuse(c, `a Db2 for z/OS ${LABELS[code]} clause`);
  } else node.body = readBody(c, code);
  const { returns } = options;
  if (!returns) c.fail('RETURNS');
  if (code === 'S' && used[0].k.key !== 'returns' && !(node.body[0].t === 'word' && node.body[0].u === 'RETURN')) {
    throw new Db2Syntax('RETURNS comes first in a compiled SQL scalar function; only an inlined one, a single RETURN statement, takes its clauses in any order', used[0].tok);
  }
  if (code === 'S' && (returns.castFrom || returns.locator)) throw new Db2Syntax('CAST FROM and AS LOCATOR in RETURNS are for external functions', used.find((u) => u.k.key === 'returns').tok);
  if (code === 'F' && !('external' in options)) c.fail('EXTERNAL');
  if (code === 'F' && !('parameterStyle' in options)) c.fail('PARAMETER STYLE');
  checkTypes(ctx.checks, code);
  node.returns = returns;
  delete options.returns;
  lift(node, options, code, parts);
  return node;
}

export const parsers = {
  'CREATE PROCEDURE': (c) => readProcedure(c),
  'CREATE FUNCTION': (c) => readFunction(c),
};
