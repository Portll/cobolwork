// SPDX-License-Identifier: AGPL-3.0-or-later
// A precompiler for embedded SQL and CICS: each EXEC SQL or EXEC CICS block becomes the CALL it
// amounts to, named by its verb, with the data it sends BY CONTENT and the data it receives BY
// REFERENCE, so a compiler accepts the program and a reader sees which fields the statement writes.
// docs/spec/precompile.md. The SQL forms are Db2's, from IBM's SQL reference, and the CICS commands
// are translated by lib/precompile-cics.mjs; nothing is taken from another precompiler. The CALLs
// name routines nothing implements: the goal is a program that compiles.
import { detectFormat, expandTabs } from './parser.mjs';
import { EIB_LAYOUT } from './words.mjs';
import { builtinValue, translateCics, eibCopybook, CONSTANT_COPYBOOKS, constantsCopybook, symbolicMapCopybook } from './precompile-cics.mjs';

const isFree = (format) => format === 'free' || format === 'terminal';

// Where a line's code sits: fixed format keeps columns 8 to 72, free format the whole line.
function codeArea(line, format) {
  if (isFree(format)) return { start: 0, end: line.length, comment: /^\s*\*>/.test(line) };
  const indicator = line[6];
  return { start: Math.min(7, line.length), end: Math.min(72, line.length), comment: indicator === '*' || indicator === '/' || /^\s{0,6}\*>/.test(line.slice(0, 9)) };
}

// The line and column just past SQL where EXEC ends a line and SQL opens the next code line, as
// Db2's coprocessor allows.
function sqlOnNextLine(lines, from, format) {
  for (let li = from + 1; li < lines.length; li++) {
    const { start, end, comment } = codeArea(lines[li], format);
    if (comment) continue;
    const code = lines[li].slice(start, end);
    if (!code.trim()) continue;
    const m = /^(\s*)SQL\b/i.exec(code);
    return m ? { line: li, col: start + m[0].length } : null;
  }
  return null;
}

// Every EXEC SQL or EXEC CICS ... END-EXEC in the code areas, outside literals and comments: its
// kind, first line and column, its last line and the column after END-EXEC, and its text with the
// lines joined. Also every DFHRESP(name) and DFHVALUE(name) outside the blocks, which the translator
// replaces with the number it stands for. EXEC DLI is left as written.
function findBlocks(lines, format) {
  const blocks = [];
  const builtins = [];
  let open = null;
  let quote = null;
  let resume = null;
  for (let li = 0; li < lines.length; li++) {
    const { start, end, comment } = codeArea(lines[li], format);
    if (comment) continue;
    const line = lines[li];
    let c = start;
    if (resume && resume.line === li) { c = resume.col; resume = null; }
    // A literal left open runs on only into a fixed-format continuation line, after its first quote.
    if (quote) {
      const at = !isFree(format) && line[6] === '-' ? line.indexOf(quote, start) : -1;
      if (at < 0 || at >= end) quote = null;
      else c = at + 1;
    }
    for (; c < end; c++) {
      const ch = line[c];
      if (quote) { if (ch === quote) quote = null; if (open) open.text += ch; continue; }
      if (!open && (ch === '"' || ch === "'")) { quote = ch; continue; }
      if (ch === '*' && line[c + 1] === '>') break;
      const rest = line.slice(c, end);
      if (!open) {
        if (c !== start && !/[\s.]/.test(line[c - 1])) {
          const f = !/[A-Za-z0-9-]/.test(line[c - 1]) && /^DFH(RESP|VALUE)\s*\(\s*([A-Z0-9-]+)\s*\)/i.exec(rest);
          if (f) { builtins.push({ line: li, col: c, length: f[0].length, fn: f[1].toUpperCase(), name: f[2].toUpperCase() }); c += f[0].length - 1; }
          continue;
        }
        const m = /^EXEC\s+(SQL|CICS)\b/i.exec(rest);
        if (m) { open = { kind: m[1].toUpperCase(), line: li, col: c, text: '' }; c += m[0].length - 1; continue; }
        const split = /^EXEC\s*$/i.test(rest) && sqlOnNextLine(lines, li, format);
        if (split) { open = { kind: 'SQL', line: li, col: c, text: '' }; resume = split; break; }
        const f = /^DFH(RESP|VALUE)\s*\(\s*([A-Z0-9-]+)\s*\)/i.exec(rest);
        if (f) { builtins.push({ line: li, col: c, length: f[0].length, fn: f[1].toUpperCase(), name: f[2].toUpperCase() }); c += f[0].length - 1; }
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; open.text += ch; continue; }
      const e = /^END-EXEC\b/i.exec(rest);
      if (e) { blocks.push({ ...open, endLine: li, endCol: c + e[0].length, text: open.text.trim() }); open = null; c += e[0].length - 1; continue; }
      open.text += ch;
    }
    if (open) open.text += ' ';
  }
  return { blocks, builtins };
}

