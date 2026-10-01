// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for PL/I PROCEDURE, ENTRY, PACKAGE, BEGIN, and END statements.

const PROC_OPTIONS = new Set([
  'RECURSIVE', 'NONRECURSIVE', 'REORDER', 'ORDER', 'EXTERNAL', 'EXT',
  'CHARGRAPHIC', 'NOCHARGRAPHIC', 'REDUCIBLE', 'IRREDUCIBLE'
]);

const BEGIN_OPTIONS = new Set([
  'ORDER', 'REORDER', 'CHARGRAPHIC', 'NOCHARGRAPHIC'
]);

function parseNameList(c, failMsg) {
  const items = c.items();
  const names = [];
  for (const item of items) {
    if (item.length === 1 && item[0].t === 'op' && item[0].v === '*') {
      names.push('*');
    } else if (item.length === 1 && item[0].t === 'word') {
      names.push(item[0].u);
    } else {
      c.fail(failMsg);
    }
  }
  return names;
}

function parseOptionsList(c) {
  const items = c.items();
  const options = [];
  for (const item of items) {
    if (item.length === 0) continue;
    const first = item[0];
    if (first.t !== 'word') {
      c.fail('an option name');
    }
    const opt = { name: first.u, args: null };
    let i = 1;
    if (i < item.length && item[i].t === 'op' && item[i].v === '(') {
      const start = i;
      let depth = 0;
      for (; i < item.length; i++) {
        if (item[i].t === 'op' && item[i].v === '(') depth++;
        else if (item[i].t === 'op' && item[i].v === ')') {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }
      if (depth !== 0) {
        c.fail("matching ')'");
      }
      opt.args = item.slice(start + 1, i - 1);
    }
    if (i < item.length) {
      c.fail('end of option');
    }
    options.push(opt);
  }
  return options;
}

function parseProcedure(c, stmt) {
  c.expectWord(['PROCEDURE', 'PROC']);
  const name = stmt.labels.length ? stmt.labels[stmt.labels.length - 1].name : null;
  const node = {
    kind: 'PROCEDURE',
    name,
    params: [],
    options: [],
    returns: null,
    recursive: false,
    external: null,
    order: null
  };

  if (c.isOp('(')) {
    const items = c.items();
    for (const item of items) {
      if (item.length === 1 && item[0].t === 'word') {
        node.params.push(item[0].u);
      } else {
        c.fail('a parameter name');
      }
    }
  }

  while (!c.done()) {
    if (c.isWord('OPTIONS')) {
      c.next();
      if (!c.isOp('(')) c.fail("'('");
      node.options.push(...parseOptionsList(c));
    } else if (c.isWord('RETURNS')) {
      c.next();
      if (!c.isOp('(')) c.fail("'('");
      node.returns = c.group();
    } else if (c.isWord(['RECURSIVE', 'NONRECURSIVE'])) {
      const t = c.next();
      node.recursive = t.u === 'RECURSIVE';
    } else if (c.isWord(['ORDER', 'REORDER'])) {
      const t = c.next();
      node.order = t.u;
    } else if (c.isWord(['EXTERNAL', 'EXT'])) {
      c.next();
      if (c.isOp('(')) {
        const inner = c.group();
        if (inner.length === 1 && inner[0].t === 'lit') {
          node.external = inner[0].v;
        } else if (inner.length === 1 && inner[0].t === 'word') {
          node.external = inner[0].u;
        } else {
          c.fail("a name or literal");
        }
      } else {
        node.external = true;
      }
    } else if (c.isWord(['CHARGRAPHIC', 'NOCHARGRAPHIC', 'REDUCIBLE', 'IRREDUCIBLE'])) {
      const t = c.next();
      node.options.push({ name: t.u, args: null });
    } else {
      c.fail('a PROCEDURE option');
    }
  }

  return node;
}

function parseEntry(c, stmt) {
  c.expectWord('ENTRY');
  const name = stmt.labels.length ? stmt.labels[stmt.labels.length - 1].name : null;
  const node = {
    kind: 'ENTRY',
    name,
    params: [],
    options: [],
    returns: null,
    recursive: false,
    external: null,
    order: null
  };

  if (c.isOp('(')) {
    const items = c.items();
    for (const item of items) {
      if (item.length === 1 && item[0].t === 'word') {
        node.params.push(item[0].u);
      } else {
        c.fail('a parameter name');
      }
    }
  }

  while (!c.done()) {
    if (c.isWord('RETURNS')) {
      c.next();
      if (!c.isOp('(')) c.fail("'('");
      node.returns = c.group();
    } else if (c.isWord('OPTIONS')) {
      c.next();
      if (!c.isOp('(')) c.fail("'('");
      node.options.push(...parseOptionsList(c));
    } else if (c.isWord(['EXTERNAL', 'EXT'])) {
      c.next();
      if (c.isOp('(')) {
        const inner = c.group();
        if (inner.length === 1 && inner[0].t === 'lit') {
          node.external = inner[0].v;
        } else if (inner.length === 1 && inner[0].t === 'word') {
          node.external = inner[0].u;
        } else {
          c.fail("a name or literal");
        }
      } else {
        node.external = true;
      }
    } else {
      c.fail('an ENTRY option');
    }
  }

  return node;
}

function parsePackage(c, stmt) {
  c.expectWord('PACKAGE');
  const name = stmt.labels.length ? stmt.labels[stmt.labels.length - 1].name : null;
  const node = {
    kind: 'PACKAGE',
    name,
    exports: null,
    reserves: null,
    options: []
  };

  while (!c.done()) {
    if (c.isWord('EXPORTS')) {
      c.next();
      if (!c.isOp('(')) c.fail("'('");
      node.exports = parseNameList(c, 'an export name');
    } else if (c.isWord('RESERVES')) {
      c.next();
      if (!c.isOp('(')) c.fail("'('");
      node.reserves = parseNameList(c, 'a reserve name');
    } else if (c.isWord('OPTIONS')) {
      c.next();
      if (!c.isOp('(')) c.fail("'('");
      node.options.push(...parseOptionsList(c));
    } else {
      c.fail('a PACKAGE option');
    }
  }

  return node;
}

function parseBegin(c, stmt) {
  c.expectWord('BEGIN');
  const node = {
    kind: 'BEGIN',
    options: []
  };

  while (!c.done()) {
    if (c.isWord(['OPTIONS', 'ORDER', 'REORDER', 'CHARGRAPHIC', 'NOCHARGRAPHIC'])) {
      const t = c.next();
      if (t.u === 'OPTIONS') {
        if (!c.isOp('(')) c.fail("'('");
        node.options.push(...parseOptionsList(c));
      } else {
        node.options.push({ name: t.u, args: null });
      }
    } else {
      c.fail('a BEGIN option');
    }
  }

  return node;
}

function parseEnd(c, stmt) {
  c.expectWord('END');
  let label = null;
  if (!c.done()) {
    if (c.isWord()) {
      label = c.next().u;
    } else {
      c.fail('a label or end of statement');
    }
  }
  return { kind: 'END', label };
}

export const parsers = {
  PROCEDURE: parseProcedure,
  ENTRY: parseEntry,
  PACKAGE: parsePackage,
  BEGIN: parseBegin,
  END: parseEnd
};
