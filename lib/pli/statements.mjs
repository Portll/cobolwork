// SPDX-License-Identifier: AGPL-3.0-or-later
// Which kind each PL/I statement is, and its parse by that kind's parser. PL/I reserves no words, so
// a statement is an assignment whenever it reads as references followed by '=', and a keyword
// statement only otherwise: `IF = 1;` assigns to a variable named IF.
import { cursor, PliSyntax } from './cursor.mjs';
import { parsers as declare } from './stmt/declare.mjs';
import { parsers as procedure } from './stmt/procedure.mjs';
import { parsers as control } from './stmt/control.mjs';
import { parsers as call } from './stmt/call.mjs';
import { parsers as assignment } from './stmt/assignment.mjs';
import { parsers as io } from './stmt/io.mjs';
import { parsers as stream } from './stmt/stream.mjs';
import { parsers as conditions } from './stmt/conditions.mjs';
import { parsers as alloc } from './stmt/alloc.mjs';
import { parsers as exec } from './stmt/exec.mjs';
import { parsers as preprocessor } from './stmt/preprocessor.mjs';
import { parsers as misc } from './stmt/misc.mjs';

export const PARSERS = Object.freeze({ ...declare, ...procedure, ...control, ...call, ...assignment, ...io, ...stream, ...conditions, ...alloc, ...exec, ...preprocessor, ...misc });

const KEYWORDS = new Map(Object.entries({
  DECLARE: 'DECLARE', DCL: 'DECLARE', DEFAULT: 'DEFAULT', DFT: 'DEFAULT', DEFINE: 'DEFINE',
  PROCEDURE: 'PROCEDURE', PROC: 'PROCEDURE', ENTRY: 'ENTRY', PACKAGE: 'PACKAGE', BEGIN: 'BEGIN', END: 'END',
  DO: 'DO', IF: 'IF', ELSE: 'ELSE', SELECT: 'SELECT', WHEN: 'WHEN', OTHERWISE: 'OTHERWISE', OTHER: 'OTHERWISE',
  LEAVE: 'LEAVE', ITERATE: 'ITERATE', GO: 'GOTO', GOTO: 'GOTO', RETURN: 'RETURN', STOP: 'STOP', EXIT: 'EXIT',
  CALL: 'CALL', FETCH: 'FETCH', RELEASE: 'RELEASE',
  OPEN: 'OPEN', CLOSE: 'CLOSE', READ: 'READ', WRITE: 'WRITE', REWRITE: 'REWRITE', DELETE: 'DELETE', LOCATE: 'LOCATE',
  UNLOCK: 'UNLOCK', GET: 'GET', PUT: 'PUT', DISPLAY: 'DISPLAY', FORMAT: 'FORMAT', FLUSH: 'FLUSH',
  ON: 'ON', SIGNAL: 'SIGNAL', REVERT: 'REVERT', RESIGNAL: 'RESIGNAL',
  ALLOCATE: 'ALLOCATE', ALLOC: 'ALLOCATE', FREE: 'FREE',
  EXEC: 'EXEC', EXECUTE: 'EXEC',
  WAIT: 'WAIT', DELAY: 'DELAY', ATTACH: 'ATTACH', DETACH: 'DETACH', ASSERT: 'ASSERT', QUALIFY: 'QUALIFY',
}));

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '|=', '&=', '||=', '**=']);

// Where a reference starting at `i` ends: name, then any mix of (subscripts), '.' name and
// '->' or '=>' name. -1 when `i` does not start one.
function referenceEnd(toks, i) {
  if (!toks[i] || toks[i].t !== 'word') return -1;
  let k = i + 1;
  for (;;) {
    const t = toks[k];
    if (t && t.t === 'op' && t.v === '(') {
      let depth = 0;
      for (; k < toks.length; k++) {
        if (toks[k].t !== 'op') continue;
        if (toks[k].v === '(') depth++;
        else if (toks[k].v === ')' && --depth === 0) break;
      }
      if (k >= toks.length) return -1;
      k++;
      continue;
    }
    if (t && t.t === 'op' && (t.v === '.' || t.v === '->' || t.v === '=>') && toks[k + 1] && toks[k + 1].t === 'word') { k += 2; continue; }
    return k;
  }
}

export function isAssignment(toks) {
  let i = 0;
  for (;;) {
    const end = referenceEnd(toks, i);
    if (end < 0) return false;
    const t = toks[end];
    if (t && t.t === 'op' && ASSIGN_OPS.has(t.v)) return true;
    if (t && t.t === 'op' && t.v === ',') { i = end + 1; continue; }
    return false;
  }
}

export function classify(stmt) {
  const toks = stmt.toks;
  if (!toks.length) return 'NULL';
  if (toks[0].t === 'op' && toks[0].v === '%') return 'PREPROCESSOR';
  if (isAssignment(toks)) return 'ASSIGNMENT';
  // An %INCLUDE member holding the middle of a structure starts at a level number.
  if (toks[0].t === 'num' && /^\d+$/.test(toks[0].v) && toks[1] && toks[1].t === 'word') return 'DECLARE_FRAGMENT';
  if (toks[0].t !== 'word') return 'UNKNOWN';
  return KEYWORDS.get(toks[0].u) || 'UNKNOWN';
}

// A statement built from tokens inside another, such as the unit of an IF, ON or WHEN, with its own
// prefixes taken off as the splitter takes them off a statement of its own.
export function subStatement(parent, toks) {
  const labels = [];
  let i = 0;
  while (toks[i] && toks[i].t === 'word' && toks[i + 1] && toks[i + 1].t === 'op' && toks[i + 1].v === ':') { labels.push({ name: toks[i].u, line: toks[i].line }); i += 2; }
  const first = toks[i] || toks[0];
  return { labels, conditions: [], toks: toks.slice(i), line: first ? first.line : parent.line, endLine: parent.endLine, ...(parent.file ? { file: parent.file } : {}) };
}

const RANK = { parsed: 0, unbuilt: 1, unparsed: 2, unknown: 3 };

// { kind, status, node?, reason? }. status is parsed (every token accounted for, and every nested
// unit parsed), unbuilt (the kind has no parser yet), unparsed (the parser refused it or left tokens)
// or unknown (no kind fits). A parser receives a cursor on the statement's tokens after its prefixes
// and returns a node; a nested statement it parses through ctx.parseStatement goes in node.units.
export function parseStatement(stmt) {
  const kind = classify(stmt);
  if (kind === 'NULL') return { kind, status: 'parsed', node: { kind } };
  if (kind === 'UNKNOWN') return { kind, status: 'unknown', reason: 'no statement kind fits' };
  const parser = PARSERS[kind];
  if (!parser) return { kind, status: 'unbuilt' };
  const c = cursor(stmt.toks);
  let node;
  try {
    node = parser(c, stmt, { parseStatement, subStatement });
  } catch (e) {
    if (e instanceof PliSyntax) return { kind, status: 'unparsed', reason: e.message, line: e.line ?? stmt.line };
    return { kind, status: 'unparsed', reason: `parser error: ${e && e.message}`, crash: true, line: stmt.line };
  }
  if (!c.done()) return { kind, status: 'unparsed', reason: `tokens left at '${c.peek().v ?? c.peek().t}'`, line: c.peek().line, node };
  let status = 'parsed';
  for (const u of (node && node.units) || []) if (RANK[u.status] > RANK[status]) status = u.status;
  return status === 'parsed' ? { kind, status, node } : { kind, status, node, reason: 'a nested statement is not parsed' };
}
