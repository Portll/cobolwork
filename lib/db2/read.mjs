// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 SQL scripts as tokens and statements, and each statement's kind: CREATE TABLE, GRANT, ALTER
// TABLE and the rest. A script ends statements with ';' unless a `--#SET TERMINATOR x` line names
// another character, as Db2's command line processor allows for procedure bodies.
import { cursor, Db2Syntax } from './cursor.mjs';
import { parsers as table } from './stmt/table.mjs';
import { parsers as index } from './stmt/index.mjs';
import { parsers as view } from './stmt/view.mjs';
import { parsers as grant } from './stmt/grant.mjs';
import { parsers as alter } from './stmt/alter.mjs';
import { parsers as storage } from './stmt/storage.mjs';
import { parsers as routine } from './stmt/routine.mjs';
import { parsers as misc } from './stmt/misc.mjs';

export const PARSERS = Object.freeze({ ...table, ...index, ...view, ...grant, ...alter, ...storage, ...routine, ...misc });

const WORD = /[A-Za-z_$#@À-ɏ][A-Za-z0-9_$#@À-ɏ]*/y;
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?/y;
const OPS = ['<>', '¬=', '!=', '<=', '>=', '||', '=>', '(', ')', ',', '.', ';', ':', '+', '-', '*', '/', '=', '<', '>', '?', '@', '#', '%', '&', '|', '[', ']'];

// { t: 'word', v, u } | { t: 'lit', v, prefix } | { t: 'ident', v } (a "delimited identifier") |
// { t: 'num', v } | { t: 'op', v } | { t: 'end' } at a statement terminator; each with line and col.
export function tokenize(text) {
  const tokens = [];
  const diags = [];
  let terminator = ';';
  let line = 1;
  let col = 1;
  let i = 0;
  const advance = (n) => { for (let k = 0; k < n; k++, i++) { if (text[i] === '\n') { line++; col = 1; } else col++; } };
  while (i < text.length) {
    const c = text[i];
    if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f') { advance(1); continue; }
    if (c === '-' && text[i + 1] === '-') {
      let e = text.indexOf('\n', i);
      if (e < 0) e = text.length;
      const comment = text.slice(i, e);
      const set = /^--#SET\s+TERMINATOR\s+(\S)/i.exec(comment);
      if (set) terminator = set[1];
      advance(e - i);
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2);
      if (e < 0) { diags.push({ sev: 'error', kind: 'unterminated-comment', line, col }); advance(text.length - i); continue; }
      advance(e + 2 - i);
      continue;
    }
    const at = { line, col };
    if (c === terminator) { tokens.push({ t: 'end', v: c, ...at }); advance(1); continue; }
    const prefixed = /^(?:[XxGgNn]|[Uu]&|[Bb][Xx]|[Gg][Xx])'/.exec(text.slice(i, i + 3));
    if (c === "'" || prefixed) {
      const start = prefixed ? i + prefixed[0].length - 1 : i;
      let j = start + 1, v = '';
      for (; j < text.length; j++) {
        if (text[j] === "'") { if (text[j + 1] === "'") { v += "'"; j++; continue; } break; }
        v += text[j];
      }
      if (j >= text.length) diags.push({ sev: 'error', kind: 'unterminated-literal', ...at });
      tokens.push({ t: 'lit', v, prefix: prefixed ? prefixed[0].slice(0, -1).toUpperCase() : '', ...at });
      advance(j + 1 - i);
      continue;
    }
    if (c === '"') {
      let j = i + 1, v = '';
      for (; j < text.length; j++) { if (text[j] === '"') { if (text[j + 1] === '"') { v += '"'; j++; continue; } break; } v += text[j]; }
      tokens.push({ t: 'ident', v, ...at });
      advance(j + 1 - i);
      continue;
    }
    NUMBER.lastIndex = i;
    const num = /[0-9.]/.test(c) ? NUMBER.exec(text) : null;
    if (num && num[0] !== '.') { tokens.push({ t: 'num', v: num[0], ...at }); advance(num[0].length); continue; }
    WORD.lastIndex = i;
    const w = WORD.exec(text);
    // A terminator such as @ is otherwise a character a name may hold.
    const word = w && (w[0].includes(terminator) ? w[0].slice(0, w[0].indexOf(terminator)) : w[0]);
    if (word) { tokens.push({ t: 'word', v: word, u: word.toUpperCase(), ...at }); advance(word.length); continue; }
    const op = OPS.find((o) => text.startsWith(o, i));
    if (op) { tokens.push({ t: 'op', v: op, ...at }); advance(op.length); continue; }
    diags.push({ sev: 'warn', kind: 'unexpected-char', char: c, ...at });
    advance(1);
  }
  return { tokens, diags };
}

const COMPOUND_ENDS = new Set(['IF', 'CASE', 'LOOP', 'WHILE', 'REPEAT', 'FOR']);

// Whether the tokens so far open a routine whose body is an SQL compound statement: its own
// statements end in the same terminator, so the routine ends at the terminator after its last END.
const routineHead = (cur) => {
  const w = cur.slice(0, 6).filter((t) => t.t === 'word').map((t) => t.u);
  return w[0] === 'CREATE' && w.slice(1, 4).some((x) => x === 'PROCEDURE' || x === 'FUNCTION' || x === 'TRIGGER');
};