// The words, host variables and literals of a statement. A host variable is :NAME, qualified as
// :GROUP.NAME, and may carry an indicator variable, :NAME:IND or :NAME INDICATOR :IND.
function tokenize(sql) {
  const toks = [];
  const re = /'(?:[^']|'')*'|"(?:[^"]|"")*"|:\s*[A-Z0-9_$#@-]+(?:\.[A-Z0-9_$#@-]+)*|[A-Z0-9_$#@-]+|[(),=<>+*/;.]/gi;
  for (const m of sql.matchAll(re)) {
    const t = m[0];
    if (t.startsWith(':')) toks.push({ host: t.slice(1).trim().toUpperCase() });
    else if (/^['"]/.test(t)) toks.push({ lit: t });
    else toks.push({ word: t.toUpperCase() });
  }
  return toks;
}

// How many subscripts a host variable needs: one for each OCCURS on it or on a group holding it.
function subscriptCounter(items = []) {
  const byName = new Map();
  for (const it of items) byName.set(it.name, [...(byName.get(it.name) || []), it]);
  const holds = (it, group) => { for (let p = it.parent; p; p = p.parent) if (p.name === group) return true; return false; };
  return (host) => {
    const [name, ...groups] = host.split('.').reverse();
    const item = (byName.get(name) || []).find((it) => groups.every((g) => holds(it, g)));
    let n = 0;
    for (let p = item; p; p = p.parent) if (p.occursDeclared) n++;
    return n;
  };
}

// :GROUP.NAME is NAME OF GROUP in COBOL. A host-variable array passes its first element, which is
// where the array starts.
const cobolName = (host, subscripts = 0) => host.split('.').reverse().join(' OF ') + (subscripts ? ` (${Array(subscripts).fill(1).join(' ')})` : '');

// Clauses that end an INTO list.
const AFTER_INTO = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'FETCH', 'FOR', 'WITH', 'OPTIMIZE', 'QUERYNO', 'SKIP', 'UNION', 'USING', 'VALUES']);

// Which host variables a statement reads and which it writes, as Db2's SQL reference gives them. A
// variable both read and written is in both lists. INTO a host variable writes it (INSERT INTO and
// MERGE INTO name a table); so do SET's targets, GET DIAGNOSTICS' and ASSOCIATE LOCATORS' list. A
// procedure's argument that is a lone variable may be IN, OUT or INOUT, which only the server knows.
function roles(toks) {
  const sending = [];
  const receiving = [];
  const read = (h) => { if (!sending.includes(h)) sending.push(h); };
  const write = (h) => { if (!receiving.includes(h)) receiving.push(h); };
  const verb = toks.find((t) => t.word)?.word;
  if (verb === 'CALL') return callRoles(toks, read, write), { sending, receiving };
  // DESCRIBE and PREPARE read the SQLDA's SQLN and write the rest of it.
  const intoBoth = verb === 'DESCRIBE' || verb === 'PREPARE';
  let into = false;
  let assigning = verb === 'SET';
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.word === '(') depth++;
    else if (t.word === ')') depth--;
    else if (verb === 'SET' && t.word === '=' && depth === 0) assigning = false;
    else if (verb === 'SET' && t.word === ',' && depth === 0) assigning = true;
    if (t.word === 'INTO' && next && (next.host || next.word === 'DESCRIPTOR')) { into = true; continue; }
    if (into && t.word && AFTER_INTO.has(t.word)) into = false;
    if (t.word === 'DESCRIPTOR' && next?.host) {
      // FETCH ... INTO DESCRIPTOR and USING DESCRIPTOR are synonyms: the program fills the SQLDA and Db2 writes where it points.
      if (verb === 'FETCH' || intoBoth) { read(next.host); write(next.host); } else read(next.host);
      i++;
      continue;
    }
    if (!t.host) continue;
    const written = into || assigning
      || (verb === 'GET' && next?.word === '=')
      || (verb === 'ASSOCIATE' && !toks.slice(0, i).some((x) => x.word === 'WITH'));
    if (!written || (into && intoBoth)) read(t.host);
    if (written) write(t.host);
  }
  return { sending, receiving };
}

