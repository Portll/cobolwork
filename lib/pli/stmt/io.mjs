// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for PL/I OPEN, CLOSE, READ, WRITE, REWRITE, DELETE, LOCATE and UNLOCK statements.

import { cursor } from '../cursor.mjs';
import { parseExpression, parseReference } from '../expr.mjs';

const OPEN_OPTS = new Set([
  'STREAM', 'RECORD', 'INPUT', 'OUTPUT', 'UPDATE', 'SEQUENTIAL', 'DIRECT', 'TRANSIENT',
  'BUFFERED', 'UNBUFFERED', 'KEYED', 'PRINT', 'BACKWARDS', 'EXCLUSIVE',
  'TITLE', 'LINESIZE', 'PAGESIZE', 'ENVIRONMENT', 'ENV'
]);

const REF_OPTS = new Set(['INTO', 'FROM', 'SET', 'KEYTO', 'EVENT']);
const EXPR_OPTS = new Set(['KEY', 'KEYFROM', 'IGNORE', 'TITLE', 'LINESIZE', 'PAGESIZE']);

function parseFileRef(c) {
  c.expectWord('FILE');
  c.expectOp('(');
  const ref = parseReference(c);
  c.expectOp(')');
  return ref;
}

function parseOpenFile(c) {
  const file = parseFileRef(c);
  const options = {};

  while (!c.done()) {
    if (c.isOp(',')) {
      break;
    }

    if (c.isWord()) {
      const word = c.next();
      const u = word.u;

      if (OPEN_OPTS.has(u)) {
        if (c.isOp('(')) {
          const inner = c.group();
          const s = cursor(inner);
          if (u === 'ENVIRONMENT' || u === 'ENV') {
            options[u] = inner;
          } else {
            const e = parseExpression(s);
            if (!s.done()) s.fail('the end of the option argument');
            options[u] = e;
          }
        } else {
          options[u] = true;
        }
      } else {
        if (c.isOp('(')) {
          const inner = c.group();
          options[u] = inner;
        } else {
          options[u] = true;
        }
      }
    } else {
      c.fail('an OPEN option');
    }
  }

  return { file, options };
}

function parseOpen(c, stmt, ctx) {
  c.expectWord('OPEN');
  const files = [];
  files.push(parseOpenFile(c));

  while (c.isOp(',')) {
    c.next();
    files.push(parseOpenFile(c));
  }

  return { kind: 'OPEN', files };
}

function parseCloseFile(c) {
  const file = parseFileRef(c);
  const options = {};

  while (!c.done()) {
    if (c.isOp(',')) {
      break;
    }

    if (c.isWord('ENVIRONMENT') || c.isWord('ENV')) {
      const u = c.next().u;
      if (c.isOp('(')) {
        const inner = c.group();
        options[u] = inner;
      } else {
        options[u] = true;
      }
    } else {
      c.fail('a CLOSE option');
    }
  }

  return { file, options };
}

function parseClose(c, stmt, ctx) {
  c.expectWord('CLOSE');
  const files = [];

  if (c.isWord('FILE') && c.isOp('(', 1)) {
    c.next(); 
    c.next(); 
    if (c.isOp('*')) {
      c.next();
      c.expectOp(')');
      files.push({ file: { t: 'star', toks: [] }, options: {} });
    } else {
      const ref = parseReference(c);
      c.expectOp(')');
      files.push({ file: ref, options: {} });
    }
  } else {
    files.push(parseCloseFile(c));
  }

  while (c.isOp(',')) {
    c.next();
    files.push(parseCloseFile(c));
  }

  return { kind: 'CLOSE', files };
}

function parseRecordIO(c, stmt, ctx, kind) {
  c.expectWord(kind);

  const file = parseFileRef(c);
  const options = {};
  let target = null;

  while (!c.done()) {
    if (c.isWord()) {
      const word = c.next();
      const u = word.u;

      if (REF_OPTS.has(u)) {
        c.expectOp('(');
        const ref = parseReference(c);
        c.expectOp(')');
        options[u] = ref;
        if (u === 'INTO' || u === 'FROM') target = ref;
      } else if (EXPR_OPTS.has(u)) {
        const inner = c.group();
        const s = cursor(inner);
        const e = parseExpression(s);
        if (!s.done()) s.fail('the end of the option argument');
        options[u] = e;
      } else if (u === 'NOLOCK') {
        options[u] = true;
      } else {
        if (c.isOp('(')) {
          const inner = c.group();
          options[u] = inner;
        } else {
          options[u] = true;
        }
      }
    } else {
      c.fail(`an ${kind} option`);
    }
  }

  return { kind, file, target, options };
}

function parseLocate(c, stmt, ctx) {
  c.expectWord('LOCATE');
  const target = parseReference(c);
  const file = parseFileRef(c);
  const options = {};

  while (!c.done()) {
    if (c.isWord()) {
      const word = c.next();
      const u = word.u;

      if (u === 'SET') {
        c.expectOp('(');
        const ref = parseReference(c);
        c.expectOp(')');
        options[u] = ref;
      } else if (u === 'KEYFROM') {
        const inner = c.group();
        const s = cursor(inner);
        const e = parseExpression(s);
        if (!s.done()) s.fail('the end of the option argument');
        options[u] = e;
      } else {
        if (c.isOp('(')) {
          const inner = c.group();
          options[u] = inner;
        } else {
          options[u] = true;
        }
      }
    } else {
      c.fail('a LOCATE option');
    }
  }

  return { kind: 'LOCATE', file, target, options };
}

function parseUnlock(c, stmt, ctx) {
  c.expectWord('UNLOCK');
  const file = parseFileRef(c);
  const options = {};

  if (c.isWord('KEY')) {
    c.next();
    const inner = c.group();
    const s = cursor(inner);
    const e = parseExpression(s);
    if (!s.done()) s.fail('the end of the option argument');
    options['KEY'] = e;
  }

  return { kind: 'UNLOCK', file, target: null, options };
}

export const parsers = {
  OPEN: parseOpen,
  CLOSE: parseClose,
  READ: (c, s, ctx) => parseRecordIO(c, s, ctx, 'READ'),
  WRITE: (c, s, ctx) => parseRecordIO(c, s, ctx, 'WRITE'),
  REWRITE: (c, s, ctx) => parseRecordIO(c, s, ctx, 'REWRITE'),
  DELETE: (c, s, ctx) => parseRecordIO(c, s, ctx, 'DELETE'),
  LOCATE: parseLocate,
  UNLOCK: parseUnlock
};
