// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for Db2 miscellaneous DDL and session statements: DROP, COMMENT ON, LABEL ON, SET, RENAME,
// TRUNCATE, CREATE SEQUENCE, ALIAS, SYNONYM, SCHEMA and ROLE.

import { cursor } from '../cursor.mjs';

const DROP_OBJECTS = new Set([
  'TABLE', 'VIEW', 'INDEX', 'DATABASE', 'TABLESPACE', 'SCHEMA', 'PROCEDURE', 'FUNCTION',
  'SEQUENCE', 'ALIAS', 'SYNONYM', 'TRIGGER', 'STOGROUP', 'ROLE'
]);

const COMMENT_OBJECTS = new Set([
  'TABLE', 'COLUMN', 'INDEX', 'VIEW', 'SEQUENCE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'SCHEMA', 'ROLE', 'TABLESPACE'
]);

const LABEL_OBJECTS = new Set([
  'TABLE', 'COLUMN', 'INDEX', 'VIEW', 'SEQUENCE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'SCHEMA', 'ROLE'
]);

const SET_CONTEXTS = new Set([
  'SQLID', 'SCHEMA', 'PATH', 'DEGREE', 'PACKAGESET', 'RULES', 'PRECISION', 'TIMEZONE'
]);

function readName(c) {
  const first = c.peek();
  if (!first) c.fail('a name');
  if (first.t === 'word' || first.t === 'ident') {
    c.next();
    const parts = [first.v];
    while (c.isOp('.')) {
      c.next();
      const next = c.peek();
      if (!next || (next.t !== 'word' && next.t !== 'ident')) c.fail('a name part');
      c.next();
      parts.push(next.v);
    }
    return parts;
  }
  c.fail('a name');
}

function readDrop(c, kind) {
  c.expectWord('DROP');
  const objTok = c.peek();
  if (!objTok || objTok.t !== 'word' || !DROP_OBJECTS.has(objTok.u)) {
    c.fail('a DROP object type');
  }
  c.next();
  if (c.isWord('IF')) {
    c.fail('IF EXISTS is not supported in Db2 for z/OS');
  }
  const name = readName(c);
  let cascade = false;
  if (c.isWord('RESTRICT')) {
    c.next();
  } else if (c.isWord('CASCADE')) {
    c.next();
    cascade = true;
  }
  return { kind, name, cascade };
}

// COMMENT ON and LABEL ON share a shape: an object type and name, then IS and the text; or a table
// name followed by (column IS 'text', ...), with no object type.
function readRemark(c, kind, verb, objects, field) {
  c.expectWord(verb);
  c.expectWord('ON');
  if (c.isWord([...objects]) && c.peek(1) && c.peek(1).t !== 'op') {
    const objectType = c.next().u;
    const name = readName(c);
    c.expectWord('IS');
    const text = c.next();
    if (!text || text.t !== 'lit') c.fail('a string literal');
    return { kind, objectType, name, [field]: text.v };
  }
  const name = readName(c);
  const columns = c.items().map((item) => {
    const s = cursor(item);
    const column = readName(s);
    s.expectWord('IS');
    const text = s.next();
    if (!text || text.t !== 'lit' || !s.done()) s.fail('a string literal');
    return { column, [field]: text.v };
  });
  return { kind, objectType: 'COLUMNS', name, columns };
}

const readCommentOn = (c, kind) => readRemark(c, kind, 'COMMENT', COMMENT_OBJECTS, 'comment');
const readLabelOn = (c, kind) => readRemark(c, kind, 'LABEL', LABEL_OBJECTS, 'label');