// CALL :name reads the name. Each argument that is a lone variable, with or without its indicator,
// is read and may be written; any other argument is an expression, IN only.
function callRoles(toks, read, write) {
  let depth = 0;
  let arg = [];
  const close = () => {
    const hosts = arg.filter((t) => t.host);
    const lone = hosts.length && arg.every((t) => t.host || t.word === 'INDICATOR');
    for (const h of hosts) { read(h.host); if (lone) write(h.host); }
    arg = [];
  };
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t.word === 'DESCRIPTOR' && toks[i + 1]?.host) { read(toks[i + 1].host); write(toks[i + 1].host); i++; continue; }
    if (t.word === '(') { if (depth++ > 0) arg.push(t); continue; }
    if (t.word === ')') { if (--depth > 0) arg.push(t); else close(); continue; }
    if (depth === 0) { if (t.host) read(t.host); continue; }
    if (depth === 1 && t.word === ',') { close(); continue; }
    arg.push(t);
  }
}

// The WHENEVER tests after each executable statement, from Db2's definitions of the conditions. IBM
// does not document which wins when two hold at once, so the order is fixed, not the source's.
const WHENEVER_TEST = {
  SQLERROR: 'SQLCODE < 0',
  'NOT FOUND': 'SQLCODE = 100',
  SQLWARNING: "SQLWARN0 = 'W' OR (SQLCODE > 0 AND SQLCODE NOT = 100)",
};
// Without an SQLCA there is no SQLWARN0; the warning test falls back to its SQLCODE half.
const WHENEVER_TEST_SQLCODE = { ...WHENEVER_TEST, SQLWARNING: 'SQLCODE > 0 AND SQLCODE NOT = 100' };
const NOT_EXECUTABLE = new Set(['WHENEVER', 'INCLUDE', 'BEGIN', 'END']);
// DECLARE GLOBAL TEMPORARY TABLE is executable; DECLARE CURSOR, STATEMENT, TABLE and VARIABLE are not.
const declarative = (words) => words[0] === 'DECLARE' && words[1] !== 'GLOBAL';

