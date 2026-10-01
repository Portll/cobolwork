// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I DO, IF, ELSE, SELECT, WHEN, OTHERWISE, LEAVE, ITERATE, GO TO, RETURN, STOP and EXIT statements.

import { cursor } from '../cursor.mjs';
import { parseExpression, parseReference } from '../expr.mjs';


function parseUnit(c, stmt, ctx, node) {
  const rest = c.drain();
  if (!rest.length) {
    node.units = [];
    return;
  }
  const sub = ctx.subStatement(stmt, rest);
  node.units = [ctx.parseStatement(sub)];
}

function parseDo(c, stmt, ctx) {
  c.expectWord('DO');
  const node = { kind: 'DO', form: 'group', control: null, specs: [], while: null, until: null };

  if (c.done()) return node;

  if (c.isWord('LOOP')) {
    c.next();
    node.form = 'loop';
    if (!c.done()) c.fail('end of DO LOOP');
    return node;
  }
  if (c.isWord('FOREVER')) {
    c.next();
    node.form = 'loop';
    if (!c.done()) c.fail('end of DO FOREVER');
    return node;
  }

  // A variable may be named WHILE: the word after DO is the control variable only when it is
  // followed by '='; otherwise WHILE/UNTIL are the loop's own control words.
  if (c.isWord('WHILE') && !c.isOp('=', 1)) {
    c.next();
    node.form = 'while';
    node.while = parseExpression(c, { stopWords: ['UNTIL'] });
    if (c.isWord('UNTIL')) {
      c.next();
      node.until = parseExpression(c);
    }
    if (!c.done()) c.fail('end of DO WHILE');
    return node;
  }

  if (c.isWord('UNTIL')) {
    c.next();
    node.form = 'while';
    node.until = parseExpression(c, { stopWords: ['WHILE'] });
    if (c.isWord('WHILE')) {
      c.next();
      node.while = parseExpression(c);
    }
    if (!c.done()) c.fail('end of DO UNTIL');
    return node;
  }

  node.form = 'iterative';
  node.control = parseReference(c);
  c.expectOp('=');

  while (!c.done()) {
    const spec = { from: null, to: null, by: null, repeat: null, while: null, until: null };
    node.specs.push(spec);

    spec.from = parseExpression(c);
    if (c.isWord('REPEAT')) {
      c.next();
      spec.repeat = parseExpression(c);
    } else {
      // TO and BY may come in either order, each at most once.
      for (let k = 0; k < 2; k++) {
        if (!spec.to && c.isWord('TO')) { c.next(); spec.to = parseExpression(c); }
        else if (!spec.by && c.isWord('BY')) { c.next(); spec.by = parseExpression(c); }
      }
    }

    if (c.isWord('WHILE')) {
      c.next();
      spec.while = parseExpression(c, { stopWords: ['UNTIL'] });
    }
    if (c.isWord('UNTIL')) {
      c.next();
      spec.until = parseExpression(c);
    }

    if (c.isOp(',')) {
      c.next();
    } else if (!c.done()) {
      c.fail('end of DO iterative');
    }
  }

  return node;
}

function parseIf(c, stmt, ctx) {
  c.expectWord('IF');
  const node = { kind: 'IF', cond: parseExpression(c, { stopWords: ['THEN'] }), units: [] };
  c.expectWord('THEN');
  parseUnit(c, stmt, ctx, node);
  return node;
}

function parseElse(c, stmt, ctx) {
  c.expectWord('ELSE');
  const node = { kind: 'ELSE', units: [] };
  parseUnit(c, stmt, ctx, node);
  return node;
}

function parseSelect(c, stmt, ctx) {
  c.expectWord('SELECT');
  const node = { kind: 'SELECT', subject: null };
  if (c.isOp('(')) {
    const inner = c.group();
    const s = cursor(inner);
    node.subject = parseExpression(s);
    if (!s.done()) s.fail('end of SELECT subject');
  }
  if (!c.done()) c.fail('end of SELECT');
  return node;
}

function parseWhen(c, stmt, ctx) {
  c.expectWord('WHEN');
  const node = { kind: 'WHEN', values: [], units: [] };
  if (c.isWord(['ANY', 'ALL'])) {
    c.next();
  }
  const items = c.items();
  for (const toks of items) {
    const s = cursor(toks);
    node.values.push(parseExpression(s));
    if (!s.done()) s.fail('end of WHEN value');
  }
  parseUnit(c, stmt, ctx, node);
  return node;
}

function parseOtherwise(c, stmt, ctx) {
  c.word(['OTHERWISE', 'OTHER']);
  const node = { kind: 'OTHERWISE', units: [] };
  parseUnit(c, stmt, ctx, node);
  return node;
}

function parseLeave(c, stmt, ctx) {
  c.expectWord('LEAVE');
  const node = { kind: 'LEAVE', label: null };
  if (!c.done()) {
    node.label = parseReference(c);
  }
  if (!c.done()) c.fail('end of LEAVE');
  return node;
}

function parseIterate(c, stmt, ctx) {
  c.expectWord('ITERATE');
  const node = { kind: 'ITERATE', label: null };
  if (!c.done()) {
    node.label = parseReference(c);
  }
  if (!c.done()) c.fail('end of ITERATE');
  return node;
}

function parseGoto(c, stmt, ctx) {
  c.word(['GO', 'GOTO']);
  if (c.isWord('TO')) c.next();
  const node = { kind: 'GOTO', target: parseReference(c) };
  if (!c.done()) c.fail('end of GO TO');
  return node;
}

function parseReturn(c, stmt, ctx) {
  c.expectWord('RETURN');
  const node = { kind: 'RETURN', value: null };
  if (c.isOp('(')) {
    const inner = c.group();
    const s = cursor(inner);
    node.value = parseExpression(s);
    if (!s.done()) s.fail('end of RETURN value');
  }
  if (!c.done()) c.fail('end of RETURN');
  return node;
}

function parseStop(c, stmt, ctx) {
  c.expectWord('STOP');
  if (!c.done()) c.fail('end of STOP');
  return { kind: 'STOP' };
}

function parseExit(c, stmt, ctx) {
  c.expectWord('EXIT');
  if (!c.done()) c.fail('end of EXIT');
  return { kind: 'EXIT' };
}

export const parsers = {
  DO: parseDo,
  IF: parseIf,
  ELSE: parseElse,
  SELECT: parseSelect,
  WHEN: parseWhen,
  OTHERWISE: parseOtherwise,
  LEAVE: parseLeave,
  ITERATE: parseIterate,
  GOTO: parseGoto,
  RETURN: parseReturn,
  STOP: parseStop,
  EXIT: parseExit,
};