// Statements split at terminators; a trailing run with none is kept and flagged.
export function statements(tokens) {
  const out = [];
  let cur = [];
  let depth = 0;
  const close = (end) => {
    if (!cur.length) return;
    out.push({ toks: cur, line: cur[0].line, endLine: (end || cur[cur.length - 1]).line, ...(end ? {} : { unterminated: true }) });
    cur = [];
    depth = 0;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t === 'end') { if (depth > 0) cur.push({ ...t, t: 'op', v: t.v }); else close(t); continue; }
    cur.push(t);
    if (t.t !== 'word' || !routineHead(cur)) continue;
    if (t.u === 'BEGIN') depth++;
    else if (t.u === 'END' && depth > 0 && !(tokens[k + 1]?.t === 'word' && COMPOUND_ENDS.has(tokens[k + 1].u))) depth--;
  }
  close(null);
  return out;
}

export function readDb2(text) {
  const { tokens, diags } = tokenize(text);
  return { statements: statements(tokens), diags };
}

const OBJECTS = ['TABLE', 'INDEX', 'VIEW', 'TABLESPACE', 'DATABASE', 'STOGROUP', 'SEQUENCE', 'PROCEDURE', 'FUNCTION', 'TRIGGER', 'ALIAS', 'SYNONYM', 'TYPE', 'ROLE', 'MASK', 'PERMISSION', 'VARIABLE', 'SCHEMA', 'BUFFERPOOL', 'TRUSTED', 'AUXILIARY', 'AUX', 'GLOBAL'];

// The kind a statement's leading words give it: CREATE TABLE (also CREATE OR REPLACE, CREATE UNIQUE
// INDEX, CREATE GLOBAL TEMPORARY TABLE), ALTER TABLE, DROP TABLE, GRANT, REVOKE, COMMENT ON, ...
export function classify(st) {
  const w = st.toks.filter((t, k) => k < 8 && t.t === 'word').map((t) => t.u);
  if (!w.length || st.toks[0].t !== 'word') return 'UNKNOWN';
  const verb = w[0];
  if (verb === 'CREATE' || verb === 'ALTER' || verb === 'DROP') {
    const rest = w.slice(1).filter((x) => !['OR', 'REPLACE', 'UNIQUE', 'LARGE', 'LOB', 'TEMPORARY', 'PUBLIC', 'WHERE', 'NOT', 'NULL', 'CLUSTERED', 'REGULAR', 'USER', 'SYSTEM'].includes(x));
    const obj = rest.find((x) => OBJECTS.includes(x));
    if (!obj) return `${verb} UNKNOWN`;
    if (obj === 'AUXILIARY' || obj === 'AUX' || obj === 'GLOBAL') return `${verb} TABLE`;
    if (obj === 'TRUSTED') return `${verb} TRUSTED CONTEXT`;
    return `${verb} ${obj}`;
  }
  if (verb === 'COMMENT' || verb === 'LABEL') return `${verb} ON`;
  if (['GRANT', 'REVOKE', 'INSERT', 'UPDATE', 'DELETE', 'SELECT', 'MERGE', 'SET', 'COMMIT', 'ROLLBACK', 'CONNECT', 'DECLARE', 'CALL', 'RENAME', 'TRUNCATE', 'LOCK', 'EXPLAIN', 'VALUES', 'WITH', 'REFRESH', 'RUNSTATS', 'REORG', 'TERMINATE', 'DISCONNECT', 'EXPORT', 'IMPORT', 'LOAD', 'BEGIN', 'END'].includes(verb)) return verb;
  return 'UNKNOWN';
}

// Statements Db2 runs against data rather than defining it; this reader recognises them and
// does not parse them.
export const DATA_KINDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'SELECT', 'MERGE', 'VALUES', 'WITH', 'CALL', 'COMMIT', 'ROLLBACK', 'CONNECT', 'DISCONNECT', 'TERMINATE', 'EXPLAIN', 'REFRESH', 'RUNSTATS', 'REORG', 'EXPORT', 'IMPORT', 'LOAD', 'LOCK', 'BEGIN', 'END', 'DECLARE']);

// { kind, status, node?, reason? }: parsed, unbuilt, unparsed or unknown, as the other readers give
// them; a data statement is parsed by recognition alone and says so.
export function parseDb2Statement(st) {
  const kind = classify(st);
  if (kind === 'UNKNOWN' || kind.endsWith(' UNKNOWN')) return { kind, status: 'unknown', reason: 'no Db2 statement kind fits' };
  if (DATA_KINDS.has(kind)) return { kind, status: 'parsed', node: { kind, data: true } };
  const parser = PARSERS[kind];
  if (!parser) return { kind, status: 'unbuilt' };
  const c = cursor(st.toks);
  let node;
  try {
    node = parser(c, st);
  } catch (e) {
    if (e instanceof Db2Syntax) return { kind, status: 'unparsed', reason: e.message };
    return { kind, status: 'unparsed', reason: `parser error: ${e && e.message}`, crash: true };
  }
  if (!c.done()) return { kind, status: 'unparsed', reason: `tokens left at '${c.peek().v}'`, node };
  return { kind, status: 'parsed', node };
}
