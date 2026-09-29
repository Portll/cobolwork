// SPDX-License-Identifier: AGPL-3.0-or-later
// Statement order, which the data-flow graph does not have.
//
// The graph says where a value can go and nothing about when. A check on a field was therefore
// credited wherever the field was used - where the check had not run yet, and on routes it never
// ran on. On the corpus that credited a prompt buffer tested IS NUMERIC for one prompt and used,
// unchecked, for another. And a check could only lower a finding, never clear one, because nothing
// could say the check ran first and turned the bad value away.
//
// This builds each program's procedure division as a control-flow graph - IF, EVALUATE, SEARCH,
// inline and performed PERFORM, GO TO, NEXT SENTENCE, EXIT, the conditional phrases of READ, CALL and
// arithmetic, and the statements that end a run - and computes, for every statement, which checks
// have run on every route to it since the field they test was last written, and what each check's
// outcome says the field can hold there. A performed range is summarised once and entered with what
// holds at every PERFORM of it, so a paragraph shared by fifty callers does not blur the order of any
// of them.
//
// What it does not model: control transferred by EXEC CICS HANDLE CONDITION, AID or ABEND, which
// enters its label from any later command, and declaratives, which enter on an error. Each is
// entered holding no facts at all, which can only withhold credit. ALTER makes a GO TO reach every
// paragraph, for the same reason.
import { segmentEnd } from './parser.mjs';

const WORD = (t, u) => t && t.t === 'word' && t.u === u;
const PHRASED = new Set(['READ', 'WRITE', 'REWRITE', 'DELETE', 'START', 'RETURN', 'CALL', 'COMPUTE', 'ADD', 'SUBTRACT',
  'MULTIPLY', 'DIVIDE', 'STRING', 'UNSTRING', 'ACCEPT', 'DISPLAY', 'INVOKE', 'JSON', 'XML', 'RECEIVE', 'SEND']);
const PHRASE_WORDS = new Set(['END', 'INVALID', 'EXCEPTION', 'OVERFLOW', 'END-OF-PAGE', 'EOP']);
// One copy of every node's facts. The analysis keeps a few, so this is a quarter of what it may use.
const FACT_BUDGET_BYTES = 256 * 1024 * 1024;
const SETTLE_BUDGET = 20 * 1000 * 1000;
// Routines whose only effect is to end the run with an abend.
const ABEND_ROUTINE = /^(CEE3ABD|CEE3AB2|ILBOABN0|ILBOABN|CEE3DMP)$/i;

const opensPhrase = (seg) => seg.some((x, i) => x.t === 'word' && (PHRASE_WORDS.has(x.u) || (x.u === 'ERROR' && seg[i - 1] && seg[i - 1].u === 'SIZE')));

// ---- facts ------------------------------------------------------------------------------------

// A check's outcome, as what it says a field can hold: one of a set of literals, a class, a range.
// Two operations: `meet` is both of two things being true, `join` is either of them.
function meet(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = {};
  if (a.set && b.set) out.set = new Set([...a.set].filter((v) => b.set.has(v)));
  else if (a.set || b.set) out.set = new Set(a.set || b.set);
  if (a.numeric || b.numeric) out.numeric = true;
  if (a.alpha || b.alpha) out.alpha = true;
  const lo = pick(a, b, 'lo', Math.max);
  const hi = pick(a, b, 'hi', Math.min);
  if (lo) { out.lo = lo.v; out.loInc = lo.inc; }
  if (hi) { out.hi = hi.v; out.hiInc = hi.inc; }
  return out;
}
function join(a, b) {
  if (!a || !b) return null;
  // A set of numbers is also a range and a class, so either side of a join can say what it bounds:
  // a length clamped to 80 on one branch and tested <= 80 on the other is at most 80 after both.
  a = asRange(a);
  b = asRange(b);
  const out = {};
  if (a.set && b.set) out.set = new Set([...a.set, ...b.set]);
  if (a.numeric && b.numeric) out.numeric = true;
  if (a.alpha && b.alpha) out.alpha = true;
  if (a.lo != null && b.lo != null) { out.lo = Math.min(a.lo, b.lo); out.loInc = a.lo === out.lo ? a.loInc : b.loInc; }
  if (a.hi != null && b.hi != null) { out.hi = Math.max(a.hi, b.hi); out.hiInc = a.hi === out.hi ? a.hiInc : b.hiInc; }
  return Object.keys(out).length ? out : null;
}
// Whether a known value meets what a check's outcome says of its field.
function satisfies(cons, v) {
  if (!cons) return false;
  const num = /^[+-]?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
  if (cons.set && !cons.set.has(v)) return false;
  if (cons.numeric && num == null) return false;
  if (cons.alpha && !/^[A-Za-z ]*$/.test(v)) return false;
  if (cons.lo != null && (num == null || (cons.loInc ? num < cons.lo : num <= cons.lo))) return false;
  if (cons.hi != null && (num == null || (cons.hiInc ? num > cons.hi : num >= cons.hi))) return false;
  return true;
}
function asRange(c) {
  if (!c.set || !c.set.size || ![...c.set].every((v) => /^[+-]?\d+(\.\d+)?$/.test(v))) return c;
  const nums = [...c.set].map(Number);
  const out = { ...c, numeric: true };
  if (out.lo == null) { out.lo = Math.min(...nums); out.loInc = true; }
  if (out.hi == null) { out.hi = Math.max(...nums); out.hiInc = true; }
  return out;
}
function pick(a, b, k, better) {
  const av = a[k] != null ? { v: a[k], inc: a[`${k}Inc`] } : null;
  const bv = b[k] != null ? { v: b[k], inc: b[`${k}Inc`] } : null;
  if (!av) return bv;
  if (!bv) return av;
  const v = better(av.v, bv.v);
  return v === av.v ? av : bv;
}

// Whether a constraint makes a value safe for what the sink does with it. A value that can only be
// one of a set of literals is safe everywhere. Digits alone cannot carry a command, a statement, a
// script or a job, and are exactly what arithmetic needs. Letters and spaces cannot carry markup or a
// line break, but can spell a command or a program name. A bound is what an index needs.
export function stops(cons, sinkKind) {
  if (!cons) return false;
  const set = cons.set && cons.set.size > 0;
  const allDigits = set && [...cons.set].every((v) => /^[+-]?\d+(\.\d+)?$/.test(v));
  switch (sinkKind) {
    case 'arithmetic': return cons.numeric === true || allDigits;
    case 'subscript': case 'reference-modification': case 'occurs-depending-count': case 'loop-bound':
      return cons.hi != null || allDigits;
    case 'dynamic-sql': case 'internal-reader': return set || cons.numeric === true;
    case 'web-response': case 'http-header': case 'log': return set || cons.numeric === true || cons.alpha === true;
    case 'os-command': case 'dynamic-program-load': case 'cics-dynamic-transfer': case 'dynamic-file-path':
    case 'queue-name': case 'outbound-host': return set;
    default: return false;
  }
}

