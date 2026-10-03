// SPDX-License-Identifier: AGPL-3.0-or-later
// Where the assembler would put each open-code statement and symbol: location counters per control
// and dummy section, symbol values, length attributes and types, literal pools, and the external
// symbols a module defines and needs. Offsets are relative to their section. Nothing after a
// statement whose length cannot be known (a macro call, a COPY member, a conditional branch, a
// statement the reader refused) is placed in its section: its location is null and says after which
// line, since a guessed location would be graded as the assembler's.
// https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=reference-location-counter
import { readHlasmStatements, parseHlasmStatement } from './read.mjs';

const ALIGN = { H: 2, Y: 2, S: 2, F: 4, E: 4, A: 4, V: 4, Q: 4, J: 4, R: 4, D: 8, L: 8 };
const ALIGN_EXT = { FD: 8, AD: 8, VD: 8, QD: 8, JD: 8, RD: 8, LQ: 16, SY: 1, QY: 1 };
const FIXED = { F: 4, H: 2, E: 4, D: 8, L: 16, A: 4, Y: 2, S: 2, V: 4, Q: 4, J: 4, R: 4 };
const FIXED_EXT = { FD: 8, AD: 8, VD: 8, QD: 8, JD: 8, RD: 8, SY: 3, QY: 3 };
const NO_STORAGE = new Set(['USING', 'DROP', 'PRINT', 'TITLE', 'EJECT', 'SPACE', 'CEJECT', 'AMODE', 'RMODE', 'ENTRY',
  'EXTRN', 'WXTRN', 'PUSH', 'POP', 'MNOTE', 'ICTL', 'ISEQ', 'PUNCH', 'REPRO', 'OPSYN', 'ACONTROL', 'ADATA', 'EXITCTL',
  'XATTR', 'ALIAS', 'CATTR', 'MACRO DEFINITION', 'PROTOTYPE', 'MODEL']);
const SECTION = { CSECT: 'CST', RSECT: 'CST', START: 'CST', COM: 'COM', DSECT: 'DST' };
// Conditional assembly that only declares or sets variables does not change which statements are read.
const QUIET_CONDITIONAL = new Set(['ANOP', 'SETA', 'SETB', 'SETC', 'LCLA', 'LCLB', 'LCLC', 'GBLA', 'GBLB', 'GBLC', 'ACTR', 'MHELP']);

const alignUp = (n, a) => Math.ceil(n / a) * a;
const typeKey = (o) => `${o.type}${o.ext || ''}`;

const EBCDIC = (() => {
  const t = {};
  const rows = [[0x40, ' '], [0x4b, '.'], [0x4c, '<'], [0x4d, '('], [0x4e, '+'], [0x50, '&'], [0x5b, '$'], [0x5c, '*'], [0x5d, ')'], [0x5e, ';'],
    [0x60, '-'], [0x61, '/'], [0x6b, ','], [0x6c, '%'], [0x6d, '_'], [0x6e, '>'], [0x6f, '?'], [0x7a, ':'], [0x7b, '#'], [0x7c, '@'], [0x7d, "'"], [0x7e, '='], [0x7f, '"']];
  for (const [code, ch] of rows) t[ch] = code;
  'ABCDEFGHI'.split('').forEach((c, i) => { t[c] = 0xc1 + i; t[c.toLowerCase()] = 0x81 + i; });
  'JKLMNOPQR'.split('').forEach((c, i) => { t[c] = 0xd1 + i; t[c.toLowerCase()] = 0x91 + i; });
  'STUVWXYZ'.split('').forEach((c, i) => { t[c] = 0xe2 + i; t[c.toLowerCase()] = 0xa2 + i; });
  '0123456789'.split('').forEach((c, i) => { t[c] = 0xf0 + i; });
  return t;
})();

function selfDefining(sdt) {
  const text = sdt.text;
  if (sdt.type === 'X') return /^[0-9A-F]+$/i.test(text) ? parseInt(text, 16) : null;
  if (sdt.type === 'B') return /^[01]+$/.test(text) ? parseInt(text, 2) : null;
  if (sdt.type === 'C' || sdt.type === 'CE') {
    let v = 0;
    for (const ch of text) { if (EBCDIC[ch] === undefined) return null; v = v * 256 + EBCDIC[ch]; }
    return v;
  }
  return null;
}

