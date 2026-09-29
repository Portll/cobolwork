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
  const held = (a) => { if (!heldBy.has(a)) heldBy.set(a, heldAs(a.field, a.tok)); return heldBy.get(a); };
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
    if (w.level === 66 || f.level === 66) return true;
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
    // A flag test's outcome turns what held before it into the bound the flag stood for.
    if (n.implies) {
      for (const [from, to] of n.implies) {
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
  let partial = pending.length > 0;

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
  const facts = new Map();
  for (const IN of results.values()) {
    for (const [id, bits] of IN) {
      const had = facts.get(id);
      if (had) meetInto(had, bits); else facts.set(id, bits.slice());
    }
  }

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
      for (const g of guards || []) {
        let cons = new Map();
        const r = new Map();
        for (const [sub, outcome] of g) { cons = meetMaps(cons, consOf(sub, outcome)); testedWhen(sub, outcome, r); }
        said = said ? joinMaps(said, cons) : cons;
        ran = ran ? new Map([...ran].filter(([k]) => r.has(k))) : r;
      }
      if (!said || (!said.size && !ran.size)) { if (until) posOf.set(x.tok, id); continue; }
      const mine = [];
      for (const key of new Set([...said.keys(), ...ran.keys()])) {
        const c = { id: checks.length, key, field: ran.get(key) || (typeof key === 'string' ? { index: key.slice(3) } : key), file: (n.at || n.st).file, line: (n.at || n.st).line,
          tCons: said.get(key) || null, fCons: null, restricts: ran.has(key), f: null };
        c.x = c.restricts ? placeFacts++ : null;
        c.t = c.tCons ? placeFacts++ : null;
        checks.push(c);
        mine.push(c);
      }
      posOf.set(x.tok, nodes.length + places.length);
      places.push({ test: id, checks: mine });
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
    facts.set(nodes.length + i, bits);
  });

  // Plain data, no closures: a closure over this scope would keep the program's tokens alive after
  // the caller has let the parse tree go. A statement no context reaches has no facts, and credits
  // nothing. One `reached` does not mark does not run, unless `partial` says the analysis stopped
  // short or met a paragraph the parse did not find.
  return { nodeOf, posOf, checks: checks.filter((c) => !c.pseudo), words, nodes: nodes.length, facts, reached: reachedAt, extraFacts, partial };
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
export function creditOf(checks, bits, sinkKind, limit = null) {
  let tested = null;
  let cons = null;
  let consBy = null;
  let alone = null;
  // An index a check tested is credited only where one outcome of it holds: where both reach the
  // use, the route on which the check failed reaches it too.
  const decided = (c) => !INDEX_SINKS.has(sinkKind) || hasFact(bits, c.t) || hasFact(bits, c.f);
  for (const c of checks) {
    if (c.bounds && !(limit != null && c.bounds.lo >= 1 && c.bounds.hi <= limit)) continue;
    if (hasFact(bits, c.x) && !tested && decided(c)) tested = c;
    for (const [bit, said] of [[c.t, c.tCons], [c.f, c.fCons]]) {
      if (!hasFact(bits, bit)) continue;
      cons = meet(cons, said);
      consBy ||= c;
      if (!alone && stops(said, sinkKind)) alone = c;
    }
  }
  // A check whose outcome puts the index past either end is the use it should have prevented.
  if (limit != null && outside(cons, limit)) return { level: 0, check: null };
  if (cons && stops(cons, sinkKind)) return { level: 2, check: alone || consBy };
  return tested ? { level: 1, check: tested } : { level: 0, check: null };
}

const outside = (cons, limit) => !!cons && (
  (cons.lo != null && (cons.lo > limit || (cons.lo === limit && !cons.loInc)))
  || (cons.hi != null && (cons.hi < 1 || (cons.hi === 1 && !cons.hiInc))));