// ---- conditions --------------------------------------------------------------------------------

const RELOP = { '=': '=', '>': '>', '<': '<', '>=': '>=', '<=': '<=', '<>': '<>' };
const CLASS = new Set(['NUMERIC', 'ALPHABETIC', 'ALPHABETIC-LOWER', 'ALPHABETIC-UPPER']);
const SIGN = new Set(['POSITIVE', 'NEGATIVE', 'ZERO', 'ZEROS', 'ZEROES']);
const FIGURATIVE = { SPACE: ' ', SPACES: ' ', ZERO: '0', ZEROS: '0', ZEROES: '0', 'LOW-VALUE': '\u0000', 'LOW-VALUES': '\u0000', 'HIGH-VALUE': 'ÿ', 'HIGH-VALUES': 'ÿ', QUOTE: '"', QUOTES: '"' };
const NEGATE = { '=': '<>', '<>': '=', '>': '<=', '<=': '>', '<': '>=', '>=': '<' };
const FLIP = { '=': '=', '<>': '<>', '>': '<', '<': '>', '>=': '<=', '<=': '>=' };
const RESTRICTING_OPS = new Set(['>', '<', '>=', '<=']);

// A condition as a tree of AND, OR and NOT over atoms. It reads what COBOL writes - class and sign
// tests, relations with their words, condition-names, parentheses, and the abbreviated forms where a
// relation's subject or operator is carried to the next one: X = 'A' OR 'B', X > 1 AND < 9.
export function parseCondition(toks, resolve) {
  let i = 0;
  let lastSubject = null;
  let lastOp = null;
  const peek = () => toks[i];
  const operand = () => {
    // One operand: an identifier with its qualifiers and subscripts, a literal, a figurative
    // constant, or an arithmetic expression, which constrains nothing and is kept opaque.
    const start = i;
    let depth = 0;
    while (i < toks.length) {
      const t = toks[i];
      if (t.t === 'sep') { depth += t.v === '(' ? 1 : -1; if (depth < 0) break; i++; continue; }
      if (depth > 0) { i++; continue; }
      if (t.t === 'op' && RELOP[t.v]) break;
      if (t.t === 'word' && ['AND', 'OR', 'IS', 'NOT', 'GREATER', 'LESS', 'EQUAL', 'EQUALS', 'THAN', 'TO', 'THEN'].includes(t.u)) break;
      if (t.t === 'word' && (CLASS.has(t.u) || SIGN.has(t.u)) && i > start) break;
      i++;
    }
    return toks.slice(start, i);
  };
  const relop = () => {
    // [NOT] GREATER THAN [OR EQUAL TO] | LESS ... | EQUAL TO | symbols. Returns the operator with NOT folded in.
    let neg = false;
    if (WORD(peek(), 'NOT')) { neg = true; i++; }
    const t = peek();
    let op = null;
    if (t && t.t === 'op' && RELOP[t.v]) { op = RELOP[t.v]; i++; }
    else if (WORD(t, 'GREATER') || WORD(t, 'LESS')) {
      const base = t.u === 'GREATER' ? '>' : '<';
      i++;
      if (WORD(peek(), 'THAN')) i++;
      if (WORD(peek(), 'OR') && WORD(toks[i + 1], 'EQUAL')) { i += 2; if (WORD(peek(), 'TO')) i++; op = `${base}=`; } else op = base;
    } else if (WORD(t, 'EQUAL') || WORD(t, 'EQUALS')) { i++; if (WORD(peek(), 'TO')) i++; op = '='; }
    if (!op) return null;
    return neg ? NEGATE[op] : op;
  };
  const simple = () => {
    if (WORD(peek(), 'NOT')) { i++; return { k: 'not', a: simple() }; }
    if (peek() && peek().t === 'sep' && peek().v === '(') {
      i++;
      const inner = or();
      if (peek() && peek().t === 'sep' && peek().v === ')') i++;
      return inner;
    }
    // An abbreviated relation carries the last subject, and the last operator if it has none.
    const save = i;
    const op0 = relop();
    if (op0 && lastSubject) {
      const obj = operand();
      lastOp = op0;
      return { k: 'rel', left: lastSubject, op: op0, right: obj };
    }
    i = save;
    const left = operand();
    if (!left.length) { i++; return { k: 'opaque' }; }
    if (WORD(peek(), 'IS')) i++;
    let neg = false;
    if (WORD(peek(), 'NOT') && toks[i + 1] && toks[i + 1].t === 'word' && (CLASS.has(toks[i + 1].u) || SIGN.has(toks[i + 1].u))) { neg = true; i++; }
    const t = peek();
    if (t && t.t === 'word' && CLASS.has(t.u)) { i++; lastSubject = null; return wrap(neg, { k: 'class', subject: left, cls: t.u }); }
    if (t && t.t === 'word' && SIGN.has(t.u)) { i++; lastSubject = null; return wrap(neg, { k: 'sign', subject: left, sign: t.u.startsWith('ZERO') ? 'ZERO' : t.u }); }
    const op = relop();
    if (op) {
      const right = operand();
      lastSubject = left;
      lastOp = op;
      return { k: 'rel', left, op, right };
    }
    // Neither a relation nor a class test: a condition-name, or an operand standing alone after
    // an abbreviated connective, which takes the last subject and operator.
    if (lastSubject && lastOp && !(left.length === 1 && resolve(left[0]) && resolve(left[0]).level === 88)) {
      return { k: 'rel', left: lastSubject, op: lastOp, right: left };
    }
    lastSubject = null;
    return { k: 'cond', subject: left };
  };
  const wrap = (neg, a) => (neg ? { k: 'not', a } : a);
  const and = () => {
    let a = simple();
    while (WORD(peek(), 'AND')) { i++; a = { k: 'and', a, b: simple() }; }
    return a;
  };
  const or = () => {
    let a = and();
    while (WORD(peek(), 'OR')) { i++; a = { k: 'or', a, b: and() }; }
    return a;
  };
  const tree = or();
  return i < toks.length ? { k: 'and', a: tree, b: { k: 'opaque' } } : tree;
}

// ---- the program -------------------------------------------------------------------------------