// The values, one per constant, an operand's nominal field holds, and the implicit length of each.
function nominalLengths(o) {
  const key = typeKey(o);
  const n = o.nominal;
  if (n && n.expressions) return n.expressions.map(() => FIXED_EXT[key] ?? FIXED[o.type]);
  if (FIXED_EXT[key] || FIXED[o.type]) {
    const count = n && n.quoted !== undefined ? n.quoted.split(',').length : 1;
    return Array(count).fill(FIXED_EXT[key] ?? FIXED[o.type]);
  }
  if (!n) return [1];
  const q = n.quoted;
  if (o.type === 'C') return [o.ext === 'U' ? q.length * 2 : q.length];
  if (o.type === 'X') return q.split(',').map((v) => Math.ceil(v.replace(/\s/g, '').length / 2));
  if (o.type === 'B') return q.split(',').map((v) => Math.ceil(v.replace(/\s/g, '').length / 8));
  if (o.type === 'P') return q.split(',').map((v) => Math.ceil((v.replace(/[^0-9]/g, '').length + 1) / 2));
  if (o.type === 'Z') return q.split(',').map((v) => v.replace(/[^0-9]/g, '').length);
  return null;
}

export function locate(text) {
  const { statements } = readHlasmStatements(text);
  const sections = new Map();
  const order = [];
  const symbols = new Map();
  const placed = [];
  const literals = { pending: [], seen: new Set() };
  const esd = { entries: [], externals: [] };
  let current = null;
  let lost = null;
  const unknown = [];

  const section = (name, type) => {
    if (!sections.has(name)) {
      sections.set(name, { name, type, lc: 0, high: 0, after: null, line: null });
      order.push(name);
    }
    return sections.get(name);
  };
  const here = () => current || (current = section('', 'CST'));
  const advance = (s, to) => { s.lc = to; s.high = Math.max(s.high, to); };
  const markUnknown = (s, line, why) => { if (s && s.after === null) { s.after = line; unknown.push({ line, why }); } };

  function value(e, s) {
    if (!e) return null;
    switch (e.t) {
      case 'num': return { abs: e.v };
      case 'sdt': { const v = selfDefining(e); return v === null ? null : { abs: v }; }
      case 'loc': return s && s.after === null ? { sec: s.name, off: s.lc } : null;
      case 'paren': return value(e.e, s);
      case 'unary': { const v = value(e.e, s); return v && v.abs !== undefined ? { abs: e.op === '-' ? -v.abs : v.abs } : null; }
      case 'sym': {
        const y = symbols.get(e.name);
        if (!y || y.value === null) return null;
        return y.value;
      }
      case 'attr': {
        if (e.attr !== 'L') return null;
        if (e.of.t === 'loc') return { abs: 1 };
        const y = e.of.t === 'sym' ? symbols.get(e.of.name) : null;
        return y && y.len !== null ? { abs: y.len } : null;
      }
      case 'bin': {
        const l = value(e.l, s);
        const r = value(e.r, s);
        if (!l || !r) return null;
        if (e.op === '+' || e.op === '-') {
          if (l.abs !== undefined && r.abs !== undefined) return { abs: e.op === '+' ? l.abs + r.abs : l.abs - r.abs };
          if (l.sec !== undefined && r.abs !== undefined) return { sec: l.sec, off: e.op === '+' ? l.off + r.abs : l.off - r.abs };
          if (e.op === '+' && l.abs !== undefined && r.sec !== undefined) return { sec: r.sec, off: r.off + l.abs };
          if (e.op === '-' && l.sec !== undefined && r.sec !== undefined && l.sec === r.sec) return { abs: l.off - r.off };
          return null;
        }
        if (l.abs === undefined || r.abs === undefined) return null;
        if (e.op === '*') return { abs: l.abs * r.abs };
        return r.abs === 0 ? { abs: 0 } : { abs: Math.trunc(l.abs / r.abs) };
      }
      default: return null;
    }
  }
  const absolute = (e, s) => { const v = value(e, s); return v && v.abs !== undefined ? v.abs : null; };

  // Length, alignment and size of one DC or DS operand, or null when one of them cannot be known.
  function constant(o, s) {
    const dup = o.dup ? absolute(o.dup, s) : 1;
    if (dup === null || o.bitLength) return null;
    let lengths;
    let align = 1;
    if (o.length) {
      const n = absolute(o.length, s);
      if (n === null) return null;
      const count = o.nominal ? (o.nominal.expressions ? o.nominal.expressions.length : (['C', 'G'].includes(o.type) ? 1 : o.nominal.quoted.split(',').length)) : 1;
      lengths = Array(count).fill(n);
    } else {
      lengths = nominalLengths(o);
      if (!lengths) return null;
      align = ALIGN_EXT[typeKey(o)] ?? ALIGN[o.type] ?? 1;
    }
    return { align, length: lengths[0], size: dup * lengths.reduce((a, b) => a + b, 0) };
  }

  function define(st, s, off, len, type, how) {
    if (!st.name || st.name.startsWith('&') || st.name.startsWith('.')) return;
    const name = st.name.toUpperCase();
    const known = s.after === null && off !== null;
    symbols.set(name, { name, line: st.line, section: s.name, value: known ? { sec: s.name, off } : null, len, type, how, after: known ? null : s.after });
  }

  // An EQU with no length operand takes the length of its value's leftmost term: 1 for *, a
  // self-defining term, L' or a symbol naming an assembler instruction other than DC, DS or CCW.
  // https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=instructions-equ-instruction
  function leftmostLength(e) {
    while (e && (e.t === 'bin' || e.t === 'paren' || e.t === 'unary')) e = e.t === 'bin' ? e.l : e.e;
    if (!e) return null;
    if (e.t !== 'sym') return 1;
    const y = symbols.get(e.name);
    return y ? y.len : null;
  }

  function literalsIn(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (node.t === 'lit') out.push(node.dc);
    for (const v of Object.values(node)) if (v && typeof v === 'object') literalsIn(v, out);
    return out;
  }

  function pool(s, line) {
    if (!literals.pending.length) return;
    if (s.after !== null) { literals.pending = []; return; }
    const group = (lit) => (lit.size % 8 === 0 ? 0 : lit.size % 4 === 0 ? 1 : lit.size % 2 === 0 ? 2 : 3);
    const sized = literals.pending.map((dc) => ({ dc, ...constant(dc, s) }));
    if (sized.some((x) => x.size === undefined || x.size === null)) { literals.pending = []; markUnknown(s, line, 'literal of unknown length'); return; }
    let at = alignUp(s.lc, 8);
    for (const g of [0, 1, 2, 3]) for (const x of sized.filter((y) => group(y) === g)) at += x.size;
    advance(s, at);
    literals.pending = [];
    literals.seen = new Set();
  }

  let first = null;
  for (const st of statements) {
    if (st.inMacro) continue;
    let r = parseHlasmStatement(st);
    // An open-code statement with variable symbols is placed as what it reads as, when its lengths
    // do not depend on a variable's value; its label is a variable and defines nothing here.
    if (r.kind === 'SUBSTITUTED' && r.status === 'parsed' && r.node.exact) r = { kind: r.node.as, status: 'parsed', node: r.node.node };
    const kind = r.kind;
    if (kind === 'UNREADABLE' || kind === 'UNKNOWN') { markUnknown(here(), st.line, `${kind}`); continue; }
    if (kind === 'CONDITIONAL') {
      if (!QUIET_CONDITIONAL.has(st.operation)) { lost = lost ?? st.line; for (const s of sections.values()) markUnknown(s, st.line, st.operation); markUnknown(here(), st.line, st.operation); }
      continue;
    }
    if (SECTION[kind]) {
      const name = (st.name || '').toUpperCase();
      current = section(name, SECTION[kind]);
      if (kind !== 'DSECT' && first === null) first = current;
      if (current.line === null) current.line = st.line;
      if (r.status === 'parsed' && kind === 'START' && r.node.origin) {
        const o = absolute(r.node.origin, current);
        if (o === null) markUnknown(current, st.line, 'START origin'); else advance(current, o);
      }
      if (lost !== null) markUnknown(current, lost, 'conditional assembly');
      placed.push({ line: st.line, section: current.name, loc: current.after === null ? current.lc : null });
      if (!symbols.has(name) && name) symbols.set(name, { name, line: st.line, section: name, value: { sec: name, off: 0 }, len: 1, type: SECTION[kind], how: 'SECTION', after: null });
      continue;
    }
    const s = here();
    const at = () => (s.after === null ? s.lc : null);
    // Statements that take no storage leave the location counter where it is, read or not.
    if (NO_STORAGE.has(kind) || kind === 'ENTRY' || kind === 'EXTRN' || kind === 'WXTRN' || kind === 'END') {
      placed.push({ line: st.line, section: s.name, loc: at() });
      if (r.status === 'parsed' && kind === 'ENTRY') for (const n of r.node.names || []) esd.entries.push({ name: n, line: st.line });
      if (r.status === 'parsed' && (kind === 'EXTRN' || kind === 'WXTRN')) for (const n of r.node.names || []) esd.externals.push({ name: n, how: kind, line: st.line });
      if (kind === 'END') break;
      continue;
    }
    if (kind === 'LTORG') { placed.push({ line: st.line, section: s.name, loc: at() }); define(st, s, s.lc, 1, 'REL', 'LTORG'); pool(s, st.line); continue; }
    if (r.status !== 'parsed') { placed.push({ line: st.line, section: s.name, loc: null }); markUnknown(s, st.line, `${kind} ${r.status}`); continue; }
    const node = r.node;
    for (const dc of literalsIn(node)) {
      const key = JSON.stringify(dc);
      if (!literals.seen.has(key)) { literals.seen.add(key); literals.pending.push(dc); }
      if (dc.type === 'V' && dc.nominal && dc.nominal.expressions) for (const e of dc.nominal.expressions) if (e.t === 'sym') esd.externals.push({ name: e.name, how: 'V', line: st.line });
    }
    if (node.kind === 'INSTRUCTION') {
      const at = alignUp(s.lc, 2);
      placed.push({ line: st.line, section: s.name, loc: s.after === null ? at : null });
      define(st, s, at, node.length, 'REL', 'INSTRUCTION');
      advance(s, at + node.length);
      continue;
    }
    if (kind === 'DC' || kind === 'DS') {
      let at = s.lc;
      let firstAt = null;
      let firstLen = null;
      let known = s.after === null;
      for (const o of node.operands) {
        if (kind === 'DC' && o.type === 'V' && o.nominal && o.nominal.expressions) for (const e of o.nominal.expressions) if (e.t === 'sym') esd.externals.push({ name: e.name, how: 'V', line: st.line });
        const c = known ? constant(o, s) : null;
        if (!c) { known = false; continue; }
        at = alignUp(at, c.align);
        if (firstAt === null) { firstAt = at; firstLen = c.length; }
        at += c.size;
      }
      if (!known) { placed.push({ line: st.line, section: s.name, loc: null }); markUnknown(s, st.line, `${kind} of unknown length`); define(st, s, null, null, 'REL', kind); continue; }
      placed.push({ line: st.line, section: s.name, loc: firstAt });
      define(st, s, firstAt, firstLen, 'REL', kind);
      advance(s, at);
      continue;
    }
    if (kind === 'EQU') {
      const v = value(node.value, s);
      const len = node.length ? absolute(node.length, s) : leftmostLength(node.value);
      const name = (st.name || '').toUpperCase();
      if (name) symbols.set(name, { name, line: st.line, section: v && v.sec !== undefined ? v.sec : null, value: v, len, type: v && v.abs !== undefined ? 'ABS' : 'REL', how: 'EQU', after: v ? null : s.after });
      placed.push({ line: st.line, section: s.name, loc: s.after === null ? s.lc : null });
      continue;
    }
    if (kind === 'ORG') {
      placed.push({ line: st.line, section: s.name, loc: s.after === null ? s.lc : null });
      if (s.after !== null) continue;
      if (!node.value) { advance(s, s.high); s.lc = s.high; continue; }
      const v = value(node.value, s);
      if (!v || v.sec !== s.name) { markUnknown(s, st.line, 'ORG to an unknown location'); continue; }
      let to = v.off;
      if (node.boundary) to = alignUp(to, node.boundary) + (node.offset ? absolute(node.offset, s) ?? 0 : 0);
      s.lc = to;
      s.high = Math.max(s.high, to);
      continue;
    }
    if (kind === 'CNOP') {
      const b = absolute(node.byte, s);
      const w = absolute(node.boundary, s);
      placed.push({ line: st.line, section: s.name, loc: s.after === null ? s.lc : null });
      if (b === null || !w) { markUnknown(s, st.line, 'CNOP'); continue; }
      let at = alignUp(s.lc, 2);
      while (at % w !== b) at += 2;
      advance(s, at);
      continue;
    }
    if (kind === 'CCW' || kind === 'CCW0' || kind === 'CCW1') {
      const at = alignUp(s.lc, 8);
      placed.push({ line: st.line, section: s.name, loc: s.after === null ? at : null });
      define(st, s, at, 8, 'REL', 'CCW');
      advance(s, at + 8);
      continue;
    }
    placed.push({ line: st.line, section: s.name, loc: null });
    markUnknown(s, st.line, kind);
  }
  if (literals.pending.length) pool(first || here(), null);

  return {
    sections: order.map((n) => { const s = sections.get(n); return { name: n, type: s.type, line: s.line, length: s.after === null ? s.high : null, after: s.after }; }),
    symbols: [...symbols.values()].map((y) => ({ name: y.name, line: y.line, section: y.section, loc: y.value && y.value.sec !== undefined ? y.value.off : y.value ? y.value.abs : null, len: y.len, type: y.type, how: y.how, after: y.after })),
    statements: placed,
    esd,
    unknown,
  };
}
