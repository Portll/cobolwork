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
import { parser, attempt, candidates, leaves, storedRange } from './arith.mjs';

const WORD = (t, u) => t && t.t === 'word' && t.u === u;
const PHRASED = new Set(['READ', 'WRITE', 'REWRITE', 'DELETE', 'START', 'RETURN', 'CALL', 'COMPUTE', 'ADD', 'SUBTRACT',
  'MULTIPLY', 'DIVIDE', 'STRING', 'UNSTRING', 'ACCEPT', 'DISPLAY', 'INVOKE', 'JSON', 'XML', 'RECEIVE', 'SEND']);
const PHRASE_WORDS = new Set(['END', 'INVALID', 'EXCEPTION', 'OVERFLOW', 'END-OF-PAGE', 'EOP']);
// One copy of every node's facts. The analysis keeps a few, so this is a quarter of what it may use.
const FACT_BUDGET_BYTES = 256 * 1024 * 1024;
const SETTLE_BUDGET = 20 * 1000 * 1000;
// Statements times fact words past which arithmetic intervals are not iterated.
const ARITH_WORK = 40 * 1000 * 1000;
// Routines whose only effect is to end the run with an abend.
const ABEND_ROUTINE = /^(CEE3ABD|CEE3AB2|ILBOABN0|ILBOABN)$/i;

const opensPhrase = (seg) => seg.some((x, i) => x.t === 'word' && (PHRASE_WORDS.has(x.u) || (x.u === 'ERROR' && seg[i - 1] && seg[i - 1].u === 'SIZE')));
const LEAVES = new Set(['exit-perform', 'exit-para', 'exit-section', 'goto', 'stop', 'perform']);
// The words that open a conditional phrase - AT END, NOT ON EXCEPTION, INVALID KEY - and those that
// can follow them. At a statement boundary they end the phrase before.
const PHRASE_OPENERS = new Set(['NOT', 'AT', 'ON', 'INVALID', 'EXCEPTION', 'OVERFLOW', 'END-OF-PAGE', 'EOP', 'SIZE', 'END']);
const PHRASE_FILLER = new Set([...PHRASE_OPENERS, 'KEY', 'ERROR']);
const LOOP_START = new Set(['VARYING', 'UNTIL', 'WITH', 'TEST', 'FOREVER', 'TIMES']);

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
  if (!a.dep !== !b.dep) out.dep = a.dep || b.dep;
  if (a.viaExpr && b.viaExpr) out.viaExpr = true;
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
  if (a.viaExpr || b.viaExpr) out.viaExpr = true;
  if (a.lo != null && b.lo != null) { out.lo = Math.min(a.lo, b.lo); out.loInc = a.lo === out.lo ? a.loInc : b.loInc; }
  if (a.hi != null && b.hi != null) { out.hi = Math.max(a.hi, b.hi); out.hiInc = a.hi === out.hi ? a.hiInc : b.hiInc; }
  return Object.keys(out).some((k) => k !== 'viaExpr') ? out : null;
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