// `resolve(token)` is the caller's name resolution, which knows qualifiers and index names. It
// returns an item, an index name as { index: NAME }, or null. `extra(test)`, if given, names facts
// of the caller's own that a test's outcomes establish - { true: key, false: key } - and they hold
// from there on, since nothing this module knows of undoes them. Their bits come back in `extraFacts`.
export function buildControl(prog, resolve, { extra = null } = {}) {
  if (!prog.proc) return null;
  const { tokens, from, to } = prog.proc;
  const stmtAt = new Map();
  for (const st of prog.statements) if (st.at != null && st.verb !== 'WHEN') stmtAt.set(st.at, st);
  const labelAt = new Map();
  for (const l of prog.labels) if (l.at != null) labelAt.set(l.at, l);
  const labelNames = new Set(prog.labels.map((l) => l.name));
  const extraEntries = new Set();

  // ---- statements into a tree ----
  let k = from;
  const isWord = (at, u) => WORD(tokens[at], u);
  const condEnd = (start, end) => {
    for (let j = start; j < end; j++) if (isWord(j, 'NEXT') && isWord(j + 1, 'SENTENCE')) return j;
    return end;
  };
  function parseList(stops, phraseStop = false) {
    const out = [];
    while (k < to) {
      const t = tokens[k];
      if (t.t === 'period' || labelAt.has(k)) break;
      if (t.t === 'exec') { out.push(execNode(t)); k++; continue; }
      if (t.t !== 'word') { k++; continue; }
      if (stops.has(t.u)) break;
      if (t.u === 'NEXT' && isWord(k + 1, 'SENTENCE')) { out.push({ k: 'next-sentence' }); k += 2; continue; }
      const st = stmtAt.get(k);
      if (!st) { k++; continue; }
      const node = parseStatement(st, stops);
      out.push(node);
      if (phraseStop && node.opensPhrase) break;
    }
    return out;
  }
  function execNode(e) {
    if (e.kind === 'CICS') {
      const words = e.toks.filter((x) => x.t === 'word').map((x) => x.u);
      if (['RETURN', 'XCTL', 'ABEND'].includes(words[0])) return { k: 'stop', e };
      if (words[0] === 'HANDLE' || words[0] === 'PUSH') for (const w of words) if (labelNames.has(w)) extraEntries.add(w);
    }
    return { k: 'exec', e };
  }
  function parseStatement(st, stops) {
    const seg = tokens.slice(st.at + 1, st.end);
    switch (st.verb) {
      case 'IF': {
        const ce = condEnd(st.at + 1, st.end);
        const cond = tokens.slice(st.at + 1, ce);
        k = ce;
        if (isWord(k, 'THEN')) k++;
        const thenList = parseList(new Set([...stops, 'ELSE', 'END-IF']));
        let elseList = [];
        if (isWord(k, 'ELSE')) { k++; elseList = parseList(new Set([...stops, 'END-IF'])); }
        if (isWord(k, 'END-IF')) k++;
        return { k: 'if', st, cond, then: thenList, else: elseList };
      }
      case 'EVALUATE': {
        const subjects = tokens.slice(st.at + 1, st.end);
        k = st.end;
        const groups = [];
        const inner = new Set([...stops, 'WHEN', 'END-EVALUATE']);
        while (isWord(k, 'WHEN')) {
          const g = { conds: [], other: false, body: [], at: tokens[k] };
          while (isWord(k, 'WHEN')) {
            const e = condEnd(k + 1, segmentEnd(tokens, k, to));
            const c = tokens.slice(k + 1, e);
            if (c.length === 1 && c[0].u === 'OTHER') g.other = true; else g.conds.push(c);
            k = e;
          }
          g.body = parseList(inner);
          groups.push(g);
        }
        if (isWord(k, 'END-EVALUATE')) k++;
        return { k: 'evaluate', st, subjects, groups };
      }
      case 'SEARCH': {
        k = st.end;
        const inner = new Set([...stops, 'WHEN', 'END-SEARCH']);
        const atEnd = seg.some((x) => WORD(x, 'END')) ? parseList(inner) : null;
        const whens = [];
        while (isWord(k, 'WHEN')) {
          const e = condEnd(k + 1, segmentEnd(tokens, k, to));
          const cond = tokens.slice(k + 1, e);
          const at = tokens[k];
          k = e;
          whens.push({ cond, at, body: parseList(inner) });
        }
        if (isWord(k, 'END-SEARCH')) k++;
        return { k: 'search', st, atEnd, whens };
      }
      case 'PERFORM': {
        k = st.end;
        const first = seg[0];
        const loop = seg.some((x) => WORD(x, 'VARYING')) ? 'varying' : seg.some((x) => WORD(x, 'UNTIL')) ? 'until' : seg.some((x) => WORD(x, 'TIMES')) ? 'times' : null;
        const testAfter = seg.some((x, i) => WORD(x, 'AFTER') && i > 0 && WORD(seg[i - 1], 'TEST'));
        if (first && first.t === 'word' && labelNames.has(first.u)) {
          const thru = seg[1] && (WORD(seg[1], 'THRU') || WORD(seg[1], 'THROUGH')) && seg[2] ? seg[2].u : null;
          return { k: 'perform', st, target: first.u, thru, loop, testAfter };
        }
        const body = parseList(new Set([...stops, 'END-PERFORM']));
        if (isWord(k, 'END-PERFORM')) k++;
        return { k: 'inline', st, body, loop, testAfter };
      }
      case 'GO': {
        k = st.end;
        const words = seg.filter((x) => x.t === 'word' && x.u !== 'TO');
        const dep = words.findIndex((w) => w.u === 'DEPENDING');
        const targets = (dep >= 0 ? words.slice(0, dep) : words).map((w) => w.u).filter((n) => labelNames.has(n));
        return { k: 'goto', st, targets, depending: dep >= 0 };
      }
      case 'GOBACK': k = st.end; return { k: 'stop', st };
      case 'STOP': k = st.end; return WORD(seg[0], 'RUN') ? { k: 'stop', st } : { k: 'stmt', st };
      case 'EXIT': {
        k = st.end;
        const next = seg[0];
        if (WORD(next, 'PROGRAM') || WORD(next, 'METHOD') || WORD(next, 'FUNCTION')) return { k: 'stop', st };
        if (WORD(next, 'PARAGRAPH')) return { k: 'exit-para', st };
        if (WORD(next, 'SECTION')) return { k: 'exit-section', st };
        if (WORD(next, 'PERFORM')) return { k: 'exit-perform', st, cycle: WORD(seg[1], 'CYCLE') };
        return { k: 'stmt', st };
      }
      default: {
        k = st.end;
        if (st.verb === 'CALL' && seg[0] && seg[0].t === 'lit' && ABEND_ROUTINE.test(String(seg[0].v).trim())) return { k: 'stop', st };
        if (PHRASED.has(st.verb) && opensPhrase(seg)) {
          const endWord = `END-${st.verb}`;
          const inner = new Set([...stops, endWord]);
          const bodies = [];
          for (;;) {
            const body = parseList(inner, true);
            bodies.push(body);
            const last = body[body.length - 1];
            if (!(last && last.opensPhrase) || k >= to || tokens[k].t === 'period') break;
          }
          if (isWord(k, endWord)) k++;
          return { k: 'phrased', st, bodies };
        }
        const node = { k: 'stmt', st };
        if (opensPhrase(seg)) node.opensPhrase = true;
        return node;
      }
    }
  }

  const paras = [];
  let cur = { name: null, kind: null, section: null, sentences: [] };
  paras.push(cur);
  let section = null;
  let inDeclaratives = false;
  while (k < to) {
    const t = tokens[k];
    if (labelAt.has(k)) {
      const l = labelAt.get(k);
      if (l.kind === 'S') section = l.name;
      cur = { name: l.name, kind: l.kind, section: l.kind === 'S' ? l.name : section, sentences: [], declarative: inDeclaratives };
      if (inDeclaratives) extraEntries.add(l.name);
      paras.push(cur);
      k++;
      while (k < to && tokens[k].t !== 'period') k++;
      k++;
      continue;
    }
    if (t.t === 'period') { k++; continue; }
    if (WORD(t, 'DECLARATIVES')) { inDeclaratives = true; k++; continue; }
    if (WORD(t, 'END') && isWord(k + 1, 'DECLARATIVES')) { inDeclaratives = false; k += 2; continue; }
    const before = k;
    cur.sentences.push(parseList(new Set()));
    if (k === before) k++;
  }

  // ---- the tree into a graph ----
  const nodes = [];
  const add = (kind, extra = {}) => { const n = { id: nodes.length, kind, succ: [], ...extra }; nodes.push(n); return n.id; };
  const nodeOf = new Map();
  const EXIT = add('exit');
  const entryOf = new Map();
  const endOf = new Map();
  for (const p of paras) { p.entry = add('label', { name: p.name }); p.end = add('para-end', { name: p.name }); if (p.name && !entryOf.has(p.name)) { entryOf.set(p.name, p.entry); endOf.set(p.name, p.end); } }
  // A section ends where its last paragraph ends.
  const sectionEnd = new Map();
  for (const p of paras) if (p.section) sectionEnd.set(p.section, p.end);
  const tests = [];

  function lowerList(list, next, ctx) {
    let cont = next;
    for (let i = list.length - 1; i >= 0; i--) cont = lower(list[i], cont, ctx);
    return cont;
  }
  function outcome(test, value, next) { return add('outcome', { test, value, succ: [next] }); }
  function lower(n, next, ctx) {
    switch (n.k) {
      case 'stmt': { const id = add('stmt', { st: n.st, succ: [next] }); nodeOf.set(n.st, id); return id; }
      case 'exec': { const id = add('exec', { e: n.e, succ: [next] }); nodeOf.set(n.e, id); return id; }
      case 'stop': { const id = add('stop', { st: n.st, e: n.e, succ: [EXIT] }); nodeOf.set(n.st || n.e, id); return id; }
      case 'next-sentence': return add('nop', { succ: [ctx.sentenceEnd] });
      case 'exit-para': { const id = add('stmt', { st: n.st, succ: [ctx.paraEnd] }); nodeOf.set(n.st, id); return id; }
      case 'exit-section': { const id = add('stmt', { st: n.st, succ: [ctx.sectionEnd || ctx.paraEnd] }); nodeOf.set(n.st, id); return id; }
      case 'exit-perform': { const id = add('stmt', { st: n.st, succ: [n.cycle ? (ctx.loopTest ?? next) : (ctx.loopExit ?? next)] }); nodeOf.set(n.st, id); return id; }
      case 'if': {
        const t = add('test', { st: n.st, cond: n.cond });
        tests.push(t);
        nodes[t].succ = [outcome(t, true, lowerList(n.then, next, ctx)), outcome(t, false, lowerList(n.else, next, ctx))];
        nodeOf.set(n.st, t);
        return t;
      }
      case 'evaluate': {
        let fallthrough = next;
        const other = n.groups.find((g) => g.other);
        if (other) fallthrough = lowerList(other.body, next, ctx);
        for (let g = n.groups.length - 1; g >= 0; g--) {
          const grp = n.groups[g];
          if (grp.other) continue;
          const t = add('test', { st: n.st, evaluate: { subjects: n.subjects, conds: grp.conds }, at: grp.at });
          tests.push(t);
          nodes[t].succ = [outcome(t, true, lowerList(grp.body, next, ctx)), outcome(t, false, fallthrough)];
          fallthrough = t;
        }
        // The EVALUATE statement reads its subjects and writes nothing; its node is the first test.
        nodeOf.set(n.st, fallthrough);
        return fallthrough;
      }
      case 'search': {
        let fallthrough = n.atEnd ? lowerList(n.atEnd, next, ctx) : next;
        for (let w = n.whens.length - 1; w >= 0; w--) {
          const t = add('test', { st: n.st, cond: n.whens[w].cond, at: n.whens[w].at });
          tests.push(t);
          nodes[t].succ = [outcome(t, true, lowerList(n.whens[w].body, next, ctx)), outcome(t, false, fallthrough)];
          fallthrough = t;
        }
        // SEARCH moves its index before it tests anything.
        const id = add('stmt', { st: n.st, succ: [fallthrough] });
        nodeOf.set(n.st, id);
        return id;
      }
      case 'perform': case 'inline': {
        // A loop tests before its body unless it says WITH TEST AFTER. The UNTIL condition is true at
        // the exit, which is what makes PERFORM GET-INPUT UNTIL INPUT-VALID a check.
        const loops = n.st.loops || [];
        const cond = loops.length ? loops[0].until : null;
        const head = add('stmt', { st: n.st });
        nodeOf.set(n.st, head);
        if (!n.loop) {
          const body = n.k === 'perform' ? add('call', { st: n.st, range: rangeOf(n.target, n.thru), succ: [next] }) : lowerList(n.body, next, ctx);
          nodes[head].succ = [body];
          return head;
        }
        const t = add('test', { st: n.st, cond, loop: true });
        if (cond) tests.push(t);
        const step = add('step', { st: n.st, succ: [t] });
        const loopCtx = { ...ctx, loopExit: next, loopTest: step };
        const body = n.k === 'perform' ? add('call', { st: n.st, range: rangeOf(n.target, n.thru), succ: [step] }) : lowerList(n.body, step, loopCtx);
        nodes[t].succ = [outcome(t, true, next), outcome(t, false, body)];
        nodes[head].succ = [n.testAfter ? body : t];
        return head;
      }
      case 'goto': {
        const targets = n.targets.map((name) => entryOf.get(name)).filter((x) => x != null);
        const all = !n.targets.length ? paras.map((p) => p.entry) : targets;
        const id = add('goto', { st: n.st, succ: n.depending ? [...all, next] : all.length ? all : [EXIT] });
        nodeOf.set(n.st, id);
        return id;
      }
      case 'phrased': {
        const branch = add('branch', { succ: [...n.bodies.map((b) => lowerList(b, next, ctx)), next] });
        const id = add('stmt', { st: n.st, succ: [branch] });
        nodeOf.set(n.st, id);
        return id;
      }
      default: return next;
    }
  }
  const ranges = new Map();
  function rangeOf(target, thru) {
    const key = `${target}|${thru || ''}`;
    let r = ranges.get(key);
    if (!r) {
      const last = thru || target;
      const lastPara = paras.find((p) => p.name === last);
      const end = lastPara && lastPara.kind === 'S' ? sectionEnd.get(last) : endOf.get(last);
      r = { key, entry: entryOf.get(target), end: end ?? null };
      ranges.set(key, r);
    }
    return r;
  }
  paras.forEach((p, i) => {
    const ctx = { paraEnd: p.end, sectionEnd: p.section ? sectionEnd.get(p.section) : null };
    let cont = p.end;
    for (let s = p.sentences.length - 1; s >= 0; s--) cont = lowerList(p.sentences[s], cont, { ...ctx, sentenceEnd: cont });
    nodes[p.entry].succ = [cont];
    nodes[p.end].succ = [i + 1 < paras.length ? paras[i + 1].entry : EXIT];
  });

  // ---- checks ----
  const itemsInRecord = (item) => { let top = item; while (top.parent) top = top.parent; return top; };
  const fieldKey = (f) => (f.index ? `IX:${f.index}` : f);
  const constValue = (toks) => {
    if (toks.length === 3 && WORD(toks[0], 'LENGTH') && WORD(toks[1], 'OF')) {
      const it = resolve(toks[2]);
      return it && !it.index && it.size != null ? String(it.size) : null;
    }
    if (toks.length !== 1) return null;
    const t = toks[0];
    if (t.t === 'lit') return String(t.v).trimEnd();
    if (t.t === 'num' || (t.t === 'word' && /^[+-]?\d+(\.\d+)?$/.test(t.v))) return String(Number(t.v));
    if (t.t === 'word' && FIGURATIVE[t.u] != null) return FIGURATIVE[t.u];
    const it = resolve(t);
    // A level-78 constant, or a field with a VALUE that no statement writes, stands for its value.
    if (it && !it.index && (it.level === 78 || it.constant || (!it.receiving && it.values && it.values.length === 1))) {
      const v = it.values[0];
      if (v && v.t === 'lit') return String(v.v).trimEnd();
      if (v && (v.t === 'num' || /^[+-]?\d+(\.\d+)?$/.test(v.v))) return String(Number(v.v));
    }
    return null;
  };
  const fieldOf = (toks) => {
    // The subject of a test: an identifier and its qualifiers, nothing else. A subscripted element,
    // a reference modification or an expression says something about part of a field, or none.
    if (!toks.length || toks.some((t) => t.t !== 'word')) return null;
    const f = resolve(toks[0]);
    return f && f.level !== 88 ? f : null;
  };
  const numberOf = (v) => (v != null && /^[+-]?\d+(\.\d+)?$/.test(v) ? Number(v) : null);
  const relCons = (op, v) => {
    if (v == null) return null;
    if (op === '=') return { set: new Set([v]) };
    const n = numberOf(v);
    if (n == null) return null;
    if (op === '>') return { lo: n, loInc: false };
    if (op === '>=') return { lo: n, loInc: true };
    if (op === '<') return { hi: n, hiInc: false };
    if (op === '<=') return { hi: n, hiInc: true };
    return null;
  };
  const condValues = (item) => {
    const vals = [];
    let range = null;
    const v = item.values || [];
    for (let i = 0; i < v.length; i++) {
      const t = v[i];
      if (t.t === 'word' && (t.u === 'THRU' || t.u === 'THROUGH')) continue;
      const val = t.t === 'lit' ? String(t.v).trimEnd() : t.t === 'word' && FIGURATIVE[t.u] != null ? FIGURATIVE[t.u] : String(t.v);
      if (v[i + 1] && v[i + 1].t === 'word' && (v[i + 1].u === 'THRU' || v[i + 1].u === 'THROUGH') && v[i + 2]) {
        const lo = numberOf(val), hi = numberOf(String(v[i + 2].t === 'lit' ? v[i + 2].v : v[i + 2].v));
        range = lo != null && hi != null ? join(range || { lo, loInc: true, hi, hiInc: true }, { lo, loInc: true, hi, hiInc: true }) : { opaque: true };
        i += 2;
        continue;
      }
      vals.push(val);
    }
    if (range && range.opaque) return null;
    if (range && !vals.length) return range;
    if (range) return join(range, { set: new Set(vals) }) || null;
    return vals.length ? { set: new Set(vals) } : null;
  };
  // What a condition says each field holds when it is `outcome`, and which fields it tests.
  function consOf(tree, outcome) {
    switch (tree.k) {
      case 'not': return consOf(tree.a, !outcome);
      case 'and': return outcome ? meetMaps(consOf(tree.a, true), consOf(tree.b, true)) : joinMaps(consOf(tree.a, false), consOf(tree.b, false));
      case 'or': return outcome ? joinMaps(consOf(tree.a, true), consOf(tree.b, true)) : meetMaps(consOf(tree.a, false), consOf(tree.b, false));
      case 'class': {
        const f = fieldOf(tree.subject);
        if (!f || !outcome) return new Map();
        return new Map([[fieldKey(f), tree.cls === 'NUMERIC' ? { numeric: true } : { alpha: true }]]);
      }
      case 'sign': {
        const f = fieldOf(tree.subject);
        if (!f) return new Map();
        const c = tree.sign === 'ZERO' ? (outcome ? { set: new Set(['0']) } : null)
          : tree.sign === 'POSITIVE' ? (outcome ? { lo: 0, loInc: false } : { hi: 0, hiInc: true })
            : (outcome ? { hi: 0, hiInc: false } : { lo: 0, loInc: true });
        return c ? new Map([[fieldKey(f), c]]) : new Map();
      }
      case 'rel': {
        let f = fieldOf(tree.left);
        let op = tree.op;
        let v = constValue(tree.right);
        if (!f || v == null) {
          const g = fieldOf(tree.right);
          const w = constValue(tree.left);
          if (g && w != null) { f = g; v = w; op = FLIP[op]; } else return new Map();
        }
        const c = relCons(outcome ? op : NEGATE[op], v);
        return c ? new Map([[fieldKey(f), c]]) : new Map();
      }
      case 'cond': {
        if (tree.subject.length !== 1) return new Map();
        const c = resolve(tree.subject[0]);
        if (!c || c.level !== 88 || !c.parent || !outcome) return new Map();
        const cons = condValues(c);
        return cons ? new Map([[fieldKey(c.parent), cons]]) : new Map();
      }
      default: return new Map();
    }
  }
  function meetMaps(a, b) {
    const out = new Map(a);
    for (const [f, c] of b) out.set(f, meet(out.get(f), c));
    return out;
  }
  function joinMaps(a, b) {
    const out = new Map();
    for (const [f, c] of a) if (b.has(f)) { const j = join(c, b.get(f)); if (j) out.set(f, j); }
    return out;
  }
  // The fields a condition restricts rather than compares: class and sign tests, ordering relations
  // and condition-names. Equality chooses a branch; it is credited only where it pins the value.
  function tested(tree, out = new Map()) {
    switch (tree.k) {
      case 'not': return tested(tree.a, out);
      case 'and': case 'or': tested(tree.a, out); return tested(tree.b, out);
      case 'class': case 'sign': { const f = fieldOf(tree.subject); if (f) out.set(fieldKey(f), f); return out; }
      case 'rel': {
        if (!RESTRICTING_OPS.has(tree.op)) return out;
        for (const side of [tree.left, tree.right]) { const f = fieldOf(side); if (f) out.set(fieldKey(f), f); }
        return out;
      }
      case 'cond': {
        const c = tree.subject.length === 1 ? resolve(tree.subject[0]) : null;
        if (c && c.level === 88 && c.parent) out.set(fieldKey(c.parent), c.parent);
        return out;
      }
      default: return out;
    }
  }
  const fields = new Map();
  const noteField = (key, f) => { if (!fields.has(key)) fields.set(key, f); };
  // An EVALUATE group is its subjects matched against each WHEN's objects, any of them.
  function evaluateTree(subjects, conds) {
    const also = subjects.some((t) => WORD(t, 'ALSO'));
    if (also) return { k: 'opaque' };
    const isTrue = subjects.length === 1 && (WORD(subjects[0], 'TRUE') || WORD(subjects[0], 'FALSE'));
    let tree = null;
    for (const c of conds) {
      let t;
      if (isTrue) {
        t = parseCondition(c, resolve);
        if (WORD(subjects[0], 'FALSE')) t = { k: 'not', a: t };
      } else if (c.some((x) => WORD(x, 'ANY'))) t = { k: 'opaque' };
      else {
        const neg = WORD(c[0], 'NOT');
        const body = neg ? c.slice(1) : c;
        const thru = body.findIndex((x) => WORD(x, 'THRU') || WORD(x, 'THROUGH'));
        t = thru > 0
          ? { k: 'and', a: { k: 'rel', left: subjects, op: '>=', right: body.slice(0, thru) }, b: { k: 'rel', left: subjects, op: '<=', right: body.slice(thru + 1) } }
          : { k: 'rel', left: subjects, op: '=', right: body };
        if (neg) t = { k: 'not', a: t };
      }
      tree = tree ? { k: 'or', a: tree, b: t } : t;
    }
    return tree || { k: 'opaque' };
  }
  const checks = [];
  for (const id of tests) {
    const mine = [];
    const n = nodes[id];
    const tree = n.evaluate ? evaluateTree(n.evaluate.subjects, n.evaluate.conds) : n.cond ? parseCondition(n.cond, resolve) : { k: 'opaque' };
    const whenTrue = consOf(tree, true);
    const whenFalse = consOf(tree, false);
    const restricts = tested(tree);
    const keys = new Set([...whenTrue.keys(), ...whenFalse.keys(), ...restricts.keys()]);
    n.gen = { true: [], false: [] };
    const where = n.at || n.st;
    for (const key of keys) {
      const field = restricts.get(key) || (typeof key === 'string' ? { index: key.slice(3) } : key);
      noteField(key, field);
      const c = { id: checks.length, key, field, file: where.file, line: where.line, tCons: whenTrue.get(key) || null, fCons: whenFalse.get(key) || null, restricts: restricts.has(key) };
      checks.push(c);
      mine.push(c);
    }
    n.checks = mine;
  }
  // A MOVE of a constant, or a SET of a condition-name TO TRUE, leaves the field holding exactly that
  // value until something writes it again: a fact like a check's outcome, made by a statement. It is
  // what makes a length clamped to LENGTH OF a field a bound, and a field refilled with a literal
  // before its use hold the literal rather than whatever reached it before. An element of a table is
  // left out: the fact would be about one element, and the field stands for all of them.
  const inTable = (it) => { for (let a = it; a; a = a.parent) if ((a.occurs || 1) > 1) return true; return false; };
  const assigns = [];
  for (const n of nodes) {
    if (n.kind !== 'stmt' || !n.st || n.st.at == null) continue;
    const st = n.st;
    const seg = tokens.slice(st.at + 1, st.end);
    let value = null;
    let targets = [];
    if (st.verb === 'MOVE') {
      const to = seg.findIndex((t) => WORD(t, 'TO'));
      if (to < 0) continue;
      const src = seg.slice(0, to);
      if (src.length === 3 && WORD(src[0], 'LENGTH') && WORD(src[1], 'OF')) {
        const it = resolve(src[2]);
        value = it && !it.index && it.size != null ? String(it.size) : null;
      } else value = constValue(src);
      targets = (st.targets || []).map((t) => resolve(t)).filter((it) => it && !it.index && it.level !== 88 && !inTable(it));
    } else if (st.verb === 'SET' && seg.length >= 3 && WORD(seg[seg.length - 1], 'TRUE') && WORD(seg[seg.length - 2], 'TO')) {
      for (const t of st.targets || []) {
        const c = resolve(t);
        if (!c || c.level !== 88 || !c.parent || inTable(c.parent)) continue;
        const v = (c.values || [])[0];
        const val = v && v.t === 'lit' ? String(v.v).trimEnd() : v && (v.t === 'num' || /^\d+$/.test(v.v)) ? String(Number(v.v)) : null;
        if (val != null) assigns.push({ n, field: c.parent, value: val });
      }
      continue;
    }
    if (value == null) continue;
    for (const field of targets) assigns.push({ n, field, value });
  }
  for (const a of assigns) {
    const key = fieldKey(a.field);
    noteField(key, a.field);
    a.c = { id: checks.length, key, field: a.field, file: a.n.st.file, line: a.n.st.line, tCons: { set: new Set([a.value]) }, fCons: null, restricts: false, assigned: true };
    checks.push(a.c);
  }
  // Fact numbers: for each check, `x` that it ran (only a restricting one), `t` and `f` that it came
  // out true or false with something to say about its field.
  let nFacts = 0;
  for (const c of checks) {
    c.x = c.restricts ? nFacts++ : null;
    c.t = c.tCons ? nFacts++ : null;
    c.f = c.fCons ? nFacts++ : null;
  }
  for (const id of tests) {
    const n = nodes[id];
    for (const c of n.checks) {
      if (c.x != null) { n.gen.true.push(c.x); n.gen.false.push(c.x); }
      if (c.t != null) n.gen.true.push(c.t);
      if (c.f != null) n.gen.false.push(c.f);
    }
  }
  // A constant also makes true every outcome it satisfies of a check on the same field, so a length
  // clamped to 80 on one branch and tested not above 80 on the other holds the test's outcome on
  // both, and the join after them keeps it.
  const checksOf = new Map();
  for (const c of checks) if (!c.assigned) { if (!checksOf.has(c.key)) checksOf.set(c.key, []); checksOf.get(c.key).push(c); }
  // Each assignment of a constant settles every check on its field, so the cost is their product
  // field by field: a generated program that sets and tests the same counters tens of thousands of
  // times each ran out of heap here.
  let settled = 0;
  for (const a of assigns) settled += (checksOf.get(a.c.key) || []).length;
  if (settled > SETTLE_BUDGET) throw new Error(`${settled} check outcomes settled by assignment is past the ordering budget`);
  for (const a of assigns) {
    const gen = (a.n.genStmt ||= []);
    gen.push(a.c.t);
    for (const c of checksOf.get(a.c.key) || []) {
      if (c.t != null && satisfies(c.tCons, a.value)) gen.push(c.t);
      if (c.f != null && satisfies(c.fCons, a.value)) gen.push(c.f);
    }
  }
  const extraFacts = new Map();
  if (extra) {
    for (const id of tests) {
      const n = nodes[id];
      const said = extra({ cond: n.cond || null, evaluate: n.evaluate || null, st: n.st, at: n.at || n.st });
      for (const outcome of ['true', 'false']) {
        const key = said && said[outcome];
        if (!key) continue;
        if (!extraFacts.has(key)) extraFacts.set(key, nFacts++);
        n.gen[outcome].push(extraFacts.get(key));
      }
    }
  }
  if (!nFacts) return { nodeOf, checks: [], words: 0, facts: new Map(), nodes: nodes.length, extraFacts };
  const words = Math.ceil(nFacts / 32);
  // Every node holds a bitset of every fact, several times over, so the cost is their product. A
  // 426,000-line generated program passed an 8 GB heap here, and running out of heap cannot be
  // caught. Past the budget the program is left unordered, which callers already handle.
  if (nodes.length * words * 4 > FACT_BUDGET_BYTES) throw new Error(`${nodes.length} statements by ${nFacts} facts is past the ordering budget`);

  // What a write kills: every fact about a field whose bytes it overlaps.
  const factsOfKey = new Map();
  for (const c of checks) {
    const list = factsOfKey.get(c.key) || [];
    for (const f of [c.x, c.t, c.f]) if (f != null) list.push(f);
    factsOfKey.set(c.key, list);
  }
  const overlaps = (w, f) => {
    if (w === f) return true;
    if (w.index || f.index) return w.index && f.index && w.index === f.index;
    if (itemsInRecord(w) !== itemsInRecord(f)) return false;
    if (w.offset == null || f.offset == null || w.size == null || f.size == null) return true;
    const wEnd = w.offset + (w.contributes || w.size);
    const fEnd = f.offset + (f.contributes || f.size);
    return w.offset < fEnd && f.offset < wEnd;
  };
  const killCache = new Map();
  const killOf = (w) => {
    if (!w) return null;
    let bits = killCache.get(w);
    if (bits !== undefined) return bits;
    bits = null;
    for (const [key, list] of factsOfKey) {
      const f = fields.get(key);
      if (!f || !overlaps(w, f)) continue;
      bits ||= new Uint32Array(words);
      for (const x of list) bits[x >>> 5] |= 1 << (x & 31);
    }
    killCache.set(w, bits);
    return bits;
  };
  const writtenBy = (n) => {
    const out = [];
    const add = (tok) => { const f = tok ? resolve(tok) : null; if (f) out.push(f.level === 88 && f.parent ? f.parent : f); };
    if (n.st) {
      for (const t of n.st.targets || []) add(t);
      if (n.st.verb === 'CALL' || n.st.verb === 'READ' || n.st.verb === 'RETURN') {
        // A callee may write what it is passed by reference, and a READ fills the file's records.
        for (const t of n.st.sources || []) {
          const f = resolve(t);
          if (!f) continue;
          if (f.records) for (const r of f.records) out.push(r);
          else if (n.st.verb === 'CALL') out.push(f);
        }
      }
    }
    if (n.e && n.e.kind === 'SQL') {
      // A statement fills the host variables of its INTO list and reads the rest.
      const toks = n.e.toks;
      const into = toks.findIndex((t) => WORD(t, 'INTO'));
      if (into >= 0) {
        for (let i = into + 1; i < toks.length && !WORD(toks[i], 'FROM'); i++) {
          if (toks[i].t === 'op' && toks[i].v === ':' && toks[i + 1]) add(toks[i + 1]);
        }
      }
    } else if (n.e) {
      // A command may fill what any option is given directly, except what it sends FROM. A name
      // inside that argument's own parentheses - a subscript, a reference modification - is read.
      let depth = 0;
      let option = null;
      for (let i = 0; i < n.e.toks.length; i++) {
        const t = n.e.toks[i];
        if (t.t === 'sep') { depth += t.v === '(' ? 1 : -1; continue; }
        if (depth === 0) { option = t.t === 'word' ? t.u : option; continue; }
        if (depth === 1 && t.t === 'word' && option !== 'FROM') add(t);
      }
    }
    return out;
  };
  for (const n of nodes) {
    if (n.kind !== 'stmt' && n.kind !== 'exec' && n.kind !== 'step' && n.kind !== 'call') continue;
    let bits = null;
    for (const w of writtenBy(n)) {
      const k2 = killOf(w);
      if (!k2) continue;
      bits ||= new Uint32Array(words);
      for (let i = 0; i < words; i++) bits[i] |= k2[i];
    }
    if (bits) n.kill = bits;
  }

  // ---- must-analysis ----
  const ZERO = new Uint32Array(words);
  const ONES = new Uint32Array(words).fill(0xffffffff);
  const genBits = (list) => { const b = new Uint32Array(words); for (const x of list) b[x >>> 5] |= 1 << (x & 31); return b; };
  for (const id of tests) { const n = nodes[id]; n.genT = genBits(n.gen.true); n.genF = genBits(n.gen.false); }
  for (const n of nodes) if (n.genStmt) n.genS = genBits(n.genStmt);
  const summaries = new Map();
  // Reverse postorder from every way in, so a forward analysis visits a node after what precedes it
  // and a join is revisited only when a loop brings something new.
  const order = new Int32Array(nodes.length).fill(-1);
  {
    const seen = new Uint8Array(nodes.length);
    const post = [];
    const roots = [paras[0].entry, ...[...extraEntries].map((n) => entryOf.get(n)).filter((x) => x != null),
      ...[...ranges.values()].map((r) => r.entry).filter((x) => x != null), ...paras.map((p) => p.entry)];
    for (const root of roots) {
      if (seen[root]) continue;
      const stack = [[root, 0]];
      seen[root] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const succ = nodes[top[0]].succ;
        if (top[1] < succ.length) {
          const s = succ[top[1]++];
          if (!seen[s]) { seen[s] = 1; stack.push([s, 0]); }
        } else { post.push(top[0]); stack.pop(); }
      }
    }
    for (let i = 0; i < post.length; i++) order[post[i]] = post.length - 1 - i;
  }
  const scratch = new Uint32Array(words);
  // What holds after a node, in a buffer reused by every call: the caller merges it into the next
  // node's facts before calling again. Null where the route ends here.
  const transfer = (n, input) => {
    let out = input;
    if (n.kind === 'outcome') {
      const g = n.value ? nodes[n.test].genT : nodes[n.test].genF;
      if (g) { for (let i = 0; i < words; i++) scratch[i] = input[i] | g[i]; out = scratch; }
    } else if (n.kind === 'call') {
      // A paragraph nobody can find may write anything. A range still being summarised has not
      // returned yet, which is the optimistic start a must-analysis iterates down from.
      if (n.range.entry == null || n.range.end == null) { scratch.fill(0); return scratch; }
      const s = summaries.get(n.range.key);
      if (!s || !s.top) return null;
      for (let i = 0; i < words; i++) scratch[i] = (input[i] & s.top[i]) | s.bot[i];
      out = scratch;
    }
    if (n.kill) {
      if (out === input) { for (let i = 0; i < words; i++) scratch[i] = input[i] & ~n.kill[i]; out = scratch; }
      else for (let i = 0; i < words; i++) out[i] &= ~n.kill[i];
    }
    // What the statement assigns holds after it, over whatever the write took away.
    if (n.genS) {
      if (out === input) { for (let i = 0; i < words; i++) scratch[i] = input[i] | n.genS[i]; out = scratch; }
      else for (let i = 0; i < words; i++) out[i] |= n.genS[i];
    }
    return out;
  };
  const same = (a, b) => { for (let i = 0; i < words; i++) if (a[i] !== b[i]) return false; return true; };
  const and = (a, b) => { const o = new Uint32Array(words); for (let i = 0; i < words; i++) o[i] = a[i] & b[i]; return o; };
  // Joins `out` into `into`, in place; true if anything was taken away.
  const meetInto = (into, out) => {
    let changed = false;
    // >>> 0: a bitwise AND is signed, the store is not, and bit 31 would read as always changed.
    for (let i = 0; i < words; i++) { const v = (into[i] & out[i]) >>> 0; if (v !== into[i]) { into[i] = v; changed = true; } }
    return changed;
  };
  // A binary heap of node ids by reverse postorder.
  const heap = [];
  const inHeap = new Uint8Array(nodes.length);
  const push = (id) => {
    if (inHeap[id]) return;
    inHeap[id] = 1;
    heap.push(id);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (order[heap[p]] <= order[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && order[heap[l]] < order[heap[m]]) m = l;
        if (r < heap.length && order[heap[r]] < order[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    inHeap[top] = 0;
    return top;
  };
  // Every route from `entry` that reaches `stopAt` or the program's end, meeting at joins. A call
  // whose range never returns ends the route, as a STOP RUN does. `calls` collects the ranges the
  // routes perform, for whoever needs to know what depends on what.
  function run(entry, input, stopAt, calls = null) {
    const IN = new Map();
    let exitOut = null;
    IN.set(entry, input.slice());
    push(entry);
    while (heap.length) {
      const id = pop();
      const n = nodes[id];
      if (calls && n.kind === 'call' && n.range.entry != null) calls.add(n.range.key);
      const out = transfer(n, IN.get(id));
      if (!out) continue;
      if (id === stopAt) { if (exitOut) meetInto(exitOut, out); else exitOut = out.slice(); continue; }
      for (const s of n.succ) {
        const cur = IN.get(s);
        if (!cur) { IN.set(s, out.slice()); push(s); } else if (meetInto(cur, out)) push(s);
      }
    }
    return { IN, exitOut };
  }

  // Summaries: what holds after a range, from all facts and from none. A range is summarised again
  // only when a range it performs changes. One still being computed has not returned, which is what
  // a recursive PERFORM does anyway.
  const performed = [...ranges.values()].filter((r) => r.entry != null && r.end != null);
  const callers = new Map();
  const pending = [...performed].sort((a, b) => order[b.entry] - order[a.entry]);
  const queued = new Set(pending.map((r) => r.key));
  for (let steps = 0; pending.length && steps < performed.length * 20; steps++) {
    const r = pending.shift();
    queued.delete(r.key);
    const calls = new Set();
    const top = run(r.entry, ONES, r.end, calls).exitOut;
    const bot = run(r.entry, ZERO, r.end).exitOut;
    for (const k of calls) { if (!callers.has(k)) callers.set(k, new Set()); callers.get(k).add(r); }
    const old = summaries.get(r.key);
    const nextS = top && bot ? { top, bot } : { top: null, bot: null };
    const moved = !old || (old.top === null) !== (nextS.top === null) || (nextS.top && (!same(old.top, nextS.top) || !same(old.bot, nextS.bot)));
    if (!moved) continue;
    summaries.set(r.key, nextS);
    for (const c of callers.get(r.key) || []) if (!queued.has(c.key)) { queued.add(c.key); pending.push(c); }
  }

  // Contexts: the program's own entry and every extra one enter with nothing; a range enters with
  // what holds at every PERFORM of it that some context reaches. A context runs again only when what
  // enters it shrinks.
  const results = new Map();
  const rangeIn = new Map();
  const byKey = new Map(performed.map((r) => [r.key, r]));
  const work = [{ key: `main:${paras[0].entry}`, entry: paras[0].entry, stopAt: null }];
  for (const name of extraEntries) if (entryOf.has(name)) work.push({ key: `main:${entryOf.get(name)}`, entry: entryOf.get(name), stopAt: null });
  const waiting = new Set(work.map((c) => c.key));
  for (let steps = 0; work.length && steps < (performed.length + work.length) * 50; steps++) {
    const c = work.shift();
    waiting.delete(c.key);
    const input = c.stopAt == null ? ZERO : rangeIn.get(c.key);
    const res = run(c.entry, input, c.stopAt);
    results.set(c.key, res.IN);
    for (const [id, bits] of res.IN) {
      const n = nodes[id];
      if (n.kind !== 'call' || !byKey.has(n.range.key)) continue;
      const had = rangeIn.get(n.range.key);
      let moved = false;
      if (!had) { rangeIn.set(n.range.key, bits.slice()); moved = true; } else moved = meetInto(had, bits);
      if (moved && !waiting.has(n.range.key)) {
        const r = byKey.get(n.range.key);
        waiting.add(r.key);
        work.push({ key: r.key, entry: r.entry, stopAt: r.end });
      }
    }
  }
  const facts = new Map();
  for (const IN of results.values()) {
    for (const [id, bits] of IN) {
      const had = facts.get(id);
      if (had) meetInto(had, bits); else facts.set(id, bits.slice());
    }
  }
  // Plain data, no closures: a closure over this scope would keep the program's tokens alive after
  // the caller has let the parse tree go. A statement no context reaches has no facts, and credits
  // nothing.
  return { nodeOf, checks, words, nodes: nodes.length, facts, extraFacts };
}

export const hasFact = (bits, x) => x != null && bits != null && (bits[x >>> 5] & (1 << (x & 31))) !== 0;

// What a node's checks say at a point, given the facts that hold there: 2 when the value it holds is
// safe for the sink, 1 when a check has run on every route to the point, 0 when neither. The check
// named is the one that decided it.
export function creditOf(checks, bits, sinkKind) {
  let tested = null;
  let cons = null;
  let consBy = null;
  for (const c of checks) {
    if (hasFact(bits, c.x) && !tested) tested = c;
    if (hasFact(bits, c.t)) { cons = meet(cons, c.tCons); consBy ||= c; }
    if (hasFact(bits, c.f)) { cons = meet(cons, c.fCons); consBy ||= c; }
  }
  if (cons && stops(cons, sinkKind)) return { level: 2, check: consBy };
  return tested ? { level: 1, check: tested } : { level: 0, check: null };
}