// What one block becomes, as COBOL text on one logical line, or '' to blank it.
function translate(block, state) {
  const toks = tokenize(block.text);
  const words = toks.filter((t) => t.word).map((t) => t.word);
  const verb = words[0] || '';
  if (verb === 'INCLUDE') return words[1] ? `COPY ${words[1]}` : '';
  if (!state.procedure) {
    if (declarative(words) && words.includes('CURSOR')) state.cursors.set(words[1], roles(toks).sending);
    return '';
  }
  if (verb === 'WHENEVER') {
    const cond = words[1] === 'NOT' ? 'NOT FOUND' : words[1];
    let go = toks.findIndex((t) => t.word === 'GO' || t.word === 'GOTO');
    if (go >= 0) {
      if (toks[go + 1]?.word === 'TO') go++;
      // The label may be written with a colon, as a host variable is.
      state.whenever.set(cond, toks[go + 1]?.word || toks[go + 1]?.host);
    } else state.whenever.delete(cond);
    return 'CONTINUE';
  }
  if (declarative(words)) {
    if (words.includes('CURSOR')) state.cursors.set(words[1], roles(toks).sending);
    return 'CONTINUE';
  }
  if (NOT_EXECUTABLE.has(verb)) return 'CONTINUE';
  let { sending, receiving } = roles(toks);
  let name = verb;
  if (verb === 'OPEN' && state.cursors.has(words[1])) sending = [...new Set([...state.cursors.get(words[1]), ...sending])];
  if (verb === 'EXECUTE' && words[1] === 'IMMEDIATE') name = 'EXECUTE-IMMEDIATE';
  if (verb === 'DECLARE') name = 'DECLARE-GLOBAL-TEMPORARY';
  if (verb === 'WITH') name = 'SELECT';
  const status = state.status ? [state.status] : [];
  const args = [
    ...(sending.length ? ['BY', 'CONTENT', ...sending.map((h) => cobolName(h, state.subscripts(h)))] : []),
    ...(receiving.length || status.length ? ['BY', 'REFERENCE', ...receiving.map((h) => cobolName(h, state.subscripts(h))), ...status] : []),
  ];
  const call = [`CALL 'CW-SQL-${name}'`, ...(args.length ? ['USING', ...args] : [])];
  const test = state.status === 'SQLCA' ? WHENEVER_TEST : WHENEVER_TEST_SQLCODE;
  const tests = state.status ? Object.keys(test).filter((c) => state.whenever.has(c)).map((c) => `IF ${test[c]} GO TO ${state.whenever.get(c)} END-IF`) : [];
  state.translated++;
  return [...call, ...tests].join(' ');
}

