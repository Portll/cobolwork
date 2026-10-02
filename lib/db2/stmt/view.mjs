// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 for z/OS CREATE VIEW, after the Db2 13 SQL Reference: the view's name and columns, its common
// table expressions and fullselect kept as tokens, the check option, and the names its FROM clauses read.

import { Db2Syntax } from '../cursor.mjs';
import { readName } from './table.mjs';

const isName = (t) => !!t && (t.t === 'word' || t.t === 'ident');
const isWord = (t, u) => !!t && t.t === 'word' && (Array.isArray(u) ? u.includes(t.u) : t.u === u);
const isOpen = (t) => !!t && t.t === 'op' && t.v === '(';
const isClose = (t) => !!t && t.t === 'op' && t.v === ')';

// What another dialect's view looks like at the token where a Db2 for z/OS one stops.
function hint(t, after) {
  if (!t) return '';
  if (t.t === 'op' && t.v === '/') return " ('/' qualifies names in Db2 for i system naming, not Db2 for z/OS)";
  if (t.t !== 'word') return '';
  if (t.u === 'IF' && (isWord(after, 'NOT') || isWord(after, 'EXISTS'))) return ' (IF [NOT] EXISTS is not Db2 for z/OS syntax)';
  if (t.u === 'MATERIALIZED') return ' (Db2 for z/OS has materialized query tables, made by CREATE TABLE, not materialized views)';
  if (t.u === 'READ' && isWord(after, 'ONLY')) return ' (WITH READ ONLY is Oracle, not Db2 for z/OS)';
  if (t.u === 'CONSTRAINT') return ' (a named check option is Oracle, not Db2 for z/OS)';
  if (t.u === 'WITH' && isOpen(after)) return ' (view options in parentheses are not Db2 for z/OS syntax)';
  return '';
}

function refuse(c, what) {
  const t = c.peek();
  throw new Db2Syntax(`expected ${what}${t ? ` at '${t.v ?? t.t}'` : ' at end of statement'}${hint(t, c.peek(1))}`, t || c.peek(-1));
}

function closing(toks, i) {
  let depth = 0;
  for (let k = i; k < toks.length; k++) {
    if (isOpen(toks[k])) depth++;
    else if (isClose(toks[k]) && --depth === 0) return k;
  }
  return toks.length;
}

const atTop = (toks, words) => {
  let depth = 0;
  return toks.some((t) => {
    if (isOpen(t)) depth++;
    else if (isClose(t)) depth--;
    return depth === 0 && isWord(t, words);
  });
};

// The words that end a FROM clause; FOR does too unless a period specification follows the table.
const FROM_END = ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'FETCH', 'OFFSET', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WITH', 'OPTIMIZE', 'QUERYNO', 'SKIP'];

// One FROM clause from i: a name that starts a table reference is recorded; TABLE (…), XMLTABLE (…) and
// the like are read only for the subqueries inside them. Returns the index where the clause ends.
function fromClause(toks, i, out) {
  let start = true;
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (isWord(t, FROM_END) || (isWord(t, 'FOR') && !isWord(toks[i + 1], ['SYSTEM_TIME', 'BUSINESS_TIME']))) return i;
    if ((t.t === 'op' && t.v === ',') || isWord(t, 'JOIN')) { start = true; continue; }
    if (isOpen(t)) {
      const j = closing(toks, i);
      const inner = toks.slice(i + 1, j);
      if (start && !atTop(inner, ['SELECT', 'UNION', 'EXCEPT', 'INTERSECT'])) fromClause(inner, 0, out);
      else fromNames(inner, out);
      i = j;
      start = false;
      continue;
    }
    if (!start) continue;
    start = false;
    if (!isName(t) || isWord(t, ['TABLE', 'FINAL', 'OLD']) || isOpen(toks[i + 1])) continue;
    const parts = [t.v];
    while (toks[i + 1] && toks[i + 1].t === 'op' && toks[i + 1].v === '.' && isName(toks[i + 2])) { parts.push(toks[i + 2].v); i += 2; }
    out.push(parts.join('.'));
  }
  return i;
}

// The names in the FROM clause of every subselect in toks, subqueries included; a FROM that no SELECT
// at its own depth precedes (EXTRACT (YEAR FROM D), IS DISTINCT FROM) is not one.
function fromNames(toks, out) {
  let select = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (isOpen(t)) {
      const j = closing(toks, i);
      fromNames(toks.slice(i + 1, j), out);
      i = j;
    } else if (isWord(t, 'SELECT')) select = true;
    else if (isWord(t, 'FROM') && select && !isWord(toks[i - 1], 'DISTINCT')) i = fromClause(toks, i + 1, out) - 1;
  }
}

function readColumnNames(c) {
  return c.items().map((item) => {
    if (item.length !== 1 || !isName(item[0])) throw new Db2Syntax(`expected an unqualified column name${item[0] ? ` at '${item[0].v}'` : ''}`, item[0] || c.peek(-1));
    return item[0].v;
  });
}

function readCommonTableExpression(c) {
  const t = c.next();
  if (!isName(t)) { c.pos -= t ? 1 : 0; refuse(c, 'a common table expression name'); }
  const cte = { name: t.v, columns: c.isOp('(') ? readColumnNames(c) : null, fullselect: null };
  c.expectWord('AS');
  if (!c.isOp('(')) refuse(c, "'(' and the common table expression's fullselect");
  cte.fullselect = c.group();
  return cte;
}

function readView(c) {
  c.expectWord('CREATE');
  if (c.isWord('OR') && c.isWord('REPLACE', 1)) refuse(c, 'VIEW (Db2 for z/OS has no CREATE OR REPLACE VIEW)');
  if (!c.isWord('VIEW')) refuse(c, 'VIEW');
  c.next();
  if (c.isWord('IF') && c.isWord(['NOT', 'EXISTS'], 1)) refuse(c, 'a view name');
  const parts = readName(c);
  if (parts.length > 3) refuse(c, 'a view name of at most three parts');
  const node = { kind: 'CREATE VIEW', name: parts.join('.'), columns: null, with: [], fullselect: null, checkOption: null, tables: [] };
  if (c.isOp('(')) node.columns = readColumnNames(c);
  if (!c.word('AS')) refuse(c, node.columns ? 'AS' : "'(' or AS");
  if (c.word('WITH')) {
    if (c.isWord('RECURSIVE')) refuse(c, 'a common table expression (WITH RECURSIVE is not Db2 for z/OS syntax)');
    do node.with.push(readCommonTableExpression(c)); while (c.op(','));
  }
  if (!c.isWord('SELECT') && !c.isOp('(')) refuse(c, 'a fullselect');
  node.fullselect = c.until((t) => isWord(t, 'WITH'));
  if (c.word('WITH')) {
    const how = c.word(['CASCADED', 'LOCAL']);
    if (!c.isWord('CHECK')) refuse(c, how ? 'CHECK OPTION' : 'CASCADED, LOCAL or CHECK OPTION');
    c.next();
    c.expectWord('OPTION');
    node.checkOption = how ? how.u : 'CASCADED';
    if (!c.done()) refuse(c, 'the end of the statement after CHECK OPTION');
  }
  const names = [];
  for (const cte of node.with) fromNames(cte.fullselect, names);
  fromNames(node.fullselect, names);
  const local = new Set(node.with.map((cte) => cte.name.toUpperCase()));
  node.tables = [...new Set(names)].filter((n) => n.includes('.') || !local.has(n.toUpperCase()));
  return node;
}

export const parsers = {
  'CREATE VIEW': (c) => readView(c),
};