const INDEX_SINKS = new Set(['subscript', 'reference-modification', 'occurs-depending-count', 'loop-bound']);
const atLeastOne = (cons) => cons.lo != null && (cons.lo >= 1 || (cons.lo >= 0 && !cons.loInc));

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
    // A subscript and a reference-modification start count from 1, so 0 is out of range too; a
    // count or a loop bound of 0 is not.
    case 'subscript': case 'reference-modification':
      return (cons.hi != null && atLeastOne(cons)) || (allDigits && [...cons.set].every((v) => Number(v) >= 1));
    case 'occurs-depending-count': case 'loop-bound': case 'storage-length':
      return cons.hi != null || allDigits;
    case 'dynamic-sql': case 'internal-reader': return set || cons.numeric === true;
    case 'web-response': case 'http-header': case 'log': return set || cons.numeric === true || cons.alpha === true;
    case 'os-command': case 'dynamic-program-load': case 'cics-dynamic-transfer': case 'dynamic-file-path':
    case 'queue-name': case 'outbound-host': case 'connection-target': case 'cics-sysid': case 'cics-system-resource': return set;
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
// Past this an expression's intermediate value may not be held exactly, and no bound is drawn from it.
const EXPR_LIMIT = 1e15;
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
  const loopBody = new Map();
  const stmtAt = new Map();
  for (const st of prog.statements) if (st.at != null && st.verb !== 'WHEN') stmtAt.set(st.at, st);
  const unpassedBy = new Map();
  for (const c of prog.calls || []) {
    const st = prog.statements[c.stmtIndex];
    if (st) unpassedBy.set(st, new Set([c.targetTok, ...c.using.filter((a) => a.mode !== 'REFERENCE' && a.tok).map((a) => a.tok)]));
  }
  const external = (it) => { for (let a = it; a; a = a.parent) if (a.external) return true; return false; };
  const labelAt = new Map();
  for (const l of prog.labels) if (l.at != null) labelAt.set(l.at, l);
  const labelNames = new Set(prog.labels.map((l) => l.name));
  const extraEntries = new Set();
  // A name the parse did not find as a label, or found twice, leaves which code runs unsure.
  let unknownLabel = false;
  const seenLabel = new Set();
  const twice = new Set();
  for (const l of prog.labels) { if (seenLabel.has(l.name)) twice.add(l.name); seenLabel.add(l.name); }
  const sure = (name) => labelNames.has(name) && !twice.has(name);
  const wordsOf = (e) => e.toks.filter((x) => x.t === 'word').map((x) => x.u);
  // Once IGNORE CONDITION has run, a RETURN or XCTL that fails comes back to the next statement, and
  // whether it has run by then is the order of execution, not of the source. A HANDLE CONDITION sends
  // the failure to its label, but which one is in force is as uncertain, so reach assumes it may not.
  const cicsWords = prog.execs.filter((e) => e.kind === 'CICS').map(wordsOf);
  const failuresReturn = cicsWords.some((w) => w[0] === 'IGNORE');
  const failuresHandled = cicsWords.some((w) => w[0] === 'HANDLE' && w[1] === 'CONDITION');
  // ALTER changes where a GO TO goes, so every GO TO may go anywhere and no code is known dead.
  const altered = prog.statements.some((st) => st.verb === 'ALTER');

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
      // AT END EXIT PERFORM NOT AT END ...: a statement that leaves can still end a phrase.
      if (!node.opensPhrase && LEAVES.has(node.k) && opensPhrase(tokens.slice(st.at + 1, st.end))) node.opensPhrase = true;
      out.push(node);
      if (phraseStop && node.opensPhrase) break;
    }
    return out;
  }
  function execNode(e) {
    const words = wordsOf(e);
    if (e.kind === 'CICS') {
      // With RESP or NOHANDLE, a RETURN or XCTL that fails comes back to the next statement.
      if (words[0] === 'RETURN' || words[0] === 'XCTL') {
        if (failuresReturn || words.some((w) => w === 'RESP' || w === 'RESP2' || w === 'NOHANDLE')) return { k: 'exec', e, mayEnd: true };
        return { k: 'stop', e, ...(failuresHandled ? { mayContinue: true } : {}) };
      }
      if (words[0] === 'ABEND') return { k: 'stop', e };
      if (words[0] === 'HANDLE' || words[0] === 'PUSH') for (const w of words) if (labelNames.has(w)) { extraEntries.add(w); if (twice.has(w)) unknownLabel = true; }
    } else if (e.kind === 'SQL' && words[0] === 'WHENEVER') {
      for (const w of words) if (labelNames.has(w)) { extraEntries.add(w); if (twice.has(w)) unknownLabel = true; }
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
          if (!sure(first.u) || (thru && !sure(thru))) unknownLabel = true;
          return { k: 'perform', st, target: first.u, thru, loop, testAfter };
        }
        // A name that is neither a paragraph nor data nor a loop word is a paragraph the parse missed.
        if (first && first.t === 'word' && !stmtAt.has(st.at + 1) && !LOOP_START.has(first.u) && !/^\d+$/.test(first.v) && !resolve(first)) unknownLabel = true;
        const body = parseList(new Set([...stops, 'END-PERFORM']));
        // Where an inline body lies in the tokens, and whether it can run code outside them.
        let leaves = false;
        for (let j = st.end; j < k; j++) if (isWord(j, 'GO') || (isWord(j, 'PERFORM') && tokens[j + 1] && tokens[j + 1].t === 'word' && labelNames.has(tokens[j + 1].u))) leaves = true;
        loopBody.set(st, { from: st.at, to: k, leaves });
        if (isWord(k, 'END-PERFORM')) k++;
        return { k: 'inline', st, body, loop, testAfter };
      }
      case 'GO': {
        k = st.end;
        const words = seg.filter((x) => x.t === 'word' && x.u !== 'TO');
        const dep = words.findIndex((w) => w.u === 'DEPENDING');
        const named = (dep >= 0 ? words.slice(0, dep) : words).map((w) => w.u).filter((n) => n !== 'OF' && n !== 'IN');
        if (named.some((n) => !sure(n))) unknownLabel = true;
        const targets = altered ? [] : named.filter((n) => labelNames.has(n));
        return { k: 'goto', st, targets, depending: dep >= 0 && !altered };
      }
      case 'GOBACK': k = st.end; return { k: 'stop', st };
      case 'STOP': k = st.end; return WORD(seg[0], 'RUN') ? { k: 'stop', st } : { k: 'stmt', st };
      case 'EXIT': {
        k = st.end;
        const next = seg[0];
        // EXIT PROGRAM with no CALL active carries on to the next statement (Language Reference 6.4).
        if (WORD(next, 'PROGRAM')) return { k: 'stop', st, mayContinue: true };
        if (WORD(next, 'METHOD') || WORD(next, 'FUNCTION')) return { k: 'stop', st };
        if (WORD(next, 'PARAGRAPH')) return { k: 'exit-para', st };
        if (WORD(next, 'SECTION')) return { k: 'exit-section', st };
        if (WORD(next, 'PERFORM')) return { k: 'exit-perform', st, cycle: WORD(seg[1], 'CYCLE') };
        return { k: 'stmt', st };
      }
      default: {
        k = st.end;
        if (st.verb === 'CALL' && seg[0] && seg[0].t === 'lit' && ABEND_ROUTINE.test(String(seg[0].v).trim())) return { k: 'stop', st };
        // A SORT or MERGE performs its input procedure, then its output procedure.
        if (st.verb === 'SORT' || st.verb === 'MERGE') {
          const procs = [];
          seg.forEach((x, i) => {
            if (!WORD(x, 'PROCEDURE') || !(WORD(seg[i - 1], 'INPUT') || WORD(seg[i - 1], 'OUTPUT'))) return;
            const at = WORD(seg[i + 1], 'IS') ? i + 2 : i + 1;
            const target = seg[at] && seg[at].t === 'word' ? seg[at].u : null;
            const thru = target && (WORD(seg[at + 1], 'THRU') || WORD(seg[at + 1], 'THROUGH')) && seg[at + 2] ? seg[at + 2].u : null;
            if (target && labelNames.has(target) && (!thru || labelNames.has(thru))) procs.push({ target, thru });
            if (!target || !sure(target) || (thru && !sure(thru))) unknownLabel = true;
          });
          if (procs.length) return { k: 'sort', st, procs };
        }
        if (PHRASED.has(st.verb) && opensPhrase(seg)) {
          const endWord = `END-${st.verb}`;
          const inner = new Set([...stops, endWord, ...PHRASE_OPENERS]);
          const opener = () => k < to && tokens[k].t === 'word' && PHRASE_OPENERS.has(tokens[k].u) && !stmtAt.has(k);
          const bodies = [];
          for (;;) {
            while (k < to && tokens[k].t === 'word' && PHRASE_FILLER.has(tokens[k].u) && !stmtAt.has(k)) k++;
            const body = parseList(inner, true);
            bodies.push(body);
            const last = body[body.length - 1];
            if (!(last && last.opensPhrase) && !opener()) break;
            if (k >= to || tokens[k].t === 'period') break;
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
  // A run starts after END DECLARATIVES; the declaratives are entered only on an error.
  let mainPara = cur;
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
    if (WORD(t, 'END') && isWord(k + 1, 'DECLARATIVES')) {
      inDeclaratives = false;
      k += 2;
      cur = { name: null, kind: null, section: null, sentences: [] };
      paras.push(cur);
      mainPara = cur;
      continue;
    }
    const before = k;
    cur.sentences.push(parseList(new Set()));
    if (k === before) k++;
  }

  // ---- the tree into a graph ----
  const nodes = [];
  const entryStatements = [];
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
  const loopHeads = [];

  function lowerList(list, next, ctx) {
    let cont = next;
    for (let i = list.length - 1; i >= 0; i--) cont = lower(list[i], cont, ctx);
    return cont;
  }
  function outcome(test, value, next) { return add('outcome', { test, value, succ: [next] }); }
  function lower(n, next, ctx) {
    switch (n.k) {
      case 'stmt': {
        const id = add('stmt', { st: n.st, succ: [next] });
        nodeOf.set(n.st, id);
        if (n.st.verb === 'ENTRY') entryStatements.push(id);
        return id;
      }
      case 'exec': { const id = add('exec', { e: n.e, succ: n.mayEnd ? [EXIT, next] : [next] }); nodeOf.set(n.e, id); return id; }
      case 'stop': { const id = add('stop', { st: n.st, e: n.e, succ: [EXIT], ...(n.mayContinue ? { cont: next } : {}) }); nodeOf.set(n.st || n.e, id); return id; }
      case 'sort': {
        let cont = next;
        for (let i = n.procs.length - 1; i >= 0; i--) cont = add('call', { st: n.st, range: rangeOf(n.procs[i].target, n.procs[i].thru), succ: [cont] });
        const id = add('stmt', { st: n.st, succ: [cont] });
        nodeOf.set(n.st, id);
        return id;
      }
      case 'next-sentence': return add('nop', { succ: [ctx.sentenceEnd] });
      case 'exit-para': { const id = add('stmt', { st: n.st, succ: [ctx.paraEnd] }); nodeOf.set(n.st, id); return id; }
      case 'exit-section': { const id = add('stmt', { st: n.st, succ: [ctx.sectionEnd || ctx.paraEnd] }); nodeOf.set(n.st, id); return id; }
      case 'exit-perform': { const id = add('stmt', { st: n.st, succ: [n.cycle ? (ctx.loopTest ?? next) : (ctx.loopExit ?? next)] }); nodeOf.set(n.st, id); return id; }
      case 'if': {
        const t = add('test', { st: n.st, cond: n.cond, branches: [n.then, n.else] });
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
          // The false outcome runs the later groups, WHEN OTHER among them.
          const t = add('test', { st: n.st, evaluate: { subjects: n.subjects, conds: grp.conds }, at: grp.at, branches: [grp.body, { later: n.groups, from: g + 1 }] });
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
        if (n.st.loops) loopHeads.push({ head, step, loops: n.st.loops, test: t, testAfter: n.testAfter, body: n.k === 'inline' ? n.body : null });
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
  // The storage an item lies in: its record, or the record an 01 REDEFINES lays itself over.
  const itemsInRecord = (item) => {
    let top = item;
    while (top.parent) top = top.parent;
    for (let hops = 0; top.redefinesItem && hops < 64; hops++) top = top.redefinesItem;
    return top;
  };
  const fieldKey = (f) => (f.index ? `IX:${f.index}` : f);
  const overlaps = (w, f) => {
    if (w === f) return true;
    if (w.index || f.index) return w.index && f.index && w.index === f.index;
    if (w.level === 66 || f.level === 66) return true;
    if (itemsInRecord(w) !== itemsInRecord(f)) return false;
    if (w.offset == null || f.offset == null || w.size == null || f.size == null) return true;
    const wEnd = w.offset + (w.contributes || w.size);
    const fEnd = f.offset + (f.contributes || f.size);
    return w.offset < fEnd && f.offset < wEnd;
  };
  const writtenBy = (n) => {
    const out = [];
    const add = (tok) => { const f = tok ? resolve(tok) : null; if (f) out.push(f.level === 88 && f.parent ? f.parent : f); };
    if (n.st) {
      for (const t of n.st.targets || []) add(t);
      if (n.st.verb === 'CALL' || n.st.verb === 'READ' || n.st.verb === 'RETURN') {
        // A callee may write what it is passed by reference, and a READ fills the file's records.
        // The field naming the program called, and what goes BY CONTENT or BY VALUE, is not passed
        // for the callee to write - unless it is EXTERNAL, which any program can.
        const unpassed = n.st.verb === 'CALL' ? unpassedBy.get(n.st) : null;
        for (const t of n.st.sources || []) {
          const f = resolve(t);
          if (!f) continue;
          if (f.records) for (const r of f.records) out.push(r);
          else if (n.st.verb === 'CALL' && !(unpassed && unpassed.has(t) && !external(f))) out.push(f);
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
  // A VALUE holds for the whole run only if no statement writes storage that overlaps the item.
  let writtenItems = null;
  const neverWritten = (it) => {
    if (it.external) return false;
    if (!writtenItems) {
      writtenItems = [];
      for (const n of nodes) if (n.kind === 'stmt' || n.kind === 'exec' || n.kind === 'step' || n.kind === 'call') writtenItems.push(...writtenBy(n));
    }
    return !writtenItems.some((w) => overlaps(w, it));
  };
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
    if (it && !it.index && (it.level === 78 || it.constant || (!it.receiving && it.values && it.values.length === 1 && neverWritten(it)))) {
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
  const pictureOf = (field) => String(field.picture || '').toUpperCase().replace(/(\w)\((\d+)\)/g, (_, ch, n) => ch.repeat(Number(n)));
  const categories = new Map();
  const categoryOf = (field) => {
    if (categories.has(field)) return categories.get(field);
    const usage = String(field.effectiveUsage || 'DISPLAY').replace('COMPUTATIONAL', 'COMP');
    const pic = pictureOf(field);
    const cat = (field.children || []).some((c) => c.level !== 88) ? { k: 'A' }
      : /^[XA]+$/.test(pic) && usage === 'DISPLAY' ? { k: 'A' }
        : /^S?9+(V9*)?$/.test(pic) && /^(DISPLAY|COMP|COMP-3|COMP-4|COMP-5|BINARY|PACKED-DECIMAL)$/.test(usage) ? { k: 'N', digits: pic.split('V')[0].replace(/[^9]/g, '').length }
          : null;
    categories.set(field, cat);
    return cat;
  };
  // An unsigned whole number, for which "not zero" is "at least one".
  const unsignedInteger = (field) => !!field && !field.index && categoryOf(field)?.k === 'N' && /^9+$/.test(pictureOf(field));
  // What a numeric item's picture and storage allow: an unsigned item is not negative, a signed one
  // has no known lower end, and a binary item may fill its bytes. Null for anything else.
  const picRange = (f) => {
    if (!f || f.index || f.level === 88 || f.level === 66 || categoryOf(f)?.k !== 'N') return null;
    const pic = pictureOf(f);
    let hi = 10 ** pic.split('V')[0].replace(/[^9]/g, '').length - (pic.includes('V') ? 0 : 1);
    if (/^(COMP|COMP-4|COMP-5|BINARY)$/.test(String(f.effectiveUsage || '').replace('COMPUTATIONAL', 'COMP')) && f.size > 0) hi = Math.max(hi, 2 ** (8 * f.size) - 1);
    return { lo: pic.startsWith('S') ? -Infinity : 0, hi };
  };
  const variableLength = (it) => !!it.dependingOn || (it.children || []).some(variableLength);
  const linAdd = (a, b, sign) => {
    if (!a || !b) return null;
    const terms = new Map(a.terms);
    for (const [f, c] of b.terms) { const n = (terms.get(f) || 0) + sign * c; if (n) terms.set(f, n); else terms.delete(f); }
    const r = { terms, lo: a.lo + (sign > 0 ? b.lo : -b.hi), hi: a.hi + (sign > 0 ? b.hi : -b.lo) };
    return Math.abs(r.lo) > EXPR_LIMIT || Math.abs(r.hi) > EXPR_LIMIT ? null : r;
  };
  // An arithmetic expression as `terms` (a coefficient per numeric field) plus a `lo`..`hi` interval
  // for its constants, or null for what it cannot read exactly: division, a power, a product of two
  // unknowns, a subscript, a non-numeric name, or a number past EXPR_LIMIT where the compiler's
  // intermediate precision could give way.
  const linearOf = (toks) => {
    let i = 0;
    const isOp = (v) => toks[i] && toks[i].t === 'op' && toks[i].v === v;
    const isSep = (v) => toks[i] && toks[i].t === 'sep' && toks[i].v === v;
    const constant = (n) => (Math.abs(n) > EXPR_LIMIT ? null : { terms: new Map(), lo: n, hi: n });
    // LENGTH OF is the item's size, which a table that varies in length only bounds.
    const sized = (tok) => {
      const it = tok && tok.t === 'word' ? resolve(tok) : null;
      if (!it || it.index || it.level === 88 || it.size == null || it.size > EXPR_LIMIT) return null;
      return { terms: new Map(), lo: variableLength(it) ? 0 : it.size, hi: it.size };
    };
    const times = (a, b) => {
      if (!a || !b) return null;
      const scalar = (e) => (!e.terms.size && e.lo === e.hi ? e.lo : null);
      const k = scalar(a) ?? scalar(b);
      const e = scalar(a) != null ? b : a;
      if (k == null && (a.terms.size || b.terms.size)) return null;
      if (k == null) {
        const ends = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
        const r = { terms: new Map(), lo: Math.min(...ends), hi: Math.max(...ends) };
        return Math.abs(r.lo) > EXPR_LIMIT || Math.abs(r.hi) > EXPR_LIMIT ? null : r;
      }
      const terms = new Map();
      for (const [f, c] of e.terms) if (c * k) terms.set(f, c * k);
      const ends = [e.lo * k, e.hi * k];
      const r = { terms, lo: Math.min(...ends), hi: Math.max(...ends) };
      return Math.abs(r.lo) > EXPR_LIMIT || Math.abs(r.hi) > EXPR_LIMIT ? null : r;
    };
    const primary = () => {
      const t = toks[i];
      if (!t) return null;
      if (isSep('(')) {
        i++;
        const e = sum();
        if (!isSep(')')) return null;
        i++;
        return e;
      }
      if (t.t !== 'word' && t.t !== 'num') return null;
      if (WORD(t, 'LENGTH') && WORD(toks[i + 1], 'OF')) { const e = sized(toks[i + 2]); i += 3; return e; }
      if (WORD(t, 'FUNCTION') && WORD(toks[i + 1], 'LENGTH') && toks[i + 2] && toks[i + 2].v === '(') {
        const e = sized(toks[i + 3]);
        if (!toks[i + 4] || toks[i + 4].v !== ')') return null;
        i += 5;
        return e;
      }
      i++;
      while ((WORD(toks[i], 'OF') || WORD(toks[i], 'IN')) && toks[i + 1] && toks[i + 1].t === 'word') i += 2;
      if (isSep('(')) return null;
      const n = numberOf(constValue([t]));
      if (n != null) return constant(n);
      const f = t.t === 'word' ? resolve(t) : null;
      return picRange(f) ? { terms: new Map([[f, 1]]), lo: 0, hi: 0 } : null;
    };
    const factor = () => {
      if (isOp('-')) { i++; return times(constant(-1), primary()); }
      if (isOp('+')) i++;
      return primary();
    };
    const product = () => {
      let e = factor();
      while (e && isOp('*')) { i++; e = times(e, factor()); }
      return e;
    };
    function sum() {
      let e = product();
      while (e && (isOp('+') || isOp('-'))) { const sign = toks[i].v === '+' ? 1 : -1; i++; e = linAdd(e, product(), sign); }
      return e;
    }
    const e = sum();
    return e && i === toks.length ? e : null;
  };
  // What `left op right` says of each field in it that has coefficient 1 or -1, from the rest of the
  // expression: X + Y <= K gives X <= K - Y, and Y unsigned gives X <= K. The other operand counts by
  // what its picture rules out (a sign) and by constants alone; a bound it has only from checks is
  // left as `dep`, for the second pass to join to those checks. Only what narrows the field is kept.
  const exprCons = (left, op, right) => {
    const l = linearOf(left), r = linearOf(right);
    const e = l && r ? linAdd(l, r, -1) : null;
    const out = new Map();
    if (!e || !['<', '<=', '>', '>='].includes(op)) return out;
    const upper = op === '<' || op === '<=';
    const inc = op === '<=' || op === '>=';
    for (const [x, c] of e.terms) {
      if (Math.abs(c) !== 1) continue;
      const own = picRange(x);
      // c*x + sum(d*g) + R op 0, R in [e.lo, e.hi]: x is on the `side` of the sum of m*g, plus b.
      const side = upper === (c > 0) ? 'hi' : 'lo';
      const b = -c * (upper ? e.lo : e.hi);
      const open = [];
      const soft = [];
      for (const [g, d] of e.terms) {
        if (g === x) continue;
        const m = -c * d;
        const needs = side === 'hi' ? (m > 0 ? 'hi' : 'lo') : (m > 0 ? 'lo' : 'hi');
        if (!(needs === 'lo' && picRange(g).lo === 0)) open.push({ g, m, needs }); else soft.push({ g, m, needs });
      }
      if (open.length > 1) continue;
      const c1 = { viaExpr: true };
      // An operand whose picture gives 0 for its low end may have a higher one from a check: the picture's bound stands, and the check's tightens it.
      if (!open.length) {
        c1[side] = b; c1[`${side}Inc`] = inc;
        if (soft.length === 1) c1.dep = { g: soft[0].g, m: soft[0].m, needs: soft[0].needs, side, b, inc };
      } else c1.dep = { g: open[0].g, m: open[0].m, needs: open[0].needs, side, b, inc };
      const narrows = c1[side] != null && (side === 'hi' ? c1.hi < own.hi || (c1.hi === own.hi && !inc) : c1.lo > own.lo || (c1.lo === own.lo && !inc));
      if (narrows || c1.dep) out.set(fieldKey(x), c1);
    }
    return out;
  };
  // A constraint without its `dep`, or null where nothing else is left.
  const plainCons = (c) => {
    if (!c || !c.dep) return c || null;
    const { dep, ...rest } = c;
    return Object.keys(rest).some((k) => k !== 'viaExpr') ? rest : null;
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
        const c = tree.sign === 'ZERO' ? (outcome ? { set: new Set(['0']) } : unsignedInteger(f) ? { lo: 1, loInc: true } : null)
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
          if (g && w != null) { f = g; v = w; op = FLIP[op]; } else return exprCons(tree.left, outcome ? tree.op : NEGATE[tree.op], tree.right);
        }
        const eff = outcome ? op : NEGATE[op];
        const c = eff === '<>' && numberOf(v) === 0 && unsignedInteger(f) ? { lo: 1, loInc: true } : relCons(eff, v);
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
  // The fields `tested` finds that a condition evaluates on every route to `outcome`. The right of an
  // AND runs only if the left was true, the right of an OR only if the left was false; whatever the
  // outcome, only the leftmost operand is sure to run.
  function testedWhen(tree, outcome, out = new Map()) {
    switch (tree.k) {
      case 'not': return testedWhen(tree.a, !outcome, out);
      case 'and': return outcome ? testedWhen(tree.b, true, testedWhen(tree.a, true, out)) : testedAlways(tree.a, out);
      case 'or': return outcome ? testedAlways(tree.a, out) : testedWhen(tree.b, false, testedWhen(tree.a, false, out));
      default: return tested(tree, out);
    }
  }
  function testedAlways(tree, out) {
    return tree.k === 'not' || tree.k === 'and' || tree.k === 'or' ? testedAlways(tree.a, out) : tested(tree, out);
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
    n.tree = tree;
    const whenTrue = consOf(tree, true);
    const whenFalse = consOf(tree, false);
    const restricts = tested(tree);
    const keys = new Set([...whenTrue.keys(), ...whenFalse.keys(), ...restricts.keys()]);
    n.gen = { true: [], false: [] };
    const where = n.at || n.st;
    for (const key of keys) {
      const field = restricts.get(key) || (typeof key === 'string' ? { index: key.slice(3) } : key);
      noteField(key, field);
      const c = { id: checks.length, key, field, file: where.file, line: where.line, test: id, tCons: plainCons(whenTrue.get(key)), fCons: plainCons(whenFalse.get(key)), tDep: whenTrue.get(key)?.dep || null, fDep: whenFalse.get(key)?.dep || null, restricts: restricts.has(key) };
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
        if (val != null) assigns.push({ n, field: c.parent, value: val, tok: v });
      }
      continue;
    }
    if (value == null) continue;
    const tok = seg.findIndex((t) => WORD(t, 'TO')) === 1 ? seg[0] : null;
    for (const field of targets) assigns.push({ n, field, value, tok });
  }
  for (const a of assigns) {
    const key = fieldKey(a.field);
    noteField(key, a.field);
    a.c = { id: checks.length, key, field: a.field, file: a.n.st.file, line: a.n.st.line, tCons: { set: new Set([a.value]) }, fCons: null, restricts: false, assigned: true };
    checks.push(a.c);
  }
  // One fact per distinct constant v moved into a whole number: "it holds a constant from 1 to v", set by every MOVE of one that small, so it survives a join only where every route moved one.
  const moved = new Map();
  for (const a of assigns) {
    const cat = a.field.level === 88 ? null : categoryOf(a.field);
    const v = numberOf(a.value);
    if (!cat || cat.k !== 'N' || v == null || !Number.isInteger(v) || v < 1 || String(v).length > cat.digits) continue;
    if (!moved.has(a.field)) moved.set(a.field, []);
    moved.get(a.field).push(a);
  }
  for (const [field, list] of moved) {
    const key = fieldKey(field);
    noteField(key, field);
    for (const hi of new Set(list.map((a) => Number(a.value)))) {
      const bounds = { lo: 1, hi };
      const c = { id: checks.length, key, field, file: list[0].n.st.file, line: list[0].n.st.line, tCons: { numeric: true, lo: 1, loInc: true, hi, hiInc: true }, fCons: null, restricts: false, assigned: true, bounds };
      checks.push(c);
      // "At most v" alone, which a decrement that cannot go below 0 leaves standing.
      const top = { id: checks.length, key, field, file: c.file, line: c.line, tCons: { numeric: true, hi, hiInc: true }, fCons: null, restricts: false, assigned: true, bounds: { hi } };
      checks.push(top);
      for (const a of list) if (Number(a.value) <= hi) (a.upTo ||= []).push(c, top);
    }
  }
  // Fact numbers: for each check, `x` that it ran (only a restricting one), `t` and `f` that it came
  // out true or false with something to say about its field.
  let nFacts = 0;
  for (const c of checks) {
    c.x = c.restricts ? nFacts++ : null;
    c.t = c.tCons ? nFacts++ : null;
    c.f = c.fCons ? nFacts++ : null;
    c.rt = c.tDep ? nFacts++ : null;
    c.rf = c.fDep ? nFacts++ : null;
  }
  for (const id of tests) {
    const n = nodes[id];
    for (const c of n.checks) {
      if (c.x != null) { n.gen.true.push(c.x); n.gen.false.push(c.x); }
      if (c.t != null) n.gen.true.push(c.t);
      if (c.f != null) n.gen.false.push(c.f);
      if (c.rt != null) n.gen.true.push(c.rt);
      if (c.rf != null) n.gen.false.push(c.rf);
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
    for (const c of a.upTo || []) gen.push(c.t);
    for (const c of checksOf.get(a.c.key) || []) {
      if (c.t != null && satisfies(c.tCons, a.value)) gen.push(c.t);
      if (c.f != null && satisfies(c.fCons, a.value)) gen.push(c.f);
    }
  }
  const assignsOf = new Map();
  for (const a of assigns) { if (!assignsOf.has(a.n.st)) assignsOf.set(a.n.st, []); assignsOf.get(a.n.st).push(a); }
  const nested = (el) => (el.k === 'if' ? [el.then, el.else] : el.k === 'evaluate' ? el.groups.map((g) => g.body)
    : el.k === 'search' ? [...(el.atEnd ? [el.atEnd] : []), ...el.whens.map((w) => w.body)] : el.k === 'inline' ? [el.body] : el.k === 'phrased' ? el.bodies : []);

  // A count INSPECT TALLYING adds to holds at most what it held plus the length inspected: each
  // comparison cycle adds at most one and moves past at least one character. What it held is known
  // where a MOVE of a constant reaches the INSPECT through the statements between and no other way.
  const segOf = (st) => tokens.slice(st.at + 1, st.end);
  const QUIET = new Set(['MOVE', 'SET', 'COMPUTE', 'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'INITIALIZE', 'INITIALISE', 'DISPLAY', 'CONTINUE', 'STRING', 'ACCEPT', 'INSPECT']);
  const LENGTH_KEEPING = new Set(['REVERSE', 'UPPER-CASE', 'LOWER-CASE', 'TRIM']);
  const inspectedSize = (op) => {
    if (WORD(op[0], 'FUNCTION') && op[1] && LENGTH_KEEPING.has(op[1].u) && op[2] && op[2].v === '(' && op[op.length - 1].v === ')') {
      op = op.slice(3, -1).filter((t) => !WORD(t, 'LEADING') && !WORD(t, 'TRAILING'));
    }
    // An identifier, its qualifiers and a subscript: an element is no longer than its item. A
    // reference modification can be.
    let i = 1;
    while (i + 1 < op.length && (WORD(op[i], 'OF') || WORD(op[i], 'IN')) && op[i + 1].t === 'word') i += 2;
    if (i < op.length) {
      if (op[i].v !== '(' || op[op.length - 1].v !== ')' || op.slice(i).some((t) => t.t === 'op' && t.v === ':')) return null;
    }
    const it = op[0] && op[0].t === 'word' ? resolve(op[0]) : null;
    return it && !it.index && it.level !== 88 && it.size != null ? it.size : null;
  };
  const writesRecordOf = (st, item) => (st.targets || []).some((t) => { const it = resolve(t); return it && !it.index && itemsInRecord(it) === itemsInRecord(item); });
  const tallies = [];
  const tallyIn = (seq) => {
    for (let j = 0; j < seq.length; j++) {
      const el = seq[j];
      if (!el || el.k !== 'stmt' || el.st.verb !== 'INSPECT' || !el.st.counts) continue;
      const seg = segOf(el.st);
      const at = seg.findIndex((t) => WORD(t, 'TALLYING'));
      const count = seg[at + 1] ? resolve(seg[at + 1]) : null;
      const size = inspectedSize(seg.slice(0, at));
      if (!count || count.index || count.level === 88 || size == null) continue;
      // The count holds what the tally adds without losing a digit.
      const room = 10 ** String(count.picture || '').toUpperCase().replace(/(\w)\((\d+)\)/g, (_, ch, n) => ch.repeat(Number(n))).split(/[V.]/)[0].replace(/[^9]/g, '').length - 1;
      for (let i = j - 1; i >= 0; i--) {
        const prev = seq[i];
        if (!prev || prev.k !== 'stmt' || !QUIET.has(prev.st.verb)) break;
        const a = (assignsOf.get(prev.st) || []).find((x) => x.field === count);
        const others = (prev.st.targets || []).some((t) => { const it = resolve(t); return it && it !== count && !it.index && itemsInRecord(it) === itemsInRecord(count); });
        if (a && !others) {
          const n = nodes[nodeOf.get(el.st)];
          const start = numberOf(a.value);
          if (start != null && Number.isInteger(start) && start >= 0 && start + size <= room && n) {
            const key = fieldKey(count);
            noteField(key, count);
            const bounds = { lo: start, hi: start + size };
            const c = { id: checks.length, key, field: count, file: el.st.file, line: el.st.line, tCons: { numeric: true, lo: bounds.lo, loInc: true, hi: bounds.hi, hiInc: true }, fCons: null, restricts: false, x: null, t: nFacts++, f: null, bounds };
            checks.push(c);
            tallies.push(c);
            (n.genStmt ||= []).push(c.t);
          }
          break;
        }
        if ((prev.st.verb === 'INSPECT' && segOf(prev.st).some((t) => WORD(t, 'TALLYING'))) || writesRecordOf(prev.st, count)) break;
      }
    }
  };
  // A paragraph's sentences run in order, and one is entered from anywhere but the one before it
  // only by a NEXT SENTENCE in that one: there the run is cut.
  const nextSentenceIn = (list) => list.some((el) => el.k === 'next-sentence' || nested(el).some(nextSentenceIn));
  const eachList = (list) => { tallyIn(list); for (const el of list) for (const l of nested(el)) eachList(l); };
  for (const p of paras) {
    const run = [];
    p.sentences.forEach((s, i) => {
      if (i && nextSentenceIn(p.sentences[i - 1])) run.push(null);
      run.push(...s);
      for (const el of s) for (const l of nested(el)) eachList(l);
    });
    tallyIn(run);
  }

  // A test whose failing branch sets a flag leaves "the flag holds one of the values that branch
  // gives it, or the field holds what the test's other outcome said". A later test ruling out those
  // values leaves the second. Each such fact dies with a write to either field, and what it yields
  // dies with a write to the second, so a range's summary still composes.
  // A flag's values are compared only where nothing but the literal decides the comparison: an
  // alphanumeric literal against an alphanumeric item, which a value it is given must fill so that
  // JUSTIFIED cannot move it, and an integer against a numeric item with room for its digits.
  const plainLiteral = (tok) => tok && tok.t === 'lit' && !tok.prefix;
  const integerOf = (tok) => (tok && (tok.t === 'num' || tok.t === 'word') && /^\d+$/.test(tok.v) ? tok.v : null);
  const heldAs = (field, tok) => {
    const cat = categoryOf(field);
    if (!cat) return null;
    if (cat.k === 'A') return plainLiteral(tok) && String(tok.v).length === field.size && String(tok.v).trim() ? `A:${String(tok.v).trimEnd()}` : null;
    const digits = integerOf(tok);
    return digits != null && digits.replace(/^0+(?=\d)/, '').length <= cat.digits ? `N:${Number(digits)}` : null;
  };
  const comparedAs = (field, tok) => {
    const cat = categoryOf(field);
    if (!cat) return null;
    if (cat.k === 'A') return plainLiteral(tok) ? `A:${String(tok.v).trimEnd()}` : null;
    const digits = integerOf(tok);
    return digits != null ? `N:${Number(digits)}` : null;
  };
  const heldBy = new Map();
  // A flag moved from a constant item holds that item's value, when the item fills the flag exactly.
  const heldTok = (a) => {
    const t = a.tok;
    if (!t || t.t !== 'word' || /^\d+$/.test(t.v)) return t;
    const src = resolve(t);
    if (!src || src.index || (src.level !== 78 && src.size !== a.field.size)) return t;
    return { t: 'lit', v: a.value };
  };
  const held = (a) => { if (!heldBy.has(a)) heldBy.set(a, heldAs(a.field, heldTok(a))); return heldBy.get(a); };
  const flagFields = (tree, out = new Set()) => {
    if (tree.k === 'not') flagFields(tree.a, out);
    else if (tree.k === 'and' || tree.k === 'or') { flagFields(tree.a, out); flagFields(tree.b, out); }
    else if (tree.k === 'rel') { for (const side of [tree.left, tree.right]) { const f = fieldOf(side); if (f) out.add(f); } }
    else if (tree.k === 'cond' && tree.subject.length === 1) { const c = resolve(tree.subject[0]); if (c && c.level === 88 && c.parent) out.add(c.parent); }
    return out;
  };
  // Whether an outcome of a condition rules out that `field` holds `value`.
  function excludes(tree, outcome, field, value) {
    switch (tree.k) {
      case 'not': return excludes(tree.a, !outcome, field, value);
      case 'and': return outcome ? excludes(tree.a, true, field, value) || excludes(tree.b, true, field, value)
        : excludes(tree.a, false, field, value) && excludes(tree.b, false, field, value);
      case 'or': return outcome ? excludes(tree.a, true, field, value) && excludes(tree.b, true, field, value)
        : excludes(tree.a, false, field, value) || excludes(tree.b, false, field, value);
      case 'rel': {
        const other = fieldOf(tree.left) === field ? tree.right : fieldOf(tree.right) === field ? tree.left : null;
        const v = other && other.length === 1 ? comparedAs(field, other[0]) : null;
        if (v == null) return false;
        const op = outcome ? tree.op : NEGATE[tree.op];
        return op === '=' ? v !== value : op === '<>' ? v === value : false;
      }
      case 'cond': {
        const c = tree.subject.length === 1 ? resolve(tree.subject[0]) : null;
        if (!c || c.level !== 88 || c.parent !== field || !(c.values || []).length) return false;
        const vals = c.values.map((t) => (WORD(t, 'THRU') || WORD(t, 'THROUGH') ? null : comparedAs(field, t)));
        if (vals.includes(null)) return false;
        const named = vals.includes(value);
        return outcome ? !named : named;
      }
      default: return false;
    }
  }
  const stmtsIn = (list, out = []) => { for (const el of list) { if (el.k === 'stmt') out.push(el.st); for (const l of nested(el)) stmtsIn(l, out); } return out; };
  const flags = [];
  const implied = new Map();
  for (const id of tests) {
    const n = nodes[id];
    if (!n.branches) continue;
    for (const outcome of [true, false]) {
      const said = n.checks.filter((c) => (outcome ? c.tCons : c.fCons));
      if (!said.length) continue;
      const valuesOf = new Map();
      const failing = n.branches[outcome ? 1 : 0];
      for (const st of stmtsIn(failing.later ? failing.later.slice(failing.from).flatMap((g) => g.body) : failing)) {
        for (const a of assignsOf.get(st) || []) {
          const v = held(a);
          if (v == null) continue;
          if (!valuesOf.has(a.field)) valuesOf.set(a.field, new Set());
          valuesOf.get(a.field).add(v);
        }
      }
      for (const [field, values] of valuesOf) {
        const fKey = fieldKey(field);
        noteField(fKey, field);
        for (const c of said) {
          if (c.key === fKey) continue;
          let yields = implied.get(`${c.id}|${outcome}`);
          if (!yields) {
            yields = { id: checks.length, key: c.key, field: c.field, file: c.file, line: c.line, tCons: outcome ? c.tCons : c.fCons, fCons: null, restricts: false, x: null, t: nFacts++, f: null };
            checks.push(yields);
            implied.set(`${c.id}|${outcome}`, yields);
          }
          const bit = nFacts++;
          checks.push({ pseudo: true, key: fKey, field, x: null, t: bit, f: null }, { pseudo: true, key: c.key, field: c.field, x: null, t: bit, f: null });
          n.gen[String(outcome)].push(bit);
          flags.push({ field, values: [...values], bit, yields: yields.t });
        }
      }
    }
  }
  if (flags.length) {
    const byField = new Map();
    for (const fl of flags) { if (!byField.has(fl.field)) byField.set(fl.field, []); byField.get(fl.field).push(fl); }
    for (const a of assigns) {
      const fls = byField.get(a.field);
      const v = fls && held(a);
      if (v != null) for (const fl of fls) if (fl.values.includes(v)) (a.n.genStmt ||= []).push(fl.bit);
    }
    const outcomes = new Map();
    for (const node of nodes) if (node.kind === 'outcome') outcomes.set(`${node.test}|${node.value}`, node);
    for (const id of tests) {
      const tree = nodes[id].tree;
      for (const field of flagFields(tree)) {
        for (const fl of byField.get(field) || []) {
          for (const outcome of [true, false]) {
            const at = outcomes.get(`${id}|${outcome}`);
            if (at && fl.values.every((v) => excludes(tree, outcome, field, v))) (at.implies ||= []).push([fl.bit, fl.yields]);
          }
        }
      }
    }
  }
  // A lower bound survives an increment. A field set to a constant of 1 or more, or varied from one,
  // stays at 1 or more through ADD, SET UP BY, COMPUTE X = X + n and a VARYING step, where n is
  // never negative. The upper bound is lost, and the lower bound survives only where the sum cannot
  // wrap past the field's capacity to a small number: an upper bound live before the increment that
  // leaves room for n, or ON SIZE ERROR, which leaves the field as it was. Any other write kills it.
  const intCap = (f) => {
    if (!f || f.index || f.level === 88 || inTable(f)) return null;
    const cat = categoryOf(f);
    return cat && cat.k === 'N' && /^S?9+$/.test(pictureOf(f)) ? 10 ** cat.digits - 1 : null;
  };
  // The most a token can add: a literal or constant that is not negative, or an unsigned number.
  const addend = (tok) => {
    if (!tok || (tok.t !== 'word' && tok.t !== 'num')) return null;
    const v = numberOf(constValue([tok]));
    if (v != null) return v >= 0 ? Math.ceil(v) : null;
    const f = tok.t === 'word' ? resolve(tok) : null;
    const cat = f && !f.index && f.level !== 88 && !inTable(f) ? categoryOf(f) : null;
    return cat && cat.k === 'N' && /^9+(V9*)?$/.test(pictureOf(f)) ? 10 ** cat.digits : null;
  };
  // The least a token adds: its value where it is a constant, else nothing.
  const least = (tok) => { const v = numberOf(constValue([tok])); return v != null && v > 0 ? Math.floor(v) : 0; };
  const PHRASE_AT = (t) => WORD(t, 'ON') || WORD(t, 'NOT') || WORD(t, 'SIZE') || (t.t === 'word' && t.u.startsWith('END-'));
  const sizeErrorGuarded = (seg) => seg.some((t, i) => WORD(t, 'SIZE') && WORD(seg[i + 1], 'ERROR') && !WORD(seg[i - 1], 'NOT'));
  // The fields a statement only ever raises, and by how much at most.
  const increments = (st) => {
    const seg = segOf(st);
    let max = 0;
    let min = 0;
    let fields = [];
    if (st.verb === 'ADD') {
      const to = seg.findIndex((t) => WORD(t, 'TO'));
      if (to < 1 || seg.some((t) => WORD(t, 'GIVING') || WORD(t, 'CORRESPONDING') || WORD(t, 'CORR'))) return null;
      for (const t of seg.slice(0, to)) { const m = addend(t); if (m == null) return null; max += m; min += least(t); }
      const end = seg.findIndex((t, i) => i > to && PHRASE_AT(t));
      if (seg.slice(to + 1, end < 0 ? seg.length : end).some((t) => t.t === 'sep')) return null;
      fields = (st.targets || []).map((t) => resolve(t));
    } else if (st.verb === 'SET') {
      const up = seg.findIndex((t) => WORD(t, 'UP'));
      if (up < 1 || !WORD(seg[up + 1], 'BY') || seg.length !== up + 3 || seg.slice(0, up).some((t) => t.t !== 'word')) return null;
      max = addend(seg[up + 2]);
      if (max == null) return null;
      min = least(seg[up + 2]);
      fields = (st.targets || []).map((t) => resolve(t));
    } else if (st.verb === 'COMPUTE') {
      const eq = seg.findIndex((t) => t.t === 'op' && t.v === '=');
      const lhs = seg.slice(0, eq).filter((t) => !WORD(t, 'ROUNDED'));
      if (eq < 1 || lhs.length !== 1 || lhs[0].t !== 'word') return null;
      const target = resolve(lhs[0]);
      const end = seg.findIndex((t, i) => i > eq && PHRASE_AT(t));
      const parts = [[]];
      for (const t of seg.slice(eq + 1, end < 0 ? seg.length : end)) { if (t.t === 'op' && t.v === '+') parts.push([]); else parts[parts.length - 1].push(t); }
      if (parts.length < 2 || parts.some((p) => p.length !== 1)) return null;
      const self = parts.filter((p) => p[0].t === 'word' && resolve(p[0]) === target);
      if (self.length !== 1) return null;
      for (const p of parts) { if (p === self[0]) continue; const m = addend(p[0]); if (m == null) return null; max += m; min += least(p[0]); }
      fields = [target];
    } else return null;
    fields = [...new Set(fields.filter((f) => intCap(f) != null))];
    return fields.length ? { fields, max, min, sizeError: sizeErrorGuarded(seg) } : null;
  };
  // Facts of the form "at least k", one per field and k so that routes which reach it by different
  // statements agree. They are kept apart because an increment does not kill them.
  const loOf = new Map();
  const newLo = (field, lo, at) => {
    const key = fieldKey(field);
    const had = (loOf.get(field) || []).find((c) => c.tCons.lo === lo);
    if (had) return had;
    noteField(key, field);
    const c = { id: checks.length, key, field, file: at.file, line: at.line, tCons: { lo, loInc: true }, fCons: null, restricts: false, x: null, t: nFacts++, f: null, mono: true };
    checks.push(c);
    if (!loOf.has(field)) loOf.set(field, []);
    loOf.get(field).push(c);
    return c;
  };
  // A field an increment by at least 1 raises can start from 0: the bound it reaches is 1 or more.
  const raisers = new Map();
  const raised = new Set();
  nodes.forEach((n, id) => {
    if (n.kind !== 'stmt' || !n.st || n.st.at == null) return;
    const inc = increments(n.st);
    if (!inc || inc.min < 1 || inc.sizeError) return;
    raisers.set(id, inc);
    for (const f of inc.fields) raised.add(f);
  });
  for (const a of assigns) {
    const v = numberOf(a.value);
    const cap = intCap(a.field);
    if (cap == null || v == null || !Number.isInteger(v) || v < (raised.has(a.field) ? 0 : 1) || v > cap) continue;
    if ((a.n.st.targets || []).some((t) => { const o = resolve(t); return o && o !== a.field && overlaps(o, a.field); })) continue;
    (a.n.genStmt ||= []).push(newLo(a.field, v, a.n.st).t);
  }
  // An increment by at least m turns "at least k" into "at least k + m", where the sum fits the field.
  // The fields a statement only ever lowers, by a constant, and by how much at most.
  const decrements = (st) => {
    const seg = segOf(st);
    let fields = [];
    let max = 0;
    const amount = (t) => { const v = t && (t.t === 'word' || t.t === 'num') ? numberOf(constValue([t])) : null; return v != null && Number.isInteger(v) && v >= 0 ? v : null; };
    if (st.verb === 'SUBTRACT') {
      const from = seg.findIndex((t) => WORD(t, 'FROM'));
      if (from < 1 || seg.some((t) => WORD(t, 'GIVING') || WORD(t, 'CORRESPONDING') || WORD(t, 'CORR'))) return null;
      for (const t of seg.slice(0, from)) { const v = amount(t); if (v == null) return null; max += v; }
      const end = seg.findIndex((t, i) => i > from && PHRASE_AT(t));
      if (seg.slice(from + 1, end < 0 ? seg.length : end).some((t) => t.t === 'sep')) return null;
      fields = (st.targets || []).map((t) => resolve(t));
    } else if (st.verb === 'SET') {
      const down = seg.findIndex((t) => WORD(t, 'DOWN'));
      if (down < 1 || !WORD(seg[down + 1], 'BY') || seg.length !== down + 3 || seg.slice(0, down).some((t) => t.t !== 'word')) return null;
      max = amount(seg[down + 2]);
      if (max == null) return null;
      fields = (st.targets || []).map((t) => resolve(t));
    } else if (st.verb === 'COMPUTE') {
      const eq = seg.findIndex((t) => t.t === 'op' && t.v === '=');
      const lhs = seg.slice(0, eq).filter((t) => !WORD(t, 'ROUNDED'));
      const end = seg.findIndex((t, i) => i > eq && PHRASE_AT(t));
      const rhs = seg.slice(eq + 1, end < 0 ? seg.length : end);
      if (eq < 1 || lhs.length !== 1 || lhs[0].t !== 'word' || rhs.length !== 3 || rhs[1].t !== 'op' || rhs[1].v !== '-') return null;
      const target = resolve(lhs[0]);
      if (rhs[0].t !== 'word' || resolve(rhs[0]) !== target) return null;
      max = amount(rhs[2]);
      if (max == null) return null;
      fields = [target];
    } else return null;
    fields = [...new Set(fields.filter((f) => intCap(f) != null))];
    return fields.length ? { fields, max } : null;
  };
  const lifted = new Map();
  for (const [id, inc] of raisers) {
    const list = [];
    for (const field of inc.fields) {
      const pairs = [];
      for (const c of [...(loOf.get(field) || []), ...tallies.filter((t) => t.field === field)]) {
        const lo = c.tCons.lo + inc.min;
        if (lo < 1) continue;
        if (lo <= intCap(field)) pairs.push([c.t, newLo(field, lo, nodes[id].st).t]);
      }
      if (pairs.length) list.push({ field, max: inc.max, pairs });
    }
    if (list.length) lifted.set(id, list);
  }
  // A VARYING counter is at least what it starts at inside the loop: a constant FROM sets it at the
  // head, and a FROM naming a field that is at least k sets it to k, where that field held it.
  const stepped = new Map();
  const derived = new Map();
  for (let more = true; more;) {
    more = false;
    for (const { head, step, loops } of loopHeads) {
      loops.forEach((loop, idx) => {
        const field = loop.counter ? resolve(loop.counter) : null;
        const cap = intCap(field);
        const by = loop.by ? (loop.by.length === 1 ? addend(loop.by[0]) : null) : 1;
        if (cap == null || by == null) return;
        const at = { file: loop.counter.file, line: loop.counter.line };
        const from = numberOf(constValue(loop.from || []));
        if (from != null) {
          const key = `${head}|${idx}`;
          if (derived.has(key) || !Number.isInteger(from) || from < 1 || from > cap) return;
          const c = newLo(field, from, at);
          derived.set(key, c);
          nodes[head].genStmt = [...(nodes[head].genStmt || []), c.t];
          if (idx === 0) stepped.set(step, { field, max: by });
          else if (!loop.until.some((t) => { const v = numberOf(constValue([t])); return v != null && v >= cap; })) nodes[step].genStmt = [...(nodes[step].genStmt || []), c.t];
          more = true;
          return;
        }
        const src = idx === 0 && loop.from && loop.from.length === 1 && loop.from[0].t === 'word' ? resolve(loop.from[0]) : null;
        const srcCap = intCap(src);
        if (srcCap == null || srcCap > cap) return;
        for (const c of loOf.get(src) || []) {
          const key = `${head}|${idx}|${c.tCons.lo}`;
          let d = derived.get(key);
          if (!d) {
            d = newLo(field, c.tCons.lo, at);
            derived.set(key, d);
            stepped.set(step, { field, max: by });
            more = true;
          }
          const pair = `${head}|${c.t}>${d.t}`;
          if (derived.has(pair)) continue;
          derived.set(pair, true);
          (nodes[head].implies ||= []).push([c.t, d.t, true]);
          more = true;
        }
      });
    }
  }

  // A bound an expression gives a field through another field, X <= G + 1, is a bound only where a
  // check has bounded G: "X <= G + 1 held" and "G <= 100 held" together give X <= 101. The first
  // fact dies with a write to X or G, the second with a write to G, and the result with a write to X,
  // so the pair is joined at whichever of the two checks comes last.
  const outcomeAt = new Map();
  for (const node of nodes) if (node.kind === 'outcome') outcomeAt.set(`${node.test}|${node.value}`, node);
  // A backward scan for the last byte past the spaces, VARYING I FROM the field's length BY -1 UNTIL
  // I < 1 OR F(I:1) > SPACE, leaves I from 1 to that length where F > SPACES held as it began: a
  // field that compares above spaces has a byte above a space, under any collating sequence, and the
  // scan meets it before 0. The witness dies with a write to F or to anything its subscript reads.
  const keptOnStep = new Map();
  const isSpaces = (toks) => toks.length === 1 && (WORD(toks[0], 'SPACE') || WORD(toks[0], 'SPACES') || (toks[0].t === 'lit' && !toks[0].prefix && /^ +$/.test(String(toks[0].v))));
  const textOf = (toks) => toks.map((t) => (t.t === 'word' ? t.u : String(t.v))).join(' ');
  // A whole alphanumeric item or table element, with the fields its subscript reads.
  const scanned = (toks) => {
    const base = toks[0] && toks[0].t === 'word' ? resolve(toks[0]) : null;
    if (!base || base.index || base.level === 88 || base.size == null || categoryOf(base)?.k !== 'A' || variableLength(base)) return null;
    let i = 1;
    while (i + 1 < toks.length && (WORD(toks[i], 'OF') || WORD(toks[i], 'IN')) && toks[i + 1].t === 'word') i += 2;
    const reads = [];
    if (i < toks.length) {
      if (toks[i].v !== '(' || toks[toks.length - 1].v !== ')') return null;
      let depth = 0;
      for (let j = i; j < toks.length; j++) {
        const t = toks[j];
        if (t.v === ':') return null;
        if (t.v === '(' || t.v === ')') { depth += t.v === '(' ? 1 : -1; if (!depth && j < toks.length - 1) return null; continue; }
        const f = t.t === 'word' ? resolve(t) : null;
        if (f) reads.push(f.level === 88 && f.parent ? f.parent : f);
      }
    }
    return { base, reads };
  };
  // What an outcome says is above spaces (`above`) or only not all spaces.
  const notBlank = (tree, outcome, out = []) => {
    if (tree.k === 'not') return notBlank(tree.a, !outcome, out);
    if ((tree.k === 'and' && outcome) || (tree.k === 'or' && !outcome)) { notBlank(tree.a, outcome, out); notBlank(tree.b, outcome, out); return out; }
    if (tree.k !== 'rel') return out;
    const op = outcome ? tree.op : NEGATE[tree.op];
    if (isSpaces(tree.right) && (op === '>' || op === '<>')) out.push({ toks: tree.left, above: op === '>' });
    else if (isSpaces(tree.left) && (op === '<' || op === '<>')) out.push({ toks: tree.right, above: op === '<' });
    return out;
  };
  const scans = [];
  for (const { head, step, test, testAfter, body, loops } of loopHeads) {
    if (testAfter || !body || loops.length !== 1 || !body.every((el) => el.k === 'stmt' && el.st.verb === 'CONTINUE')) continue;
    const loop = loops[0];
    const counter = loop.counter ? resolve(loop.counter) : null;
    const cap = intCap(counter);
    const tree = nodes[test].tree;
    if (cap == null || !tree || tree.k !== 'or' || !loop.by || loop.by.map((t) => t.v).join('') !== '-1') continue;
    const from = loop.from || [];
    let start = numberOf(constValue(from));
    if (start == null && WORD(from[0], 'LENGTH') && WORD(from[1], 'OF')) start = scanned(from.slice(2))?.base.size ?? null;
    if (start == null || !Number.isInteger(start) || start < 1 || start > cap) continue;
    const isCounter = (toks) => toks.length === 1 && toks[0].t === 'word' && resolve(toks[0]) === counter;
    const done = (r) => r.k === 'rel' && isCounter(r.left) && (r.op === '<' ? numberOf(constValue(r.right)) === 1 : (r.op === '<=' || r.op === '=') && numberOf(constValue(r.right)) === 0);
    const probe = (r) => {
      if (r.k !== 'rel') return null;
      const [el, op] = isSpaces(r.right) ? [r.left, r.op] : isSpaces(r.left) ? [r.right, FLIP[r.op]] : [null, null];
      if (!el || (op !== '>' && op !== '<>') || el.length < 6) return null;
      const tail = el.slice(-5);
      if (tail[0].v !== '(' || !isCounter([tail[1]]) || tail[2].v !== ':' || numberOf(constValue([tail[3]])) !== 1 || tail[4].v !== ')') return null;
      const toks = el.slice(0, -5);
      const s = scanned(toks);
      return s && s.base.size === start ? { toks, above: op === '>' } : null;
    };
    const p = done(tree.a) ? probe(tree.b) : done(tree.b) ? probe(tree.a) : null;
    const exit = p && outcomeAt.get(`${test}|true`);
    if (exit) scans.push({ ...p, counter, start, exit, head, step, at: loop.counter });
  }
  // The scan's counter never passes its start: the step runs only once I < 1 has failed, so it
  // cannot wrap, and the body writes nothing.
  for (const s of scans) {
    const key = fieldKey(s.counter);
    noteField(key, s.counter);
    const h = { id: checks.length, key, field: s.counter, file: s.at.file, line: s.at.line, tCons: { hi: s.start, hiInc: true }, fCons: null, restricts: false, x: null, t: nFacts++, f: null };
    checks.push(h);
    nodes[s.head].genStmt = [...(nodes[s.head].genStmt || []), h.t];
    keptOnStep.set(s.step, [...(keptOnStep.get(s.step) || []), h.t]);
  }
  if (scans.length) {
    const witness = new Map();
    const bitFor = (toks, above) => {
      const k = `${above ? '>' : '<>'}|${textOf(toks)}`;
      if (witness.has(k)) return witness.get(k);
      const s = scanned(toks);
      const bit = nFacts++;
      for (const f of [s.base, ...s.reads]) {
        const key = fieldKey(f);
        noteField(key, f);
        checks.push({ pseudo: true, key, field: f, x: null, t: bit, f: null });
      }
      witness.set(k, bit);
      return bit;
    };
    const wanted = new Set(scans.map((s) => textOf(s.toks)));
    for (const id of tests) {
      const n = nodes[id];
      if (!n.tree) continue;
      for (const outcome of [true, false]) {
        for (const nb of notBlank(n.tree, outcome)) {
          if (!wanted.has(textOf(nb.toks)) || !scanned(nb.toks)) continue;
          n.gen[String(outcome)].push(bitFor(nb.toks, false));
          if (nb.above) n.gen[String(outcome)].push(bitFor(nb.toks, true));
        }
      }
    }
    for (const s of scans) {
      const bit = witness.get(`${s.above ? '>' : '<>'}|${textOf(s.toks)}`);
      if (bit == null) continue;
      const key = fieldKey(s.counter);
      noteField(key, s.counter);
      const y = { id: checks.length, key, field: s.counter, file: s.at.file, line: s.at.line, tCons: { numeric: true, lo: 1, loInc: true, hi: s.start, hiInc: true }, fCons: null, restricts: false, x: null, t: nFacts++, f: null, bounds: { lo: 1, hi: s.start } };
      checks.push(y);
      (s.exit.implies ||= []).push([bit, y.t]);
    }
  }
  const MAX_BOUNDS_PER_RELATION = 8;
  for (const c of [...checks]) {
    if (c.pseudo || c.test == null) continue;
    for (const outcome of [true, false]) {
      const bit = outcome ? c.rt : c.rf;
      const dep = bit != null ? (outcome ? c.tDep : c.fDep) : null;
      if (!dep) continue;
      const gKey = fieldKey(dep.g);
      const bounds = [];
      for (const u of checks) {
        if (u.pseudo || u.key !== gKey || u.bounds || u.assigned || u === c) continue;
        for (const [ubit, ucons, uoutcome] of [[u.t, u.tCons, true], [u.f, u.fCons, false]]) {
          if (ubit == null || !ucons || ucons.dep) continue;
          const r = asRange(ucons);
          const gv = dep.needs === 'hi' ? r.hi : r.lo;
          if (gv == null) continue;
          const value = dep.m * gv + dep.b;
          if (!Number.isFinite(value) || Math.abs(value) > EXPR_LIMIT) continue;
          bounds.push({ u, ubit, uoutcome, value, inc: dep.inc && r[`${dep.needs}Inc`] !== false });
        }
      }
      if (!bounds.length || bounds.length > MAX_BOUNDS_PER_RELATION) continue;
      noteField(gKey, dep.g);
      checks.push({ pseudo: true, key: gKey, field: dep.g, x: null, t: bit, f: null });
      for (const { u, ubit, uoutcome, value, inc } of bounds) {
        const y = { id: checks.length, key: c.key, field: c.field, file: c.file, line: c.line, tCons: { [dep.side]: value, [`${dep.side}Inc`]: inc }, fCons: null, restricts: false, x: null, t: nFacts++, f: null };
        checks.push(y);
        const here = outcomeAt.get(`${c.test}|${outcome}`);
        if (here) (here.implies ||= []).push([ubit, y.t]);
        const there = u.test != null ? outcomeAt.get(`${u.test}|${uoutcome}`) : null;
        if (there) (there.implies ||= []).push([bit, y.t]);
      }
    }
  }

  // ---- what an arithmetic statement leaves in an integer field ----
  // COMPUTE, ADD, SUBTRACT, MULTIPLY, DIVIDE and a MOVE of a field or function leave the receiving
  // field inside an interval worked out from what each operand can hold: its picture, the facts that
  // hold at the statement, the length of an item. The interval is a fact only where the result fits
  // the receiving field, so nothing was lost to truncation or overflow, and where no divisor can be
  // zero. Whatever the statement's operands needed to hold is what the fact needs to hold.
  const BINARY_USAGE = /^(COMP|COMP-4|COMP-5|BINARY)$/;
  const rangesOf = new Map();
  // The whole numbers an integer field can hold when read, and those a result may take to be stored whole.
  const rangeOfField = (f) => {
    if (!f || f.index || f.level === 88) return null;
    if (rangesOf.has(f)) return rangesOf.get(f);
    let out = null;
    const cat = categoryOf(f);
    const pic = pictureOf(f);
    if (cat && cat.k === 'N' && /^S?9+$/.test(pic)) {
      const D = 10n ** BigInt(cat.digits) - 1n;
      const signed = pic[0] === 'S';
      const digits = { lo: signed ? -D : 0n, hi: D };
      out = { hold: digits, fit: digits };
      if (BINARY_USAGE.test(String(f.effectiveUsage || 'DISPLAY').replace('COMPUTATIONAL', 'COMP'))) {
        if (f.size >= 1 && f.size <= 8) {
          const bits = BigInt(f.size * 8);
          const store = signed ? { lo: -(2n ** (bits - 1n)), hi: 2n ** (bits - 1n) - 1n } : { lo: 0n, hi: 2n ** bits - 1n };
          out = {
            hold: { lo: store.lo < digits.lo ? store.lo : digits.lo, hi: store.hi > digits.hi ? store.hi : digits.hi },
            fit: { lo: store.lo > digits.lo ? store.lo : digits.lo, hi: store.hi < digits.hi ? store.hi : digits.hi },
          };
        } else out = null;
      }
    }
    rangesOf.set(f, out);
    return out;
  };
  // The most bytes an item named by these tokens can be, as a subscripted element or as written.
  const sizeBound = (span) => {
    const f = span[0] && span[0].t === 'word' ? resolve(span[0]) : null;
    if (!f || f.index || f.level === 88 || f.size == null || !Number.isInteger(f.size)) return null;
    if (span.length === 1) return f.contributes || f.size;
    if (!WORD(span[1], 'OF') && span[1].v === '(' && span[span.length - 1].v === ')' && !span.some((t) => t.t === 'op' && t.v === ':')) {
      return (f.children || []).some((c) => c.level !== 88) ? Math.ceil(f.size / Math.max(1, f.occurs || 1)) : f.size;
    }
    return null;
  };
  const arithEnv = {
    field: (tok, subscripted) => {
      const f = tok.t === 'word' ? resolve(tok) : null;
      return rangeOfField(f) ? { k: 'field', f, tok, plain: !subscripted && !inTable(f) } : null;
    },
    sizeOf: sizeBound,
  };
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  // A check's outcome as whole-number ends, from a range or a set of numbers; null ends are open.
  const wholeEnds = (cons) => {
    const isNum = (v) => /^[+-]?\d+(\.\d+)?$/.test(v);
    if (cons.set && !(cons.set.size && [...cons.set].every(isNum))) return null;
    const r = cons.set ? asRange(cons) : cons;
    const end = (v, up, inc) => (v == null || Math.abs(v) >= Number.MAX_SAFE_INTEGER ? null : BigInt(up ? (inc ? Math.floor(v) : Math.ceil(v) - 1) : (inc ? Math.ceil(v) : Math.floor(v) + 1)));
    const lo = end(r.lo, false, r.loInc);
    const hi = end(r.hi, true, r.hiInc);
    return lo == null && hi == null ? null : { lo, hi };
  };
  let factsByKey = new Map();
  const indexFacts = () => {
    factsByKey = new Map();
    for (const c of checks) {
      if (c.pseudo || c.key == null || (!c.tCons && !c.fCons)) continue;
      if (!factsByKey.has(c.key)) factsByKey.set(c.key, []);
      factsByKey.get(c.key).push(c);
    }
  };
  // The facts held where the statement being read runs, from the last analysis; none on the first pass.
  let heldBits = null;
  // What a field can hold, and the facts that say so: its picture, or a constant, or the tightest
  // lower and upper end among the facts that hold here.
  const leafCands = (leaf) => {
    const r = rangeOfField(leaf.f);
    const base = { needs: [], lo: r.hold.lo, hi: r.hold.hi };
    if (!leaf.plain) return [base];
    const cv = leaf.tok ? numberOf(constValue([leaf.tok])) : null;
    if (cv != null && Number.isInteger(cv)) return [{ needs: [], lo: BigInt(cv), hi: BigInt(cv) }];
    if (!heldBits) return [base];
    let lo = null;
    let hi = null;
    for (const c of factsByKey.get(fieldKey(leaf.f)) || []) {
      for (const [bit, cons] of [[c.t, c.tCons], [c.f, c.fCons]]) {
        if (bit == null || !cons || !hasFact(heldBits, bit)) continue;
        const e = wholeEnds(cons);
        if (!e) continue;
        if (e.lo != null && e.lo > (lo ? lo.v : base.lo)) lo = { bit, v: e.lo };
        if (e.hi != null && e.hi < (hi ? hi.v : base.hi)) hi = { bit, v: e.hi };
      }
    }
    const needs = [...new Set([lo && lo.bit, hi && hi.bit].filter((x) => x != null))].sort((x, y) => x - y);
    const from = lo ? lo.v : base.lo;
    const to = hi ? hi.v : base.hi;
    return needs.length && from <= to ? [base, { needs, lo: from, hi: to }] : [base];
  };
  // A fact "the field holds a whole number from lo to hi" (either end may be open), one per field and interval.
  const derivedOf = new Map();
  const arithBudget = () => nodes.length * Math.ceil((nFacts + 64) / 32) * 4 <= FACT_BUDGET_BYTES / 2;
  const derivedFact = (field, lo, hi, at) => {
    if (lo != null && (lo > MAX_SAFE || lo < -MAX_SAFE)) lo = null;
    if (hi != null && (hi > MAX_SAFE || hi < -MAX_SAFE)) hi = null;
    if (lo == null && hi == null) return null;
    // Each end is a fact of its own, so that routes which reach it by different statements meet at the looser.
    if (lo != null && hi != null) { derivedFact(field, lo, null, at); derivedFact(field, null, hi, at); }
    const id = `${lo ?? ''}|${hi ?? ''}`;
    if (!derivedOf.has(field)) derivedOf.set(field, new Map());
    const mine = derivedOf.get(field);
    if (mine.has(id)) return mine.get(id);
    if (!arithBudget()) return null;
    const key = fieldKey(field);
    noteField(key, field);
    const bounds = { ...(lo != null ? { lo: Number(lo) } : {}), ...(hi != null ? { hi: Number(hi) } : {}) };
    const tCons = { numeric: true, ...(lo != null ? { lo: Number(lo), loInc: true } : {}), ...(hi != null ? { hi: Number(hi), hiInc: true } : {}) };
    const c = { id: checks.length, key, field, file: at.file, line: at.line, tCons, fCons: null, restricts: false, x: null, t: nFacts++, f: null, bounds, derived: true };
    checks.push(c);
    mine.set(id, c);
    return c;
  };
  const derivedSeen = new Set();
  const rules = [];
  // Whatever holds after `n` when the facts in `needs` hold before it; with none needed, whenever it runs.
  const derive = (n, needs, fact, bucket = null) => {
    const id = `${n.id}|${bucket}|${needs.join(',')}|${fact.t}`;
    if (derivedSeen.has(id)) return false;
    derivedSeen.add(id);
    rules.push({ n, needs, fact, bucket });
    return true;
  };
  // An interval implies every looser interval the model holds about its field, so a route that reached a
  // tighter one and a route that reached a looser one still meet at the looser. A check the program made
  // is not among them: the interval is what the data holds, not a test that ran.
  const withLooser = (fact) => {
    const out = [fact.t];
    const own = fact.bounds;
    for (const c of factsByKey.get(fact.key) || []) {
      if (c === fact || !c.derived) continue;
      for (const [bit, cons] of [[c.t, c.tCons], [c.f, c.fCons]]) {
        if (bit == null || !cons) continue;
        const e = wholeEnds(cons);
        if (!e) continue;
        if ((e.lo == null || (own.lo != null && BigInt(own.lo) >= e.lo)) && (e.hi == null || (own.hi != null && BigInt(own.hi) <= e.hi))) out.push(bit);
      }
    }
    return out;
  };
  // The derived intervals that hold every whole number from lo to hi, an open end holding nothing.
  const containing = (key, lo, hi) => {
    const out = [];
    for (const c of factsByKey.get(key) || []) {
      if (!c.derived) continue;
      const e = wholeEnds(c.tCons);
      if (e && (e.lo == null || (lo != null && e.lo <= lo)) && (e.hi == null || (hi != null && e.hi >= hi))) out.push(c.t);
    }
    return out;
  };
  const expandRules = () => {
    indexFacts();
    for (const n of nodes) { n.derive = undefined; n.genArith = undefined; n.genArithOn = undefined; }
    for (const r of rules) {
      const bits = withLooser(r.fact);
      const at = r.bucket == null ? r.n : nodes[r.n.test];
      if (!r.needs.length) {
        if (r.bucket == null) (at.genArith ||= []).push(...bits);
        else ((at.genArithOn ||= { true: [], false: [] })[r.bucket]).push(...bits);
      } else (r.n.derive ||= []).push({ needs: r.needs, to: bits });
    }
    // A constant moved, and a check's outcome, are values too: routes that reached an interval by
    // arithmetic and routes that reached it by a move or a test meet at it.
    for (const a of assigns) {
      const v = numberOf(a.value);
      if (v == null || !Number.isInteger(v)) continue;
      const bits = containing(fieldKey(a.field), BigInt(v), BigInt(v));
      if (bits.length) (a.n.genArith ||= []).push(...bits);
    }
    for (const id of tests) {
      const n = nodes[id];
      for (const c of n.checks || []) {
        for (const [cons, bucket] of [[c.tCons, 'true'], [c.fCons, 'false']]) {
          if (!cons || (cons.set && cons.set.size)) continue;
          const e = wholeEnds(cons);
          if (!e || (e.lo == null && e.hi == null)) continue;
          const bits = containing(c.key, e.lo, e.hi);
          if (bits.length) ((n.genArithOn ||= { true: [], false: [] })[bucket]).push(...bits);
        }
      }
    }
  };

  const ARITH_VERBS = new Set(['COMPUTE', 'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'MOVE']);
  const between = (seg, from, to) => seg.slice(from, to < 0 ? seg.length : to);
  const idxOf = (seg, word) => seg.findIndex((t) => WORD(t, word));
  // A statement as a tree per receiving field; null where its words are not ones the model reads.
  const readArith = (st) => {
    let seg = segOf(st);
    const cut = seg.findIndex((t) => t.t === 'word' && (t.u === 'ON' || t.u === 'NOT' || t.u === 'SIZE' || t.u === `END-${st.verb}`));
    if (cut >= 0) seg = seg.slice(0, cut);
    if (seg.some((t) => WORD(t, 'CORRESPONDING') || WORD(t, 'CORR') || WORD(t, 'REMAINDER'))) return null;
    const operands = (toks, count) => {
      const p = parser(toks, arithEnv);
      const out = [];
      while (!p.done()) out.push(p.primary());
      if (!out.length || (count && out.length !== count)) throw parser;
      return out;
    };
    const sum = (list) => list.reduce((a, b) => ({ k: 'bin', op: '+', a, b }));
    // Receiving names with ROUNDED; anything else, including a subscript, still writes but is not followed.
    const receivers = (toks) => {
      const out = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (WORD(t, 'ROUNDED')) { if (!out.length) throw parser; out[out.length - 1].rounded = true; if (WORD(toks[i + 1], 'MODE')) i += WORD(toks[i + 2], 'IS') ? 3 : 2; continue; }
        if (t.t !== 'word') throw parser;
        const f = resolve(t);
        out.push({ tok: t, f: f && !f.index && f.level !== 88 ? f : null, rounded: false, sub: toks[i + 1] && toks[i + 1].v === '(' });
        if (toks[i + 1] && toks[i + 1].v === '(') { const close = closeIn(toks, i + 1); if (close < 0) throw parser; i = close; }
      }
      if (!out.length) throw parser;
      return out;
    };
    const closeIn = (toks, i) => { let d = 0; for (let j = i; j < toks.length; j++) { if (toks[j].v === '(') d++; else if (toks[j].v === ')' && --d === 0) return j; } return -1; };
    const own = (r) => arithEnv.field(r.tok, false);
    const per = (targets, make) => targets.map((r) => (r.sub || !r.f ? null : make(r)));
    return attempt(() => {
      let targets;
      let trees;
      switch (st.verb) {
        case 'COMPUTE': {
          const eq = seg.findIndex((t) => t.t === 'op' && t.v === '=');
          if (eq < 1) return null;
          targets = receivers(seg.slice(0, eq));
          const p = parser(seg.slice(eq + 1), arithEnv);
          const e = p.expr();
          if (!p.done()) return null;
          trees = per(targets, () => e);
          break;
        }
        case 'ADD': {
          const g = idxOf(seg, 'GIVING');
          if (g < 0) {
            const to = idxOf(seg, 'TO');
            if (to < 1) return null;
            const ops = operands(seg.slice(0, to));
            targets = receivers(seg.slice(to + 1));
            trees = per(targets, (r) => { const l = own(r); return l ? sum([...ops, l]) : null; });
          } else {
            const ops = operands(seg.slice(0, g).filter((t) => !WORD(t, 'TO')));
            targets = receivers(seg.slice(g + 1));
            trees = per(targets, () => sum(ops));
          }
          break;
        }
        case 'SUBTRACT': {
          const from = idxOf(seg, 'FROM');
          const g = idxOf(seg, 'GIVING');
          if (from < 1) return null;
          const subs = sum(operands(seg.slice(0, from)));
          if (g < 0) {
            targets = receivers(seg.slice(from + 1));
            trees = per(targets, (r) => { const l = own(r); return l ? { k: 'bin', op: '-', a: l, b: subs } : null; });
          } else {
            const [minuend] = operands(between(seg, from + 1, g), 1);
            targets = receivers(seg.slice(g + 1));
            trees = per(targets, () => ({ k: 'bin', op: '-', a: minuend, b: subs }));
          }
          break;
        }
        case 'MULTIPLY': {
          const by = idxOf(seg, 'BY');
          const g = idxOf(seg, 'GIVING');
          if (by < 1) return null;
          const [a] = operands(seg.slice(0, by), 1);
          if (g < 0) {
            targets = receivers(seg.slice(by + 1));
            trees = per(targets, (r) => { const l = own(r); return l ? { k: 'bin', op: '*', a: l, b: a } : null; });
          } else {
            const [b] = operands(between(seg, by + 1, g), 1);
            targets = receivers(seg.slice(g + 1));
            trees = per(targets, () => ({ k: 'bin', op: '*', a, b }));
          }
          break;
        }
        case 'DIVIDE': {
          const into = idxOf(seg, 'INTO');
          const by = idxOf(seg, 'BY');
          const g = idxOf(seg, 'GIVING');
          if (into > 0 && by < 0) {
            const [d] = operands(seg.slice(0, into), 1);
            if (g < 0) {
              targets = receivers(seg.slice(into + 1));
              trees = per(targets, (r) => { const l = own(r); return l ? { k: 'bin', op: '/', a: l, b: d } : null; });
            } else {
              const [n] = operands(between(seg, into + 1, g), 1);
              targets = receivers(seg.slice(g + 1));
              trees = per(targets, () => ({ k: 'bin', op: '/', a: n, b: d }));
            }
          } else if (by > 0 && into < 0 && g > by) {
            const [n] = operands(seg.slice(0, by), 1);
            const [d] = operands(between(seg, by + 1, g), 1);
            targets = receivers(seg.slice(g + 1));
            trees = per(targets, () => ({ k: 'bin', op: '/', a: n, b: d }));
          } else return null;
          break;
        }
        case 'MOVE': {
          const to = idxOf(seg, 'TO');
          if (to < 1) return null;
          const p = parser(seg.slice(0, to), arithEnv);
          const e = p.primary();
          if (!p.done() || (e.k !== 'field' && e.k !== 'range' && e.k !== 'mod')) return null;
          targets = receivers(seg.slice(to + 1));
          trees = per(targets, () => e);
          break;
        }
        default: return null;
      }
      // Several receivers taking turns: what one takes is no longer what the next reads.
      if (targets.length > 1) {
        const written = targets.map((r) => r.f).filter(Boolean);
        if (written.some((w, i) => written.some((v, j) => i !== j && overlaps(w, v)))) return null;
        for (const tree of trees) for (const l of tree ? leaves(tree) : []) if (written.some((w) => overlaps(w, l.f))) return null;
      }
      return { targets, trees };
    });
  };

  const arith = [];
  try {
    for (const n of nodes) {
      if (n.kind !== 'stmt' || !n.st || n.st.at == null || !ARITH_VERBS.has(n.st.verb)) continue;
      const read = readArith(n.st);
      if (read && read.trees.some(Boolean)) arith.push({ n, ...read });
    }
  } catch {
    arith.length = 0;
  }

  // A condition's requirements that hold whichever way the rest of it went: the relations it makes true.
  const relationsOf = (tree, outcome, out = []) => {
    switch (tree.k) {
      case 'not': return relationsOf(tree.a, !outcome, out);
      case 'and': if (outcome) { relationsOf(tree.a, true, out); relationsOf(tree.b, true, out); } return out;
      case 'or': if (!outcome) { relationsOf(tree.a, false, out); relationsOf(tree.b, false, out); } return out;
      case 'rel': out.push({ rel: tree, pol: outcome }); return out;
      default: return out;
    }
  };
  const ORDERING = new Set(['<', '<=', '>', '>=']);
  // Relations between two integer fields: the ordering tests whose sides are both plain fields.
  const relations = new Map();
  const collectRelations = (tree, test) => {
    if (tree.k === 'rel') {
      if (!ORDERING.has(tree.op) || relations.has(tree)) return;
      const f = fieldOf(tree.left);
      const g = fieldOf(tree.right);
      if (!f || !g || f === g || inTable(f) || inTable(g) || !rangeOfField(f) || !rangeOfField(g)) return;
      if (constValue(tree.left) != null || constValue(tree.right) != null) return;
      relations.set(tree, { f, g, op: tree.op, tokF: tree.left[0], tokG: tree.right[0], test, entries: { true: new Map(), false: new Map() } });
    } else for (const s of [tree.a, tree.b]) if (s) collectRelations(s, test);
  };
  try {
    for (const id of tests) { const t = nodes[id].tree; if (t) collectRelations(t, id); }
  } catch {
    relations.clear();
  }

  // The fields that matter: those an index reads, and those that flow into them through the
  // statements above and the relations between fields.
  const relevant = new Set();
  for (const st of prog.statements) for (const x of st.indexes || []) { const it = x.tok && x.tok.t === 'word' ? resolve(x.tok) : null; if (it && !it.index) relevant.add(it); }
  for (const it of prog.items) {
    if (!it.dependingOn) continue;
    const c = resolve({ t: 'word', u: String(it.dependingOn).toUpperCase(), v: it.dependingOn });
    if (c && !c.index) relevant.add(c);
  }
  for (let more = relevant.size > 0; more;) {
    more = false;
    const before = relevant.size;
    for (const a of arith) if (a.targets.some((r) => r.f && relevant.has(r.f))) for (const tree of a.trees) for (const l of tree ? leaves(tree) : []) relevant.add(l.f);
    for (const r of relations.values()) if (relevant.has(r.f) || relevant.has(r.g)) { relevant.add(r.f); relevant.add(r.g); }
    // A loop condition that bounds a relevant counter through another field makes that field relevant.
    for (const c of checks) { if (c.pseudo || !c.field || !relevant.has(c.field)) continue; for (const d of [c.tDep, c.fDep]) if (d?.g) relevant.add(d.g); }
    more = relevant.size > before;
  }

  // One pass over the statements and relations, reading each against the facts `prev` holds at it. True if it added anything.
  const arithRound = (prev) => {
    if (!relevant.size || !(arith.length || relations.size)) return false;
    // Each further pass runs the whole analysis again, so a program too large for that is left with what one pass gives.
    if (prev && nodes.length * Math.ceil(nFacts / 32) > ARITH_WORK) return false;
    let grew = false;
    try {
    indexFacts();
    // A check's outcome as an interval of its own, which arithmetic's intervals can widen into at a join.
    for (const id of tests) {
      for (const c of nodes[id].checks || []) {
        if (!relevant.has(c.field) || !rangeOfField(c.field) || inTable(c.field)) continue;
        for (const cons of [c.tCons, c.fCons]) {
          if (!cons || (cons.set && cons.set.size)) continue;
          const e = wholeEnds(cons);
          if (!e || (e.lo == null && e.hi == null)) continue;
          const had = derivedOf.get(c.field)?.size || 0;
          derivedFact(c.field, e.lo, e.hi, nodes[id].at || nodes[id].st);
          if ((derivedOf.get(c.field)?.size || 0) > had) grew = true;
        }
      }
    }
    for (const a of arith) {
      a.trees.forEach((tree, i) => {
        const r = a.targets[i];
        if (!tree || !r.f || !rangeOfField(r.f) || inTable(r.f) || !relevant.has(r.f)) return;
        const fit = rangeOfField(r.f).fit;
        heldBits = prev ? prev.get(a.n.id) || null : null;
        for (const c of candidates(tree, leafCands, 64)) {
          const s = storedRange(c.iv, r.rounded);
          if (s.lo < fit.lo || s.hi > fit.hi || (s.lo === fit.lo && s.hi === fit.hi)) continue;
          const fact = derivedFact(r.f, s.lo, s.hi, a.n.st);
          if (fact && derive(a.n, c.needs, fact)) grew = true;
        }
      });
    }
    for (const rel of relations.values()) {
      if (!relevant.has(rel.f) && !relevant.has(rel.g)) continue;
      const at = nodes[rel.test].at || nodes[rel.test].st;
      heldBits = prev ? prev.get(rel.test) || null : null;
      for (const pol of [true, false]) {
        const eff = pol ? rel.op : NEGATE[rel.op];
        for (const [tgt, src, tok, op] of [[rel.f, rel.g, rel.tokG, eff], [rel.g, rel.f, rel.tokF, FLIP[eff]]]) {
          const hold = rangeOfField(tgt).hold;
          for (const c of leafCands({ f: src, tok, plain: true })) {
            let lo = null;
            let hi = null;
            if (op === '<') hi = c.hi - 1n; else if (op === '<=') hi = c.hi; else if (op === '>') lo = c.lo + 1n; else lo = c.lo;
            if (lo != null && lo <= hold.lo) lo = null;
            if (hi != null && hi >= hold.hi) hi = null;
            if ((lo == null && hi == null) || (hi != null && hi < hold.lo) || (lo != null && lo > hold.hi)) continue;
            const fact = derivedFact(tgt, lo, hi, at);
            const id = fact && `${fact.t}|${c.needs}`;
            if (fact && !rel.entries[pol].has(id)) { rel.entries[pol].set(id, { needs: c.needs, fact }); grew = true; }
          }
        }
      }
    }
    // A bound over an expression in one other field, X <= G - 1, takes the interval G holds at the test.
    for (const c of checks) {
      if (c.pseudo || c.test == null || !relevant.has(c.field) || !rangeOfField(c.field) || inTable(c.field)) continue;
      for (const o of [true, false]) {
        const dep = o ? c.tDep : c.fDep;
        const at = dep && outcomeAt.get(`${c.test}|${o}`);
        if (!at || !rangeOfField(dep.g) || inTable(dep.g) || !Number.isInteger(dep.m) || !Number.isInteger(dep.b)) continue;
        const hold = rangeOfField(c.field).hold;
        heldBits = prev ? prev.get(c.test) || null : null;
        for (const cand of leafCands({ f: dep.g, tok: null, plain: true })) {
          const v = BigInt(dep.m) * (dep.needs === 'hi' ? cand.hi : cand.lo) + BigInt(dep.b);
          let lo = null, hi = null;
          if (dep.side === 'hi') hi = dep.inc ? v : v - 1n; else lo = dep.inc ? v : v + 1n;
          if (lo != null && lo <= hold.lo) lo = null;
          if (hi != null && hi >= hold.hi) hi = null;
          if ((lo == null && hi == null) || (hi != null && hi < hold.lo) || (lo != null && lo > hold.hi)) continue;
          const fact = derivedFact(c.field, lo, hi, at.st || nodes[c.test].at || nodes[c.test].st);
          if (fact && derive(at, cand.needs, fact, String(o))) grew = true;
        }
      }
    }
    // A relation holds after the outcome of its test that makes it true, and the fields it bounds hold
    // what the other side could hold.
    for (const id of tests) {
      const n = nodes[id];
      if (!n.tree) continue;
      for (const o of [true, false]) {
        const at = outcomeAt.get(`${id}|${o}`);
        if (!at) continue;
        for (const { rel, pol } of relationsOf(n.tree, o)) {
          const rec = relations.get(rel);
          if (rec) for (const e of rec.entries[pol].values()) if (derive(at, e.needs, e.fact, String(o))) grew = true;
        }
      }
    }
    } catch {
      // Whatever went wrong, the statements keep the facts they had.
        grew = false;
    }
    heldBits = null;
    return grew;
  };
  arithRound(null);
  // At least one fact, so the analysis runs, and a statement it never reaches has no facts at all.
  nFacts ||= 1;
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
  let words = 0;
  let facts = new Map();
  let partial = false;
  // The analysis proper, run again whenever arithmetic has added facts.
  const analyse = () => {
  words = Math.ceil(nFacts / 32);
  for (const n of nodes) { n.kill = undefined; n.keeps = undefined; n.genS = undefined; n.genArithOn = undefined; }
  expandRules();
  // Every node holds a bitset of every fact, several times over, so the cost is their product. A
  // 426,000-line generated program passed an 8 GB heap here, and running out of heap cannot be
  // caught. Past the budget the program is left unordered, which callers already handle.
  if (nodes.length * words * 4 > FACT_BUDGET_BYTES) throw new Error(`${nodes.length} statements by ${nFacts} facts is past the ordering budget`);

  // What a write kills: every fact about a field whose bytes it overlaps.
  const factsOfKey = new Map();
  for (const c of checks) {
    const list = factsOfKey.get(c.key) || [];
    for (const f of [c.x, c.t, c.f, c.rt, c.rf]) if (f != null) list.push(f);
    factsOfKey.set(c.key, list);
  }
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
  // The facts that say a field is bounded above from a value that leaves room for `max` more.
  const roomFacts = new Map();
  const roomFor = (field, max) => {
    let out = roomFacts.get(field)?.get(max);
    if (out) return out;
    out = [];
    const cap = intCap(field);
    for (const c of checks) {
      if (c.key !== field || c.mono || c.pseudo) continue;
      for (const [bit, cons] of [[c.t, c.tCons], [c.f, c.fCons]]) {
        const r = bit != null && cons ? asRange(cons) : null;
        if (!r || r.hi == null) continue;
        if ((r.hiInc ? Math.floor(r.hi) : Math.ceil(r.hi) - 1) + max <= cap) out.push(bit);
      }
    }
    if (!roomFacts.has(field)) roomFacts.set(field, new Map());
    roomFacts.get(field).set(max, out);
    return out;
  };
  // What a write does not kill: the lower bounds of a field it only raises, where nothing else it
  // writes shares the field's bytes.
  const keepAcross = (n, list) => {
    const wrote = writtenBy(n);
    for (const { field, max, sizeError } of list) {
      const mine = loOf.get(field);
      if (!mine || wrote.some((w) => w !== field && overlaps(w, field))) continue;
      const guards = sizeError ? null : roomFor(field, max);
      if (guards && !guards.length) continue;
      const bits = new Uint32Array(words);
      for (const c of mine) bits[c.t >>> 5] |= 1 << (c.t & 31);
      (n.keeps ||= []).push({ bits, guards });
    }
  };
  nodes.forEach((n, id) => {
    if (!n.kill) return;
    if (n.kind === 'stmt' && n.st && n.st.at != null) {
      const inc = increments(n.st);
      if (inc) keepAcross(n, inc.fields.map((field) => ({ field, max: inc.max, sizeError: inc.sizeError })));
      for (const { field, max, pairs } of lifted.get(id) || []) {
        const guards = roomFor(field, max);
        if (guards.length && !(n.st.targets || []).some((t) => { const o = resolve(t); return o && o !== field && overlaps(o, field); })) (n.lifts ||= []).push({ pairs, guards });
      }
    } else if (n.kind === 'step' && stepped.has(id)) {
      keepAcross(n, [{ ...stepped.get(id), sizeError: false }]);
    }
    // An upper bound survives a decrement that cannot go below 0: one where the field was at least the
    // amount before it, so nothing is stored as an absolute value or wraps.
    if (n.kind === 'stmt' && n.st && n.st.at != null) {
      const dec = decrements(n.st);
      const wrote = dec ? writtenBy(n) : [];
      for (const field of dec ? dec.fields : []) {
        if (wrote.some((w) => w !== field && overlaps(w, field))) continue;
        const key = fieldKey(field);
        const keep = [];
        const guards = [];
        for (const c of checks) {
          if (c.key !== key || c.pseudo) continue;
          for (const [bit, cons] of [[c.t, c.tCons], [c.f, c.fCons]]) {
            if (bit == null || !cons || cons.dep || (cons.set && cons.set.size)) continue;
            const r = asRange(cons);
            if (r.hi != null && r.lo == null) keep.push(bit);
            if (r.lo != null && (r.loInc ? r.lo : Math.floor(r.lo) + 1) >= dec.max) guards.push(bit);
          }
        }
        if (!keep.length || !guards.length) continue;
        const bits = new Uint32Array(words);
        for (const b of keep) bits[b >>> 5] |= 1 << (b & 31);
        (n.keeps ||= []).push({ bits, guards });
      }
    }
    if (n.kind === 'step' && keptOnStep.has(id)) {
      const bits = new Uint32Array(words);
      for (const b of keptOnStep.get(id)) bits[b >>> 5] |= 1 << (b & 31);
      (n.keeps ||= []).push({ bits, guards: null });
    }
  });

  // ---- must-analysis ----
  const ZERO = new Uint32Array(words);
  const ONES = new Uint32Array(words).fill(0xffffffff);
  const genBits = (list) => { const b = new Uint32Array(words); for (const x of list) b[x >>> 5] |= 1 << (x & 31); return b; };
  for (const id of tests) { const n = nodes[id]; n.genT = genBits([...n.gen.true, ...(n.genArithOn ? n.genArithOn.true : [])]); n.genF = genBits([...n.gen.false, ...(n.genArithOn ? n.genArithOn.false : [])]); }
  for (const n of nodes) if (n.genStmt || n.genArith) n.genS = genBits([...(n.genStmt || []), ...(n.genArith || [])]);
  const summaries = new Map();
  // Reverse postorder from every way in, so a forward analysis visits a node after what precedes it
  // and a join is revisited only when a loop brings something new.
  const order = new Int32Array(nodes.length).fill(-1);
  {
    const seen = new Uint8Array(nodes.length);
    const post = [];
    const roots = [mainPara.entry, ...[...extraEntries].map((n) => entryOf.get(n)).filter((x) => x != null), ...entryStatements,
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
  const killScratch = new Uint32Array(words);
  // A summary is joined to whatever enters the range, so it cannot assume a guard the caller lacks.
  let summarising = false;
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
      let kill = n.kill;
      if (n.keeps) {
        kill = killScratch;
        kill.set(n.kill);
        for (const k of n.keeps) {
          if (k.guards && (summarising || !k.guards.some((g) => input[g >>> 5] & (1 << (g & 31))))) continue;
          for (let i = 0; i < words; i++) kill[i] &= ~k.bits[i];
        }
      }
      if (out === input) { for (let i = 0; i < words; i++) scratch[i] = input[i] & ~kill[i]; out = scratch; }
      else for (let i = 0; i < words; i++) out[i] &= ~kill[i];
    }
    // What the statement assigns holds after it, over whatever the write took away.
    if (n.genS) {
      if (out === input) { for (let i = 0; i < words; i++) scratch[i] = input[i] | n.genS[i]; out = scratch; }
      else for (let i = 0; i < words; i++) out[i] |= n.genS[i];
    }
    // An increment that cannot wrap raises the lower bounds that held before it.
    if (n.lifts) {
      for (const { pairs, guards } of n.lifts) {
        if (summarising || !guards.some((g) => input[g >>> 5] & (1 << (g & 31)))) continue;
        for (const [from, to] of pairs) {
          if (!(input[from >>> 5] & (1 << (from & 31)))) continue;
          if (out === input) { scratch.set(input); out = scratch; }
          out[to >>> 5] |= 1 << (to & 31);
        }
      }
    }
    // What a statement or a test leaves in a field, where the facts its operands needed held before it.
    if (n.derive && !summarising) {
      for (const d of n.derive) {
        if (!d.needs.every((x) => input[x >>> 5] & (1 << (x & 31)))) continue;
        if (out === input) { scratch.set(input); out = scratch; }
        for (const t of d.to) out[t >>> 5] |= 1 << (t & 31);
      }
    }
    // A flag test's outcome turns what held before it into the bound the flag stood for.
    if (n.implies) {
      for (const [from, to, soft] of n.implies) {
        if (soft && summarising) continue;
        if (!(input[from >>> 5] & (1 << (from & 31)))) continue;
        if (out === input) { scratch.set(input); out = scratch; }
        out[to >>> 5] |= 1 << (to & 31);
      }
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
  summarising = true;
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
  // Stopped at a step limit, a summary may say a range never returns when it does.
  partial = pending.length > 0;
  summarising = false;

  // Contexts: the program's own entry and every extra one enter with nothing; a range enters with
  // what holds at every PERFORM of it that some context reaches. A context runs again only when what
  // enters it shrinks.
  const results = new Map();
  const rangeIn = new Map();
  const byKey = new Map(performed.map((r) => [r.key, r]));
  const work = [{ key: `main:${mainPara.entry}`, entry: mainPara.entry, stopAt: null }];
  for (const name of extraEntries) if (entryOf.has(name)) work.push({ key: `main:${entryOf.get(name)}`, entry: entryOf.get(name), stopAt: null });
  for (const id of entryStatements) work.push({ key: `main:${id}`, entry: id, stopAt: null });
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
  if (work.length || unknownLabel) partial = true;
  facts = new Map();
  for (const IN of results.values()) {
    for (const [id, bits] of IN) {
      const had = facts.get(id);
      if (had) meetInto(had, bits); else facts.set(id, bits.slice());
    }
  }
  };
  analyse();
  for (let round = 1; round < 12 && arithRound(facts); round++) { analyse(); }

  // What a run can reach, from the graph alone and with the contexts the facts use: code entered from
  // an entry runs on past the end of a paragraph, and a performed range stops at its end. A PERFORM
  // returns once anything reaches the end of its range, a handler's label inside it included, and
  // an EXIT PROGRAM with no CALL active carries on. Whatever the facts say, this is at least as much.
  const reached = new Uint8Array(nodes.length);
  const seenIn = new Map();
  const waitingOn = new Map();
  const todo = [];
  const toVisit = (ctx, id) => { if (id != null) todo.push(ctx, id); };
  toVisit(null, mainPara.entry);
  for (const name of extraEntries) toVisit(null, entryOf.get(name));
  for (const id of entryStatements) toVisit(null, id);
  while (todo.length) {
    const id = todo.pop();
    const ctx = todo.pop();
    let seen = seenIn.get(ctx);
    if (!seen) { seen = new Set(); seenIn.set(ctx, seen); }
    if (seen.has(id)) continue;
    seen.add(id);
    if (!reached[id]) { reached[id] = 1; for (const [c, s] of waitingOn.get(id) || []) toVisit(c, s); }
    if (ctx && id === ctx.end) continue;
    const n = nodes[id];
    if (n.kind === 'call' && n.range.entry != null && n.range.end != null) {
      const r = n.range;
      toVisit(r, r.entry);
      for (const s of n.succ) {
        if (reached[r.end]) toVisit(ctx, s);
        else { if (!waitingOn.has(r.end)) waitingOn.set(r.end, []); waitingOn.get(r.end).push([ctx, s]); }
      }
      continue;
    }
    for (const s of n.succ) toVisit(ctx, s);
    if (n.cont != null) toVisit(ctx, n.cont);
  }
  // Nothing known to have facts may be called unreached.
  for (const id of facts.keys()) if (id < nodes.length && !reached[id]) partial = true;
  if (altered) partial = true;

  // A name read inside a condition is read with what the operands evaluated before it said. Each
  // level of a condition is evaluated left to right and stops once its value is known, so a name
  // behind an AND is read only if the left side was true, behind an OR only if it was false. A name
  // several relations read is judged by the weakest. Each such place is a point of its own, past the
  // end of the graph, holding the test's facts and a few more numbered past the analysis's.
  const posOf = new Map();
  const places = [];
  let placeFacts = nFacts;
  // The tightest end of a field's value the facts `bits` hold, or its picture's.
  const boundAt = (g, needs, bits) => {
    const hold = rangeOfField(g)?.hold;
    let best = hold ? Number(needs === 'hi' ? hold.hi : hold.lo) : null;
    if (best != null && !Number.isFinite(best)) best = null;
    for (const c of checks) {
      if (c.pseudo || c.key !== fieldKey(g)) continue;
      for (const [bit, cons] of [[c.t, c.tCons], [c.f, c.fCons]]) {
        if (!cons || !hasFact(bits, bit)) continue;
        const e = wholeEnds(cons);
        const v = e && (needs === 'hi' ? e.hi : e.lo);
        if (v == null) continue;
        const n = Number(v);
        if (best == null || (needs === 'hi' ? n < best : n > best)) best = n;
      }
    }
    return best;
  };
  // A relation over an expression, X <= G - 1, read with what G held at the test.
  const resolveDeps = (map, bits) => {
    const out = new Map();
    for (const [key, c] of map) {
      const dep = c && c.dep;
      const g = dep ? boundAt(dep.g, dep.needs, bits) : null;
      if (g == null || !Number.isInteger(dep.m) || !Number.isInteger(dep.b)) { out.set(key, c); continue; }
      const v = dep.m * g + dep.b;
      const plain = plainCons(c) || {};
      const had = plain[dep.side];
      const tighter = had == null || (dep.side === 'hi' ? v < had : v > had);
      out.set(key, tighter ? { ...plain, [dep.side]: v, [`${dep.side}Inc`]: dep.inc } : plain);
    }
    return out;
  };
  for (const id of tests) {
    const n = nodes[id];
    if (!n.st || !n.st.indexes || !n.tree || n.evaluate || !(n.st.verb === 'IF' || n.loop)) continue;
    const until = n.loop ? new Set(n.cond) : null;
    const reads = readersOf(n.tree);
    for (const x of n.st.indexes) {
      if (until && !until.has(x.tok)) continue;
      const guards = reads.get(x.tok);
      let said = null;
      let ran = null;
      const chains = guards || [];
      for (const g of guards || []) {
        let cons = new Map();
        const r = new Map();
        const atTest = facts.get(id);
        for (const [sub, outcome] of g) { cons = meetMaps(cons, atTest ? resolveDeps(consOf(sub, outcome), atTest) : consOf(sub, outcome)); testedWhen(sub, outcome, r); }
        said = said ? joinMaps(said, cons) : cons;
        ran = ran ? new Map([...ran].filter(([k]) => r.has(k))) : r;
      }
      if (!said || (!said.size && !ran.size)) { if (until) posOf.set(x.tok, id); continue; }
      const mine = [];
      for (const key of new Set([...said.keys(), ...ran.keys()])) {
        const c = { id: checks.length, key, field: ran.get(key) || (typeof key === 'string' ? { index: key.slice(3) } : key), file: (n.at || n.st).file, line: (n.at || n.st).line,
          tCons: plainCons(said.get(key)), fCons: null, restricts: ran.has(key), f: null };
        c.x = c.restricts ? placeFacts++ : null;
        c.t = c.tCons ? placeFacts++ : null;
        checks.push(c);
        mine.push(c);
      }
      posOf.set(x.tok, nodes.length + places.length);
      places.push({ test: id, checks: mine, chains });
    }
  }
  const reachedAt = new Uint8Array(nodes.length + places.length);
  reachedAt.set(reached);
  places.forEach((p, i) => {
    reachedAt[nodes.length + i] = reached[p.test];
    const before = facts.get(p.test);
    if (!before) return;
    const bits = new Uint32Array(Math.max(words, Math.ceil(placeFacts / 32)));
    bits.set(before);
    for (const c of p.checks) for (const x of [c.x, c.t]) if (x != null) bits[x >>> 5] |= 1 << (x & 31);
    // What a relation before the name says of its fields, if every reading of the name is behind one.
    let related = null;
    for (const chain of p.chains) {
      const got = new Set();
      for (const [sub, outcome] of chain) {
        for (const { rel, pol } of relationsOf(sub, outcome)) {
          const rec = relations.get(rel);
          if (rec) for (const e of rec.entries[pol].values()) if (e.needs.every((x) => before[x >>> 5] & (1 << (x & 31)))) for (const x of withLooser(e.fact)) got.add(x);
        }
      }
      related = related ? new Set([...related].filter((x) => got.has(x))) : got;
    }
    for (const x of related || []) bits[x >>> 5] |= 1 << (x & 31);
    facts.set(nodes.length + i, bits);
  });

  // Plain data, no closures: a closure over this scope would keep the program's tokens alive after
  // the caller has let the parse tree go. A statement no context reaches has no facts, and credits
  // nothing. One `reached` does not mark does not run, unless `partial` says the analysis stopped
  // short or met a paragraph the parse did not find.
  return { loopBody, nodeOf, posOf, checks: checks.filter((c) => !c.pseudo), words, nodes: nodes.length, facts, reached: reachedAt, extraFacts, partial };
}

// For each token a condition reads, what each reading of it waits on: the operands to its left at
// every level, each with the outcome that lets evaluation go on.
function readersOf(tree) {
  const out = new Map();
  const note = (toks, guard) => { for (const t of toks) { const l = out.get(t); if (l) l.push(guard); else out.set(t, [guard]); } };
  const walk = (t, guard) => {
    switch (t.k) {
      case 'not': walk(t.a, guard); break;
      case 'and': walk(t.a, guard); walk(t.b, [...guard, [t.a, true]]); break;
      case 'or': walk(t.a, guard); walk(t.b, [...guard, [t.a, false]]); break;
      case 'rel': note(t.left, guard); note(t.right, guard); break;
      case 'class': case 'sign': case 'cond': note(t.subject, guard); break;
      default: break;
    }
  };
  walk(tree, []);
  return out;
}

export const hasFact = (bits, x) => x != null && bits != null && (bits[x >>> 5] & (1 << (x & 31))) !== 0;

// What a node's checks say at a point, given the facts that hold there: 2 when the value it holds is
// safe for the sink, 1 when a check has run on every route to the point, 0 when neither. The check
// named is the one that decided it: one whose outcome alone makes the value safe, if there is one.
// A bound the program's data sets rather than a check it made counts only where it keeps the index
// between 1 and the sink's `limit`.
// `offset` is the constant the sink adds to the index it names, T(I - 1): the outcomes are judged
// shifted by it, and a shifted top is held to the limit.
export function creditOf(checks, bits, sinkKind, limit = null, offset = 0, nonNeg = false) {
  let tested = null;
  let cons = null;
  let consBy = null;
  let alone = null;
  // An index a check tested is credited only where one outcome of it holds: where both reach the
  // use, the route on which the check failed reaches it too. An outcome that says something only
  // through arithmetic on other fields is not one that decided the index.
  const decided = (c) => !INDEX_SINKS.has(sinkKind) || (hasFact(bits, c.t) && !c.tCons.viaExpr) || (hasFact(bits, c.f) && !c.fCons.viaExpr);
  for (const c of checks) {
    if (c.bounds && !(limit != null && (c.bounds.lo == null ? c.bounds.hi != null : c.bounds.lo + offset >= 1) && (c.bounds.hi == null || c.bounds.hi + offset <= limit))) continue;
    if (hasFact(bits, c.x) && !tested && decided(c)) tested = c;
    for (const [bit, said] of [[c.t, c.tCons], [c.f, c.fCons]]) {
      if (!hasFact(bits, bit)) continue;
      cons = meet(cons, said);
      // A lower bound the program's data sets is shared by every place that sets it, so a test names the guard.
      if (!consBy || (consBy.mono && !c.mono)) consBy = c;
      if (!alone && stops(said, sinkKind)) alone = c;
    }
  }
  // A check whose outcome puts the index past either end is the use it should have prevented.
  const shifted = shift(cons, offset);
  // An unsigned index moved up by a constant starts at that constant, whatever the checks said of its bottom.
  if (shifted && offset > 0 && nonNeg && shifted.lo == null && !shifted.set) { shifted.lo = offset; shifted.loInc = true; }
  if (limit != null && outside(shifted, limit)) return { level: 0, check: null };
  // A bound above the table's or the field's size lets the index past its end, however the check was written.
  const pastEnd = !!shifted && limit != null && (sinkKind === 'subscript' || sinkKind === 'reference-modification') && overTop(shifted, limit);
  if (shifted && stops(shifted, sinkKind) && !pastEnd) return { level: 2, check: alone || consBy, cons: shifted };
  return tested ? { level: 1, check: tested } : { level: 0, check: null };
}

// Whether a constraint keeps an integer at or below `limit`, and at 1 or more where `fromOne`.
export function within(said, limit, fromOne = true) {
  if (!said) return false;
  const cons = asRange(said);
  return (!fromOne || atLeastOne(cons)) && cons.hi != null && (cons.hiInc ? cons.hi <= limit : cons.hi <= limit + 1);
}


// A constraint moved by a constant: the values it allows, each plus `by`.
function shift(said, by) {
  if (!said) return said;
  const out = { ...said };
  if (out.set) out.set = new Set([...out.set].map((v) => (/^[+-]?\d+(\.\d+)?$/.test(v) ? String(Number(v) + by) : v)));
  if (out.lo != null) out.lo += by;
  if (out.hi != null) out.hi += by;
  return out;
}
const overTop = (said, limit) => {
  const cons = asRange(said);
  return cons.hi != null && (cons.hi > limit + 1 || (cons.hi === limit + 1 && cons.hiInc));
};

const outside = (said, limit) => {
  if (!said) return false;
  const cons = asRange(said);
  return (cons.lo != null && (cons.lo > limit || (cons.lo === limit && !cons.loInc)))
    || (cons.hi != null && (cons.hi < 1 || (cons.hi === 1 && !cons.hiInc)));
};