// SET [CURRENT] register [=] value[, value]...: CURRENT SQLID, SCHEMA, PATH, DEGREE, PACKAGESET,
// RULES, PRECISION and TIME ZONE, or the bare SCHEMA and PATH forms.
function readSet(c, kind) {
  c.expectWord('SET');
  const current = !!c.word('CURRENT');
  const first = c.expectWord().u;
  const context = first === 'TIME' && c.word('ZONE') ? 'TIMEZONE' : first;
  if (!SET_CONTEXTS.has(context)) c.fail('a SET context');
  c.op('=') || c.word('TO');
  const values = [];
  do {
    const v = c.next();
    if (!v || !['word', 'ident', 'num', 'lit'].includes(v.t)) c.fail('a value');
    values.push(v.v);
  } while (c.op(','));
  return { kind, current, context, value: values.length === 1 ? values[0] : values };
}

function readRename(c, kind) {
  c.expectWord('RENAME');
  let objectType = 'TABLE';
  if (c.isWord('TABLE')) {
    c.next();
  } else if (c.isWord('INDEX')) {
    c.next();
    objectType = 'INDEX';
  }
  const from = readName(c);
  c.expectWord('TO');
  const to = readName(c);
  return { kind, objectType, from, to };
}

function readTruncate(c, kind) {
  c.expectWord('TRUNCATE');
  let objectType = 'TABLE';
  if (c.isWord('TABLE')) {
    c.next();
  }
  const name = readName(c);
  let storage = null;
  let triggers = null;
  let immediate = false;
  while (!c.done()) {
    if (c.isWord('DROP')) {
      c.next();
      storage = 'DROP';
    } else if (c.isWord('REUSE')) {
      c.next();
      c.expectWord('STORAGE');
      storage = 'REUSE';
    } else if (c.isWord('IGNORE')) {
      c.next();
      c.expectWord('WHEN');
      c.expectWord('DELETE');
      c.expectWord('TRIGGERS');
      triggers = 'IGNORE';
    } else if (c.isWord('RESTRICT')) {
      c.next();
      c.expectWord('WHEN');
      c.expectWord('DELETE');
      c.expectWord('TRIGGERS');
      triggers = 'RESTRICT';
    } else if (c.isWord('IMMEDIATE')) {
      c.next();
      immediate = true;
    } else {
      c.fail('a TRUNCATE option');
    }
  }
  return { kind, name, storage, triggers, immediate };
}

function readCreateSequence(c, kind) {
  c.expectWord('CREATE');
  c.expectWord('SEQUENCE');
  const name = readName(c);
  let asType = null;
  let startWith = null;
  let incrementBy = null;
  let minValue = null;
  let noMinValue = false;
  let maxValue = null;
  let noMaxValue = false;
  let cycle = null;
  let cache = null;
  let noCache = false;
  let order = null;
  while (!c.done()) {
    if (c.isWord('AS')) {
      c.next();
      const typeTok = c.peek();
      if (!typeTok || (typeTok.t !== 'word' && typeTok.t !== 'ident')) {
        c.fail('a data type');
      }
      c.next();
      asType = typeTok.v;
    } else if (c.isWord('START')) {
      c.next();
      c.expectWord('WITH');
      const nTok = c.peek();
      if (!nTok || nTok.t !== 'num') {
        c.fail('a number');
      }
      c.next();
      startWith = nTok.v;
    } else if (c.isWord('INCREMENT')) {
      c.next();
      c.expectWord('BY');
      const nTok = c.peek();
      if (!nTok || nTok.t !== 'num') {
        c.fail('a number');
      }
      c.next();
      incrementBy = nTok.v;
    } else if (c.isWord('MINVALUE')) {
      c.next();
      const nTok = c.peek();
      if (!nTok || nTok.t !== 'num') {
        c.fail('a number');
      }
      c.next();
      minValue = nTok.v;
    } else if (c.isWord('NO')) {
      c.next();
      if (c.isWord('MINVALUE')) {
        c.next();
        noMinValue = true;
      } else if (c.isWord('MAXVALUE')) {
        c.next();
        noMaxValue = true;
      } else if (c.isWord('CYCLE')) {
        c.next();
        cycle = false;
      } else if (c.isWord('CACHE')) {
        c.next();
        noCache = true;
      } else if (c.isWord('ORDER')) {
        c.next();
        order = false;
      } else {
        c.fail('MINVALUE, MAXVALUE, CYCLE, CACHE or ORDER');
      }
    } else if (c.isWord('MAXVALUE')) {
      c.next();
      const nTok = c.peek();
      if (!nTok || nTok.t !== 'num') {
        c.fail('a number');
      }
      c.next();
      maxValue = nTok.v;
    } else if (c.isWord('CYCLE')) {
      c.next();
      cycle = true;
    } else if (c.isWord('CACHE')) {
      c.next();
      const nTok = c.peek();
      if (!nTok || nTok.t !== 'num') {
        c.fail('a number');
      }
      c.next();
      cache = nTok.v;
    } else if (c.isWord('ORDER')) {
      c.next();
      order = true;
    } else {
      c.fail('a SEQUENCE option');
    }
  }
  return { kind, name, asType, startWith, incrementBy, minValue, noMinValue, maxValue, noMaxValue, cycle, cache, noCache, order };
}