// Where a program's SQL status goes: an SQLCA, whether included, copied or written out, or else a
// standalone SQLCODE, as STDSQL(YES) and SQLCA-less programs declare.
function statusArea(lines, format, items, blocks) {
  if (blocks.some((b) => /^INCLUDE\s+SQLCA\b/i.test(b.text))) return 'SQLCA';
  const names = new Set((items || []).map((it) => it.name));
  const code = lines.map((l) => { const a = codeArea(l, format); return a.comment ? '' : l.slice(a.start, a.end); }).join('\n');
  if (names.has('SQLCA') || /^\s*0?1\s+SQLCA\b|\bCOPY\s+["']?SQLCA\b/im.test(code)) return 'SQLCA';
  if (names.has('SQLCODE') || /^\s*\d{1,2}\s+SQLCODE\b/im.test(code)) return 'SQLCODE';
  return null;
}

// Writes `text` over the block's code area on its own lines, word by word, blank-padding the rest.
// Returns the words that did not fit, for lines added after the block.
function place(lines, block, format, text) {
  const words = text ? text.match(/(?:'[^']*'|"[^"]*"|[^\s'"])+/g) || [] : [];
  const free = isFree(format);
  let w = 0;
  for (let li = block.line; li <= block.endLine; li++) {
    const area = codeArea(lines[li], format);
    // The code area runs to column 72 however short the line is; free format has no margin.
    const limit = free ? Math.max(lines[li].length, 72) : 72;
    const blankFrom = li === block.line ? block.col : area.start;
    // A statement's continuation belongs in area B, column 12 of a fixed-format line.
    const writeFrom = li === block.line ? block.col : free ? area.start : Math.max(area.start, 11);
    const to = li === block.endLine ? block.endCol : limit;
    let out = '';
    while (w < words.length && writeFrom + out.length + (out ? 1 : 0) + words[w].length <= to) out += (out ? ' ' : '') + words[w++];
    const line = lines[li].padEnd(to);
    lines[li] = line.slice(0, blankFrom) + ' '.repeat(Math.max(0, writeFrom - blankFrom)) + out.padEnd(Math.max(0, to - Math.max(writeFrom, blankFrom))) + line.slice(to);
    if (li !== block.endLine) lines[li] = lines[li].replace(/\s+$/, '');
  }
  return words.slice(w);
}

// Lines for the words that did not fit, indented to area B.
function spill(words, format) {
  const indent = isFree(format) ? '    ' : ' '.repeat(11);
  const width = isFree(format) ? 120 : 72 - indent.length;
  const out = [];
  let cur = '';
  for (const word of words) {
    if (cur && cur.length + 1 + word.length > width) { out.push(indent + cur); cur = ''; }
    cur += (cur ? ' ' : '') + word;
  }
  if (cur) out.push(indent + cur);
  return out;
}

// A division or section header, or a word, standing alone: not part of a longer name.
const word = (re) => new RegExp(`(?<![A-Z0-9-])${re}(?![A-Z0-9-])`, 'i');
const HEADERS = [['procedure', word('PROCEDURE\\s+DIVISION')], ['linkage', word('LINKAGE\\s+SECTION')], ['data', word('DATA\\s+DIVISION')], ['after', word('(?:REPORT|SCREEN)\\s+SECTION')]];
const PROGRAM_ID = word('PROGRAM-ID');

// The program units of a source, each from its PROGRAM-ID to the next: where its DATA DIVISION,
// LINKAGE SECTION, REPORT or SCREEN SECTION and PROCEDURE DIVISION headers are, and its code.
function programUnits(lines, format) {
  const units = [{ start: 0, code: [] }];
  lines.forEach((l, i) => {
    const a = codeArea(l, format);
    if (a.comment) return;
    const code = l.slice(a.start, a.end);
    let unit = units[units.length - 1];
    if (PROGRAM_ID.test(code) && (unit.programId !== undefined || unit.procedure !== undefined)) units.push(unit = { start: i, code: [] });
    if (PROGRAM_ID.test(code)) unit.programId = i;
    unit.code.push(code);
    for (const [key, re] of HEADERS) if (unit[key] === undefined && (key === 'procedure' || unit.procedure === undefined) && re.test(code)) unit[key] = i;
  });
  units.forEach((u, k) => { u.end = k + 1 < units.length ? units[k + 1].start : lines.length; u.code = u.code.join('\n'); });
  return units;
}

const EIB_REFERENCE = word(`(?:${EIB_LAYOUT.map(([n]) => n).join('|')}|DFHEIBLK|DFHCOMMAREA)`);
const COMMAREA = word('DFHCOMMAREA');

// The SQLCA a program's INCLUDE SQLCA needs: Db2 for z/OS's 136-byte COBOL layout, with the
// STDSQL(YES) names SQLCADE and SQLSTAT over the fields they stand for.
export function sqlcaCopybook() {
  return [
    '       01 SQLCA.',
    '          05 SQLCAID PIC X(8).',
    '          05 SQLCABC PIC S9(9) COMP-5.',
    '          05 SQLCODE PIC S9(9) COMP-5.',
    '          05 SQLCADE REDEFINES SQLCODE PIC S9(9) COMP-5.',
    '          05 SQLERRM.',
    '             49 SQLERRML PIC S9(4) COMP-5.',
    '             49 SQLERRMC PIC X(70).',
    '          05 SQLERRP PIC X(8).',
    '          05 SQLERRD PIC S9(9) COMP-5 OCCURS 6.',
    '          05 SQLWARN.',
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => `             10 SQLWARN${n} PIC X.`),
    '          05 SQLEXT.',
    ...['8', '9', 'A'].map((n) => `             10 SQLWARN${n} PIC X.`),
    '             10 SQLSTATE PIC X(5).',
    '             10 SQLSTAT REDEFINES SQLSTATE PIC X(5).',
    '',
  ].join('\n');
}

// The SQLDA a program's INCLUDE SQLDA needs: Db2 for z/OS's COBOL field names and pictures.
export function sqldaCopybook() {
  return [
    '       01 SQLDA.',
    '          05 SQLDAID PIC X(8).',
    '          05 SQLDABC PIC S9(9) BINARY.',
    '          05 SQLN PIC S9(4) BINARY.',
    '          05 SQLD PIC S9(4) BINARY.',
    '          05 SQLVAR OCCURS 0 TO 750 TIMES DEPENDING ON SQLN.',
    '             10 SQLVAR1.',
    '                15 SQLTYPE PIC S9(4) BINARY.',
    '                15 SQLLEN PIC S9(4) BINARY.',
    '                15 FILLER REDEFINES SQLLEN.',
    '                   20 SQLPRECISION PIC X.',
    '                   20 SQLSCALE PIC X.',
    '                15 SQLDATA POINTER.',
    '                15 SQLIND POINTER.',
    '                15 SQLNAME.',
    '                   49 SQLNAMEL PIC S9(4) BINARY.',
    '                   49 SQLNAMEC PIC X(30).',
    '',
  ].join('\n');
}

// The COPY statements in a text's code areas: the line and column each starts at, and its member.
function copyStatements(lines, format) {
  const out = [];
  lines.forEach((l, i) => {
    const a = codeArea(l, format);
    if (a.comment) return;
    for (const m of l.slice(a.start, a.end).matchAll(/(?<![A-Z0-9-])COPY\s+(["']?)([A-Z0-9$#@_-]+)\1(?=[\s.]|$)/gi)) out.push({ line: i, col: a.start + m.index, name: m[2].toUpperCase() });
  });
  return out;
}

// A text's lines as a compiler reads them: a fixed-format line's columns after expanding its tabs.
const linesOf = (text, format) => text.split(/\r?\n/).map((l) => (isFree(format) ? l : expandTabs(l)));

// What the precompiler needs of a text: its blocks, built-ins, COPY statements and program units.
function survey(lines, format) {
  return { lines, ...findBlocks(lines, format), copies: copyStatements(lines, format), units: programUnits(lines, format) };
}

// A COPY member the caller's resolver finds, surveyed, with whether it or a member it copies needs the
// EIB and whether one of them holds the PROCEDURE DIVISION header. null when it cannot be read.
function memberOf(shared, name) {
  if (shared.members.has(name)) return shared.members.get(name);
  shared.members.set(name, null);
  const text = shared.copybook ? shared.copybook(name) : null;
  if (typeof text !== 'string') return null;
  const m = { name, ...survey(linesOf(text, shared.format), shared.format) };
  const nested = m.copies.map((c) => (c.member = memberOf(shared, c.name))).filter(Boolean);
  const code = m.units.map((u) => u.code).join('\n');
  m.eib = m.blocks.some((b) => b.kind === 'CICS') || EIB_REFERENCE.test(code) || nested.some((n) => n.eib);
  m.commarea = COMMAREA.test(code) || nested.some((n) => n.commarea);
  m.procedure = m.units.some((u) => u.procedure !== undefined) || nested.some((n) => n.procedure);
  shared.members.set(name, m);
  return m;
}

// Translates the blocks and built-ins of one text, and of the members it copies at the point each is
// copied, since WHENEVER applies in listing order through them. `ctx` says whether the text is the
// program or a member, and for a member whether it is copied into the procedure division and whether
// the EIB and the selector are in scope there. Returns the text's lines with those `before` and
// `after` it inserts, the source line each came from, and whether anything changed.
function translateText(t, shared, ctx, before = new Map(), after = new Map()) {
  const { format, state } = shared;
  const free = isFree(format);
  const lines = t.lines;
  const add = (at, li, text) => at.set(li, [...(at.get(li) || []), ...text]);
  for (const b of t.builtins) {
    const value = builtinValue(b.fn, b.name);
    if (value === undefined) state.unresolved++;
    else lines[b.line] = lines[b.line].slice(0, b.col) + String(value).padEnd(b.length) + lines[b.line].slice(b.col + b.length);
  }
  for (const b of t.blocks) { const inc = b.kind === 'SQL' && /^INCLUDE\s+(SQLCA|SQLDA)\b/i.exec(b.text); if (inc) shared.includes.add(inc[1].toUpperCase()); }
  const events = [...t.blocks.map((block) => ({ line: block.line, col: block.col, block })), ...t.copies.map((copy) => ({ line: copy.line, col: copy.col, copy }))]
    .sort((x, y) => x.line - y.line || x.col - y.col);
  for (const e of events) {
    const unit = t.units.findLast((u) => u.start <= e.line);
    const eib = ctx.top ? !!unit.eib : ctx.eib;
    const selector = ctx.top ? !!unit.selector : ctx.selector;
    const inProcedure = unit.procedure !== undefined && e.line >= unit.procedure;
    if (e.copy) {
      const m = e.copy.member;
      if (!m || m.done) continue;
      m.done = true;
      // The COPY that brings in the PROCEDURE DIVISION header is not itself in the procedure division.
      const procedure = ctx.procedure || (inProcedure && !(e.line === unit.procedure && m.procedure));
      const r = translateText(m, shared, { procedure, eib, selector });
      if (r.changed) shared.translated[m.name] = r.lines.join('\n');
      continue;
    }
    let b = e.block;
    state.procedure = ctx.procedure || inProcedure;
    state.eib = eib;
    state.selector = selector;
    let text = b.kind === 'CICS' ? translateCics(b, state) : translate(b, state);
    const area = codeArea(lines[b.endLine], format);
    const tail = lines[b.endLine].slice(b.endCol, area.end);
    // Where only a period follows END-EXEC, the rest of the code area is the translation's too.
    const periodOnly = text && /^\s*(\.)?\s*$/.exec(tail);
    if (periodOnly) {
      const limit = free ? Math.max(lines[b.endLine].length, 72) : 72;
      lines[b.endLine] = lines[b.endLine].slice(0, b.endCol) + ' '.repeat(Math.max(0, area.end - b.endCol)) + lines[b.endLine].slice(area.end);
      b = { ...b, endCol: limit };
      if (periodOnly[1]) text += ' .';
    }
    if (!text) {
      state.blanked++;
      // A blanked declaration takes its own period with it; left alone it is a stray full stop.
      const period = /^\s*\./.exec(tail);
      if (period) lines[b.endLine] = lines[b.endLine].slice(0, b.endCol) + ' '.repeat(period[0].length) + lines[b.endLine].slice(b.endCol + period[0].length);
    }
    const rest = place(lines, b, format, text);
    if (periodOnly) {
      lines[b.endLine] = lines[b.endLine].replace(/\s+$/, '');
      if (rest.length) { add(after, b.endLine, spill(rest, format)); state.spilled++; }
    } else if (rest.length) {
      // What followed END-EXEC - a period, or the rest of a sentence - follows the whole translation.
      lines[b.endLine] = lines[b.endLine].slice(0, b.endCol) + ' '.repeat(tail.length) + lines[b.endLine].slice(area.end);
      add(after, b.endLine, spill([...rest, ...(tail.trim() ? [tail.trim()] : [])], format));
      state.spilled++;
    }
  }
  const out = [];
  const map = [];
  lines.forEach((l, i) => {
    for (const s of [...(before.get(i) || []), l, ...(after.get(i) || [])]) { out.push(s); map.push(i + 1); }
  });
  return { lines: out, map, changed: t.blocks.length > 0 || t.builtins.length > 0 };
}

// Translates a program's EXEC SQL and EXEC CICS blocks, in its text and, as IBM's integrated
// translator does, in the COPY members `copybook(name)` returns the text of. `items` are the program's
// data items as lib/parser.mjs reads them, for the subscripts a host-variable array needs and the
// declarations its copybooks make; `mapsets` are BMS mapsets as lib/bms.mjs parses them, whose symbolic
// maps the program copies and its repository lacks. Returns { text, map, copybooks, handlers, stats }:
// `map[i]` is the 1-based source line output line i+1 came from; `copybooks` holds the stand-ins the
// COPY statements need that no repository holds and each member that needed translating, to be found
// ahead of the repository's copy; `handlers` are the HANDLE, IGNORE, PUSH and POP HANDLE commands.
export function precompile(src, { format = detectFormat(src), items, mapsets = [], copybook } = {}) {
  const free = isFree(format);
  const program = survey(linesOf(src, format), format);
  const shared = {
    format, copybook, members: new Map(), translated: {}, includes: new Set(),
    state: {
      procedure: false, cursors: new Map(), whenever: new Map(), translated: 0, subscripts: subscriptCounter(items),
      status: statusArea(program.lines, format, items, program.blocks),
      eib: false, selector: false, handlers: [], unknown: 0, undirected: 0, unresolved: 0, blanked: 0, spilled: 0,
    },
  };
  const { units, copies } = program;
  for (const c of copies) c.member = memberOf(shared, c.name);
  const within = (u, line) => line >= u.start && line < u.end;
  for (const c of copies) {
    const u = units.findLast((x) => x.start <= c.line);
    if (u.procedure === undefined && c.member?.procedure) u.procedure = c.line;
  }
  const before = new Map();
  const after = new Map();
  const add = (at, li, text) => at.set(li, [...(at.get(li) || []), ...text]);
  // A unit with CICS in it gets DFHEIBLK in its LINKAGE SECTION, as IBM's translator declares it,
  // unless it declares it itself, and DFHCOMMAREA where it names one it does not declare; one without
  // a LINKAGE SECTION gets one.
  const pad = format === 'terminal' ? ' ' : free ? '    ' : '       ';
  const declared = (unit, name) => word(`(?:0?1\\s+|COPY\\s+)${name}`).test(unit.code) || (items || []).some((it) => it.name === name && it.level === 1);
  let eibCopied = false;
  for (const unit of units) {
    const inUnit = copies.filter((c) => c.member && within(unit, c.line)).map((c) => c.member);
    const cics = program.blocks.some((b) => b.kind === 'CICS' && within(unit, b.line)) || inUnit.some((m) => m.eib) || EIB_REFERENCE.test(unit.code);
    if (unit.procedure === undefined || !cics) continue;
    const eib = !declared(unit, 'DFHEIBLK');
    const commarea = (COMMAREA.test(unit.code) || inUnit.some((m) => m.commarea)) && !declared(unit, 'DFHCOMMAREA');
    unit.eib = true;
    unit.selector = eib || word('COPY\\s+DFHEIBLK').test(unit.code);
    eibCopied ||= unit.selector;
    const decls = [...(eib ? [`${pad}COPY DFHEIBLK.`] : []), ...(commarea ? [`${pad}01 DFHCOMMAREA PIC X.`] : [])];
    if (!decls.length) continue;
    if (unit.linkage !== undefined) add(after, unit.linkage, decls);
    else add(before, Math.min(unit.procedure, unit.after ?? Infinity), [...(unit.data === undefined ? [`${pad}DATA DIVISION.`] : []), `${pad}LINKAGE SECTION.`, ...decls]);
  }
  const { lines, map } = translateText(program, shared, { top: true, procedure: false }, before, after);
  const { state, includes } = shared;
  const copied = new Set([...copies.map((c) => c.name), ...[...shared.members.values()].filter(Boolean).flatMap((m) => m.copies.map((c) => c.name))]);
  const copybooks = {
    ...(includes.has('SQLCA') ? { SQLCA: sqlcaCopybook() } : {}),
    ...(includes.has('SQLDA') ? { SQLDA: sqldaCopybook() } : {}),
  };
  if (eibCopied) copybooks.DFHEIBLK = eibCopybook();
  for (const [member, names] of Object.entries(CONSTANT_COPYBOOKS)) if (copied.has(member)) copybooks[member] = constantsCopybook(names);
  for (const mapset of mapsets) {
    const member = mapset.name?.toUpperCase();
    const cb = member && copied.has(member) && !copybooks[member] && symbolicMapCopybook(mapset);
    if (cb) copybooks[member] = cb.text;
  }
  for (const [member, text] of Object.entries(shared.translated)) copybooks[member] ??= text;
  const blocks = program.blocks.length + [...shared.members.values()].filter((m) => m?.done).reduce((n, m) => n + m.blocks.length, 0);
  return {
    text: lines.join('\n'),
    map,
    copybooks,
    handlers: state.handlers,
    stats: { blocks, translated: state.translated, blanked: state.blanked, spilled: state.spilled, unknown: state.unknown, undirected: state.undirected, unresolved: state.unresolved, members: Object.keys(shared.translated).length },
  };
}
