// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for PL/I stream I/O statements: GET, PUT, DISPLAY, FORMAT, and FLUSH.
import { cursor, split } from '../cursor.mjs';
import { parseExpression, parseReference } from '../expr.mjs';

function parseFormatItem(c) {
  const start = c.pos;
  let factor = null;
  // A parenthesised group followed by another item is an iteration factor, (N) F(5,2); one followed
  // by ',' or the end is a nested format list, (A, X(2)).
  if (c.isOp('(')) {
    const inner = c.group();
    const next = c.peek();
    if (next && (next.t === 'word' || (next.t === 'op' && next.v === '('))) {
      const s = cursor(inner);
      factor = parseExpression(s);
      if (!s.done()) s.fail('end of iteration factor');
    } else {
      c.pos = start;
    }
  } else if (c.peek() && c.peek().t === 'num') {
    factor = c.next();
  }

  if (c.isOp('(')) {
    const inner = c.group();
    const s = cursor(inner);
    const items = [];
    while (!s.done()) {
      const item = parseFormatItem(s);
      items.push(item);
      if (!s.done()) {
        if (s.isOp(',')) s.next();
        else s.fail("',' or ')'");
      }
    }
    const toks = c.slice(start);
    return { factor, items, toks };
  }

  const t = c.peek();
  if (!t) c.fail('a format item');
  if (t.t === 'word') {
    c.next();
    if (c.isOp('(')) c.group();
    else if (t.u === 'P' && c.peek() && c.peek().t === 'lit') c.next();
  } else if (t.t === 'lit') {
    c.next();
  } else {
    c.fail('a format item');
  }
  return { factor, items: null, toks: c.slice(start) };
}

function parseFormatList(c) {
  const inner = c.group();
  const s = cursor(inner);
  const items = [];
  while (!s.done()) {
    const item = parseFormatItem(s);
    items.push(item);
    if (!s.done()) {
      if (s.isOp(',')) s.next();
      else s.fail("',' or ')'");
    }
  }
  return items;
}

// A repetitive specification, (X(I) DO I = 1 TO N), is an item whose parentheses hold a DO at depth one.
function isRepetitive(toks) {
  if (!toks.length || toks[0].t !== 'op' || toks[0].v !== '(') return false;
  let depth = 0;
  for (const t of toks) {
    if (t.t === 'op' && t.v === '(') depth++;
    else if (t.t === 'op' && t.v === ')') depth--;
    else if (depth === 1 && t.t === 'word' && t.u === 'DO') return true;
  }
  return false;
}

function parseDataList(c) {
  const items = [];
  for (const toks of split(c.group(), ',')) {
    if (!toks.length) c.fail('a data item');
    if (isRepetitive(toks)) { items.push({ t: 'repetitive', toks }); continue; }
    const s = cursor(toks);
    items.push(parseExpression(s));
    if (!s.done()) s.fail("',' or ')'");
  }
  return items;
}

function parsePut(c, stmt, ctx) {
  c.expectWord('PUT');
  const node = { kind: 'PUT', file: null, string: null, page: false, line: null, skip: null, mode: null, data: [], formats: [] };

  while (!c.done()) {
    if (c.isWord('FILE')) {
      c.next();
      c.expectOp('(');
      node.file = parseReference(c);
      c.expectOp(')');
    } else if (c.isWord('STRING')) {
      c.next();
      c.expectOp('(');
      node.string = parseExpression(c);
      c.expectOp(')');
    } else if (c.isWord('PAGE')) {
      c.next();
      node.page = true;
    } else if (c.isWord('LINE')) {
      c.next();
      c.expectOp('(');
      node.line = parseExpression(c);
      c.expectOp(')');
    } else if (c.isWord('SKIP')) {
      c.next();
      if (c.isOp('(')) {
        c.next();
        node.skip = parseExpression(c);
        c.expectOp(')');
      } else {
        node.skip = true;
      }
    } else if (c.isWord('LIST')) {
      c.next();
      node.mode = 'LIST';
      if (c.isOp('(')) {
        node.data = parseDataList(c);
      }
    } else if (c.isWord('EDIT')) {
      c.next();
      node.mode = 'EDIT';
      if (c.isOp('(')) {
        node.data = parseDataList(c);
      }
      if (c.isOp('(')) {
        const formats = parseFormatList(c);
        node.formats.push(formats);
      }
    } else if (c.isWord('DATA')) {
      c.next();
      node.mode = 'DATA';
      if (c.isOp('(')) {
        node.data = parseDataList(c);
      }
    } else {
      c.fail('PUT option');
    }
  }
  return node;
}