function readCreateAlias(c, kind) {
  c.expectWord('CREATE');
  c.expectWord('ALIAS');
  const name = readName(c);
  c.expectWord('FOR');
  const forName = readName(c);
  return { kind, name, for: forName };
}

function readCreateSynonym(c, kind) {
  c.expectWord('CREATE');
  c.expectWord('SYNONYM');
  const name = readName(c);
  c.expectWord('FOR');
  const forName = readName(c);
  return { kind, name, for: forName };
}

function readCreateSchema(c, kind) {
  c.expectWord('CREATE');
  c.expectWord('SCHEMA');
  const name = readName(c);
  let authorization = null;
  if (c.isWord('AUTHORIZATION')) {
    c.next();
    authorization = readName(c);
  }
  return { kind, name, authorization };
}

function readCreateRole(c, kind) {
  c.expectWord('CREATE');
  c.expectWord('ROLE');
  const name = readName(c);
  return { kind, name };
}

export const parsers = {
  'DROP TABLE': (c) => readDrop(c, 'DROP TABLE'),
  'DROP VIEW': (c) => readDrop(c, 'DROP VIEW'),
  'DROP INDEX': (c) => readDrop(c, 'DROP INDEX'),
  'DROP DATABASE': (c) => readDrop(c, 'DROP DATABASE'),
  'DROP TABLESPACE': (c) => readDrop(c, 'DROP TABLESPACE'),
  'DROP SCHEMA': (c) => readDrop(c, 'DROP SCHEMA'),
  'DROP PROCEDURE': (c) => readDrop(c, 'DROP PROCEDURE'),
  'DROP FUNCTION': (c) => readDrop(c, 'DROP FUNCTION'),
  'DROP SEQUENCE': (c) => readDrop(c, 'DROP SEQUENCE'),
  'DROP ALIAS': (c) => readDrop(c, 'DROP ALIAS'),
  'DROP SYNONYM': (c) => readDrop(c, 'DROP SYNONYM'),
  'DROP TRIGGER': (c) => readDrop(c, 'DROP TRIGGER'),
  'DROP STOGROUP': (c) => readDrop(c, 'DROP STOGROUP'),
  'DROP ROLE': (c) => readDrop(c, 'DROP ROLE'),
  'COMMENT ON': (c) => readCommentOn(c, 'COMMENT ON'),
  'LABEL ON': (c) => readLabelOn(c, 'LABEL ON'),
  'SET': (c) => readSet(c, 'SET'),
  'RENAME': (c) => readRename(c, 'RENAME'),
  'TRUNCATE': (c) => readTruncate(c, 'TRUNCATE'),
  'CREATE SEQUENCE': (c) => readCreateSequence(c, 'CREATE SEQUENCE'),
  'CREATE ALIAS': (c) => readCreateAlias(c, 'CREATE ALIAS'),
  'CREATE SYNONYM': (c) => readCreateSynonym(c, 'CREATE SYNONYM'),
  'CREATE SCHEMA': (c) => readCreateSchema(c, 'CREATE SCHEMA'),
  'CREATE ROLE': (c) => readCreateRole(c, 'CREATE ROLE'),
};
