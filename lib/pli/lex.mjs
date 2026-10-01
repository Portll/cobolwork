// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I source as tokens and statements: the margins a file is read with, comments and literals
// removed or kept as tokens, and the semicolon-terminated statements with their label and condition
// prefixes. Classification by statement kind is in lib/pli/statements.mjs.

const PROCESS_LINE = /^[*%]PROCESS\b(.*)$/i;
const CARRIAGE = new Set([' ', '0', '1', '-', '+']);
const SEQUENCE = /^[ A-Za-z0-9]{0,8}$/;

// Enterprise PL/I reads columns 2 to 72 unless *PROCESS MARGINS says otherwise. Public source is
// often written from column 1 to any width, and read with MARGINS(2,72) it loses its first column
// and its tail, so the margins are taken from the file itself and the reason recorded.
export function marginsOf(text) {
  const lines = text.split(/\r?\n/);
  for (const l of lines) {
    const m = PROCESS_LINE.exec(l);
    const opt = m && /\bMAR(?:GINS)?\s*\(\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/i.exec(m[1]);
    if (opt) return { left: Number(opt[1]), right: Number(opt[2]), carriage: opt[3] ? Number(opt[3]) : 0, reason: 'process-option' };
  }
  const body = lines.filter((l) => !PROCESS_LINE.test(l));
  const long = body.filter((l) => l.replace(/\s+$/, '').length > 72);
  const sequenceLike = long.filter((l) => l.length <= 80 && SEQUENCE.test(l.slice(72).replace(/\s+$/, '')) && /\d/.test(l.slice(72))).length;
  const sequenced = long.length > 0 && sequenceLike >= 0.95 * long.length;
  const firstColumnFree = body.every((l) => !l.length || CARRIAGE.has(l[0]));
  const left = firstColumnFree ? 2 : 1;
  const right = long.length === 0 || sequenced ? 72 : Infinity;
  const carriage = left === 2 && body.some((l) => l.length && l[0] !== ' ') ? 1 : 0;
  const reason = right === Infinity ? 'text-beyond-72' : sequenced ? 'sequence-area' : 'default';
  return { left, right, carriage, reason };
}

const NOT = new Set(['¬', '^', '~']);
const OPS3 = ['||=', '**=', '¬=>', '^=>'];
const OPS2 = ['->', '=>', '¬=', '^=', '~=', '<>', '<=', '>=', '¬<', '¬>', '^<', '^>', '~<', '~>', '||', '!!', '**', '+=', '-=', '*=', '/=', '|=', '&='];
const OPS1 = '+-*/=<>&|!:.,()%?';

const LIT_SUFFIX = /^(?:B[1-4]?X?|BX|XN|XU|GX|WX|UX|X|G|M|W|A|E|U)(?![A-Za-z0-9_$#@])/i;
const NUMBER = /^(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[EeSsDdQq][+-]?\d+)?(?:[Bb](?![A-Za-z0-9_$#@]))?(?:[Ii](?![A-Za-z0-9_$#@]))?/;
const WORD_START = /[A-Za-z$#@_À-ɏ]/;
const WORD_REST = /[A-Za-z0-9$#@_À-ɏ]/;

// Tokens over the whole text, so a comment or literal that runs across lines is one token.
// { t: 'word', v, u } | { t: 'lit', v, suffix } | { t: 'num', v } | { t: 'op', v } | { t: 'semi' },
// each with line and col as the source has them.
export function tokenize(text, { file = null, margins = marginsOf(text) } = {}) {
  const diags = [];
  const process = [];
  const physical = text.split(/\r?\n/);
  const rows = physical.map((l, k) => {
    if (PROCESS_LINE.test(l)) { process.push({ line: k + 1, options: PROCESS_LINE.exec(l)[1].replace(/;\s*$/, '').trim() }); return ''; }
    return l.slice(margins.left - 1, margins.right === Infinity ? undefined : margins.right).replace(/\t/g, ' ');
  });
  const tokens = [];
  const at = (line, col) => ({ line, col: col + margins.left, ...(file ? { file } : {}) });
  let line = 0;
  let i = 0;
  const source = rows;
  while (line < source.length) {
    const s = source[line];
    if (i >= s.length) { line++; i = 0; continue; }
    const c = s[i];
    if (c === ' ' || c === '\f' || c === '\r' || c === '\v') { i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      const start = at(line + 1, i);
      let l = line, k = i + 2, closed = false;
      while (l < source.length) {
        const e = source[l].indexOf('*/', k);
        if (e >= 0) { line = l; i = e + 2; closed = true; break; }
        l++; k = 0;
      }
      if (!closed) { diags.push({ sev: 'error', kind: 'unterminated-comment', ...start }); line = source.length; }
      continue;
    }
    if (c === "'" || c === '"') {
      const start = at(line + 1, i);
      let v = '', l = line, k = i + 1, closed = false;
      while (l < source.length) {
        const row = source[l];
        if (k >= row.length) { l++; k = 0; continue; }
        if (row[k] === c) {
          if (row[k + 1] === c) { v += c; k += 2; continue; }
          closed = true; k++; break;
        }
        v += row[k++];
      }
      if (!closed) { diags.push({ sev: 'error', kind: 'unterminated-literal', ...start }); line = source.length; i = 0; tokens.push({ t: 'lit', v, suffix: '', ...start }); continue; }
      line = l; i = k;
      const suf = LIT_SUFFIX.exec(source[line].slice(i));
      const suffix = suf ? suf[0].toUpperCase() : '';
      if (suf) i += suf[0].length;
      tokens.push({ t: 'lit', v, suffix, quote: c, ...start });
      continue;
    }
    const num = /[0-9.]/.test(c) ? NUMBER.exec(s.slice(i)) : null;
    if (num && !(c === '.' && !/[0-9]/.test(s[i + 1] || ''))) {
      tokens.push({ t: 'num', v: num[0], ...at(line + 1, i) });
      i += num[0].length;
      continue;
    }
    if (WORD_START.test(c)) {
      let j = i + 1;
      while (j < s.length && WORD_REST.test(s[j])) j++;
      const v = s.slice(i, j);
      tokens.push({ t: 'word', v, u: v.toUpperCase(), ...at(line + 1, i) });
      i = j;
      continue;
    }
    if (c === ';') { tokens.push({ t: 'semi', ...at(line + 1, i) }); i++; continue; }
    const three = s.slice(i, i + 3);
    const two = s.slice(i, i + 2);
    const op = OPS3.find((o) => o === three) || OPS2.find((o) => o === two) || (OPS1.includes(c) || NOT.has(c) ? c : null);
    if (op) {
      tokens.push({ t: 'op', v: normalOp(op), ...at(line + 1, i) });
      i += op.length;
      continue;
    }
    diags.push({ sev: 'warn', kind: 'unexpected-char', char: c, ...at(line + 1, i) });
    i++;
  }
  return { tokens, diags, process, margins };
}

const normalOp = (op) => op.replace(/^[\^~]/, '¬').replace(/^!!$/, '||').replace(/^!$/, '|');

// A leading `name:` is a label, `name(3):` a subscripted label, and `(SIZE, NOFOFL):` a condition
// prefix. They may repeat and mix, and are taken off before the statement is classified.
function prefixes(toks) {
  const labels = [];
  const conditions = [];
  let i = 0;
  for (;;) {
    const a = toks[i], b = toks[i + 1];
    if (a && a.t === 'word' && b && b.t === 'op' && b.v === ':') { labels.push({ name: a.u, line: a.line }); i += 2; continue; }
    if (a && a.t === 'word' && b && b.t === 'op' && b.v === '(') {
      const close = closing(toks, i + 1);
      if (close > 0 && toks[close + 1] && toks[close + 1].t === 'op' && toks[close + 1].v === ':' && toks.slice(i + 2, close).every((t) => t.t === 'num' || (t.t === 'op' && (t.v === ',' || t.v === '-' || t.v === '+')))) {
        labels.push({ name: a.u, line: a.line, subscript: toks.slice(i + 2, close).map((t) => t.v).join('') });
        i = close + 2;
        continue;
      }
    }
    if (a && a.t === 'op' && a.v === '(') {
      const close = closing(toks, i);
      if (close > 0 && toks[close + 1] && toks[close + 1].t === 'op' && toks[close + 1].v === ':' && toks.slice(i + 1, close).every((t) => t.t === 'word' || (t.t === 'op' && t.v === ','))) {
        for (const t of toks.slice(i + 1, close)) if (t.t === 'word') conditions.push(t.u);
        i = close + 2;
        continue;
      }
    }
    return { labels, conditions, at: i };
  }
}

// The index of the parenthesis closing the one at `open`, or -1 when it is not closed.
export function closing(toks, open) {
  let depth = 0;
  for (let k = open; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'op') continue;
    if (t.v === '(') depth++;
    else if (t.v === ')' && --depth === 0) return k;
  }
  return -1;
}

// Statements split at semicolons. Each carries its prefixes and the tokens after them; a trailing
// run with no semicolon is kept as a statement and flagged, never dropped.
export function statements(tokens) {
  const out = [];
  let cur = [];
  const close = (semi) => {
    if (!cur.length && !semi) return;
    const { labels, conditions, at } = prefixes(cur);
    const toks = cur.slice(at);
    const first = cur[0] || semi;
    const last = cur[cur.length - 1] || semi;
    out.push({ labels, conditions, toks, line: first.line, endLine: (semi || last).line, ...(first.file ? { file: first.file } : {}), ...(semi ? {} : { unterminated: true }) });
    cur = [];
  };
  for (const t of tokens) {
    if (t.t === 'semi') close(t);
    else cur.push(t);
  }
  close(null);
  return out;
}

// UTF-8 where the bytes are valid UTF-8, else Latin-1: a ¬ read as Latin-1 from UTF-8 is two
// characters and moves every column after it.
export function sourceText(buf) {
  const utf8 = buf.toString('utf8');
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

export function readPli(text, opts = {}) {
  const { tokens, diags, process, margins } = tokenize(text, opts);
  return { statements: statements(tokens), diags, process, margins };
}