function parseGet(c, stmt, ctx) {
  c.expectWord('GET');
  const node = { kind: 'GET', file: null, string: null, page: false, line: null, skip: null, copy: null, mode: null, data: [], formats: [] };

  while (!c.done()) {
    if (c.isWord('FILE')) {
      c.next();
      c.expectOp('(');
      node.file = parseReference(c);
      c.expectOp(')');
    } else if (c.isWord('STRING')) {
      c.next();
      c.expectOp('(');
      node.string = parseExpression(c);
      c.expectOp(')');
    } else if (c.isWord('PAGE')) {
      c.next();
      node.page = true;
    } else if (c.isWord('LINE')) {
      c.next();
      c.expectOp('(');
      node.line = parseExpression(c);
      c.expectOp(')');
    } else if (c.isWord('SKIP')) {
      c.next();
      if (c.isOp('(')) {
        c.next();
        node.skip = parseExpression(c);
        c.expectOp(')');
      } else {
        node.skip = true;
      }
    } else if (c.isWord('COPY')) {
      c.next();
      if (c.isOp('(')) {
        c.next();
        node.copy = parseReference(c);
        c.expectOp(')');
      } else {
        node.copy = true;
      }
    } else if (c.isWord('LIST')) {
      c.next();
      node.mode = 'LIST';
      if (c.isOp('(')) {
        node.data = parseDataList(c);
      }
    } else if (c.isWord('EDIT')) {
      c.next();
      node.mode = 'EDIT';
      if (c.isOp('(')) {
        node.data = parseDataList(c);
      }
      if (c.isOp('(')) {
        const formats = parseFormatList(c);
        node.formats.push(formats);
      }
    } else if (c.isWord('DATA')) {
      c.next();
      node.mode = 'DATA';
      if (c.isOp('(')) {
        node.data = parseDataList(c);
      }
    } else {
      c.fail('GET option');
    }
  }
  return node;
}

function parseDisplay(c, stmt, ctx) {
  c.expectWord('DISPLAY');
  c.expectOp('(');
  const value = parseExpression(c);
  c.expectOp(')');
  const node = { kind: 'DISPLAY', value, reply: null, event: null, routcde: null, desc: null };

  while (!c.done()) {
    if (c.isWord('REPLY')) {
      c.next();
      c.expectOp('(');
      node.reply = parseReference(c);
      c.expectOp(')');
    } else if (c.isWord('EVENT')) {
      c.next();
      c.expectOp('(');
      node.event = parseReference(c);
      c.expectOp(')');
    } else if (c.isWord('ROUTCDE')) {
      c.next();
      c.expectOp('(');
      node.routcde = parseDataList(c);
      c.expectOp(')');
    } else if (c.isWord('DESC')) {
      c.next();
      c.expectOp('(');
      node.desc = parseDataList(c);
      c.expectOp(')');
    } else {
      c.fail('DISPLAY option');
    }
  }
  return node;
}

function parseFormat(c, stmt, ctx) {
  c.expectWord('FORMAT');
  const items = parseFormatList(c);
  return { kind: 'FORMAT', items };
}

function parseFlush(c, stmt, ctx) {
  c.expectWord('FLUSH');
  c.expectWord('FILE');
  c.expectOp('(');
  let file;
  if (c.isOp('*')) {
    c.next();
    file = '*';
  } else {
    file = parseReference(c);
  }
  c.expectOp(')');
  return { kind: 'FLUSH', file };
}

export const parsers = {
  PUT: parsePut,
  GET: parseGet,
  DISPLAY: parseDisplay,
  FORMAT: parseFormat,
  FLUSH: parseFlush,
};
