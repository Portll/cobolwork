// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for Db2 GRANT and REVOKE statements.

const PRIVILEGES = new Set([
  'ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER',
  'EXECUTE', 'USAGE', 'BIND', 'COPY', 'CREATEIN', 'ALTERIN', 'DROPIN', 'CONTROL',
  'DBADM', 'DBCTRL', 'DBMAINT', 'SYSADM', 'SYSCTRL', 'SYSOPR', 'SECADM', 'ACCESSCTRL',
  'DATAACCESS', 'BINDADD', 'BINDAGENT', 'CREATETAB', 'CREATETS', 'CREATEDBA', 'CREATEDBC',
  'CREATESG', 'CREATEALIAS', 'DISPLAYDB', 'DROP', 'IMAGCOPY', 'LOAD', 'RECOVERDB', 'REORG',
  'REPAIR', 'STARTDB', 'STATS', 'STOPDB', 'MONITOR1', 'MONITOR2', 'TRACE', 'ARCHIVE', 'BSDS',
  'DISPLAY', 'RECOVER', 'STOPALL', 'STOSPACE', 'CONNECT', 'CREATE_NOT_FENCED_ROUTINE',
  'IMPLICIT_SCHEMA', 'QUIESCE_CONNECT'
]);

const OBJECT_TYPES = new Set(['TABLE', 'DATABASE', 'PLAN', 'PACKAGE', 'COLLECTION', 'SCHEMA', 'PROCEDURE', 'FUNCTION', 'SEQUENCE', 'VARIABLE', 'TYPE', 'JAR']);
const USE_OF = new Set(['STOGROUP', 'TABLESPACE', 'BUFFERPOOL']);

function readName(c) {
  const t = c.peek();
  if (!t) c.fail('a name');
  if (t.t === 'word' || t.t === 'ident') {
    c.next();
    const parts = [t.v];
    while (c.isOp('.')) {
      c.next();
      const nt = c.peek();
      if (!nt || (nt.t !== 'word' && nt.t !== 'ident')) c.fail('a name part');
      c.next();
      parts.push(nt.v);
    }
    return parts;
  }
  c.fail('a name');
}

// UPDATE and REFERENCES may name columns; USE OF STOGROUP, TABLESPACE or BUFFERPOOL is a privilege
// whose objects follow it directly, with no ON.
function readPrivilege(c) {
  const t = c.peek();
  if (!t || t.t !== 'word') c.fail('a privilege');
  if (t.u === 'USE' && c.isWord('OF', 1)) {
    c.next();
    c.next();
    if (c.isWord('ALL') && c.isWord('BUFFERPOOLS', 1)) { c.next(); c.next(); return { name: 'USE', of: 'ALL BUFFERPOOLS', columns: null }; }
    const of = c.expectWord([...USE_OF]).u;
    return { name: 'USE', of, columns: null };
  }
  if (!PRIVILEGES.has(t.u)) c.fail(`privilege '${t.v}'`);
  c.next();
  if (t.u === 'ALL') c.word('PRIVILEGES');
  let columns = null;
  if ((t.u === 'UPDATE' || t.u === 'REFERENCES') && c.isOp('(')) {
    columns = c.items().map((toks) => {
      if (toks.length !== 1 || (toks[0].t !== 'word' && toks[0].t !== 'ident')) c.fail('a column name');
      return toks[0].v;
    });
  }
  return { name: t.u, columns };
}

// A function or procedure may carry its parameter types after its name.
function readObject(c) {
  const parts = readName(c);
  if (c.isOp('(')) c.group();
  return parts;
}

function readGrantee(c) {
  const t = c.peek();
  if (!t || t.t !== 'word') c.fail('a grantee');
  if (t.u === 'PUBLIC') { c.next(); return { type: 'PUBLIC', name: 'PUBLIC' }; }
  if ((t.u === 'ROLE' || t.u === 'USER' || t.u === 'GROUP') && c.peek(1) && (c.peek(1).t === 'word' || c.peek(1).t === 'ident')) {
    c.next();
    return { type: t.u, name: readName(c).join('.') };
  }
  return { type: 'NAME', name: readName(c).join('.') };
}

const list = (c, read) => { const out = [read(c)]; while (c.op(',')) out.push(read(c)); return out; };

// GRANT and REVOKE share everything up to TO or FROM: privileges, then ON an optional object type
// and the objects (TABLE when no type is written), or the objects of USE OF.
function grantBody(c, verb) {
  c.expectWord(verb);
  const privileges = list(c, readPrivilege);
  let objectType = null;
  let objects = null;
  const use = privileges.find((p) => p.name === 'USE');
  if (use) {
    objectType = use.of;
    if (use.of !== 'ALL BUFFERPOOLS') objects = list(c, readObject);
  } else if (c.word('ON')) {
    if (c.isWord('SPECIFIC') && c.isWord('FUNCTION', 1)) { c.next(); c.next(); objectType = 'SPECIFIC FUNCTION'; }
    else if (c.isWord('DISTINCT') && c.isWord('TYPE', 1)) { c.next(); c.next(); objectType = 'DISTINCT TYPE'; }
    else if (c.isWord([...OBJECT_TYPES]) && c.peek(1) && c.peek(1).t !== 'op') objectType = c.next().u;
    else objectType = 'TABLE';
    objects = list(c, readObject);
  }
  c.expectWord(verb === 'GRANT' ? 'TO' : 'FROM');
  return { kind: verb, privileges, objectType, objects, grantees: list(c, readGrantee) };
}

function parseGrant(c) {
  const node = { ...grantBody(c, 'GRANT'), withGrantOption: false, atAllLocations: false };
  for (;;) {
    if (c.isWord('WITH') && c.isWord('GRANT', 1)) { c.next(); c.next(); c.expectWord('OPTION'); node.withGrantOption = true; continue; }
    if (c.isWord('AT') && c.isWord('ALL', 1)) { c.next(); c.next(); c.expectWord('LOCATIONS'); node.atAllLocations = true; continue; }
    return node;
  }
}

function parseRevoke(c) {
  const node = { ...grantBody(c, 'REVOKE'), by: null, dependent: null };
  if (c.word('BY')) node.by = c.word('ALL') ? 'ALL' : list(c, (x) => readName(x).join('.'));
  if (c.word('RESTRICT')) node.dependent = 'RESTRICT';
  else if (c.isWord('INCLUDING') || (c.isWord('NOT') && c.isWord('INCLUDING', 1))) {
    node.dependent = c.word('NOT') ? 'NOT INCLUDING' : 'INCLUDING';
    c.expectWord('INCLUDING');
    c.expectWord('DEPENDENT');
    c.expectWord('PRIVILEGES');
  }
  return node;
}

export const parsers = { GRANT: parseGrant, REVOKE: parseRevoke };
