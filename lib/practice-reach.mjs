// SPDX-License-Identifier: AGPL-3.0-or-later
// Which paragraphs and sections of a program a run can reach, at paragraph grain, and which
// statements follow an unconditional STOP RUN or GOBACK in their paragraph. The walk follows
// lib/control.mjs's reading of control: a run starts after END DECLARATIVES, a declarative is entered
// on its USE, a PERFORM enters its range and returns at the range's end, a GO TO keeps the range it
// is in, and a paragraph that can complete runs on into the next. A label any EXEC block names, an
// ALTER's target and a paragraph holding an ENTRY are entered from outside the walk.
import { execReading } from './exec-reading.mjs';

const WORD = (t, u) => !!t && t.t === 'word' && t.u === u;
// Verbs whose conditional phrases (AT END, INVALID KEY, ON SIZE ERROR, ON EXCEPTION, ...) hold
// statements that run only on that outcome; as control.mjs lists them.
const PHRASED = new Set(['READ', 'WRITE', 'REWRITE', 'DELETE', 'START', 'RETURN', 'CALL', 'COMPUTE', 'ADD', 'SUBTRACT',
  'MULTIPLY', 'DIVIDE', 'STRING', 'UNSTRING', 'ACCEPT', 'DISPLAY', 'INVOKE', 'JSON', 'XML', 'RECEIVE', 'SEND']);
const PHRASE_WORDS = new Set(['END', 'INVALID', 'EXCEPTION', 'OVERFLOW', 'END-OF-PAGE', 'EOP']);
const opensPhrase = (seg) => seg.some((x, i) => x.t === 'word' && (PHRASE_WORDS.has(x.u) || (x.u === 'ERROR' && WORD(seg[i - 1], 'SIZE'))));
const LOOP_START = new Set(['VARYING', 'UNTIL', 'WITH', 'TEST', 'FOREVER', 'TIMES']);
const ABEND_ROUTINE = /^(CEE3ABD|CEE3AB2|ILBOABN0|ILBOABN)$/i;
const isNumber = (t) => !!t && (t.t === 'num' || (t.t === 'word' && /^\d+$/.test(t.v)));
// States the walk may visit before it gives the program up as undecided.
const STATE_BUDGET = 4 * 1000 * 1000;

// The paragraphs of a program in source order. Index 0 is the unnamed run of statements before the
// first header, which is where a run starts when there are no declaratives.
function paragraphsOf(prog) {
  const { tokens, from, to } = prog.proc;
  const labelAt = new Map(prog.labels.filter((l) => l.at != null).map((l) => [l.at, l]));
  const paras = [];
  let section = null;
  let declarative = false;
  let cur = { name: null, kind: null, section: null, declarative: false, main: true, at: from, from, to, file: null, line: null };
  paras.push(cur);
  let main = 0;
  let sentenceStart = true;
  const close = (k) => { cur.to = k; };
  for (let k = from; k < to; k++) {
    const t = tokens[k];
    if (t.t === 'period') { sentenceStart = true; continue; }
    if (labelAt.has(k)) {
      const l = labelAt.get(k);
      close(k);
      if (l.kind === 'S') section = l.name;
      let body = k + 1;
      while (body < to && tokens[body].t !== 'period') body++;
      cur = { name: l.name, kind: l.kind, section: l.kind === 'S' ? l.name : section, declarative, at: k, from: body + 1, to, file: l.file, line: l.line, label: l };
      paras.push(cur);
      k = body;
      sentenceStart = true;
      continue;
    }
    if (sentenceStart && WORD(t, 'DECLARATIVES') && tokens[k + 1]?.t === 'period') { close(k); declarative = true; cur = { name: null, kind: null, section: null, declarative: true, at: k, from: k + 2, to, boundary: true }; paras.push(cur); continue; }
    if (WORD(t, 'END') && WORD(tokens[k + 1], 'DECLARATIVES')) {
      close(k);
      declarative = false;
      section = null;
      cur = { name: null, kind: null, section: null, declarative: false, main: true, at: k, from: k + 2, to, boundary: true };
      paras.push(cur);
      main = paras.length - 1;
      k++;
      continue;
    }
    sentenceStart = false;
  }
  return { paras, main };
}

// Where a paragraph's body stops completing: the first statement that ends the run or leaves the
// paragraph on every route, outside any IF, EVALUATE, SEARCH, inline PERFORM or conditional phrase,
// and not in a sentence a NEXT SENTENCE could skip. EXIT PARAGRAPH or EXIT SECTION before it means
// the paragraph can still complete. Returns { at, what, ends } or null.
function terminatorOf(prog, para, stmtAt, labelNames, cics, from = para.from) {
  const { tokens } = prog.proc;
  const stack = [];
  let skipped = false;
  let escapes = false;
  for (let k = from; k < para.to; k++) {
    const t = tokens[k];
    if (t.t === 'period') { stack.length = 0; skipped = false; continue; }
    if (t.t === 'exec') {
      if (!stack.length && !skipped && t.kind === 'CICS' && !escapes) {
        const w = execReading(t).words;
        if ((w[0] === 'RETURN' || w[0] === 'XCTL' || w[0] === 'ABEND') && !cics.ignores && !w.some((x) => x === 'RESP' || x === 'RESP2' || x === 'NOHANDLE')) return { at: k, what: `EXEC CICS ${w[0]}`, ends: true };
      }
      continue;
    }
    if (t.t !== 'word') continue;
    if (t.u === 'NEXT' && WORD(tokens[k + 1], 'SENTENCE')) { skipped = true; continue; }
    if (t.u.startsWith('END-')) {
      const want = t.u.slice(4);
      const at = stack.lastIndexOf(want);
      if (at >= 0) stack.length = at;
      continue;
    }
    const st = stmtAt.get(k);
    if (!st) continue;
    const seg = tokens.slice(st.at + 1, st.end);
    if (st.verb === 'EXIT' && (WORD(seg[0], 'PARAGRAPH') || WORD(seg[0], 'SECTION'))) { escapes = true; continue; }
    if (st.verb === 'IF' || st.verb === 'EVALUATE' || st.verb === 'SEARCH') { stack.push(st.verb); continue; }
    if (st.verb === 'PERFORM' && !(seg[0] && seg[0].t === 'word' && labelNames.has(seg[0].u))) { stack.push('PERFORM'); continue; }
    const top = !stack.length && !skipped && !escapes;
    if (top) {
      if (st.verb === 'GOBACK') return { at: k, what: 'GOBACK', ends: true };
      if (st.verb === 'STOP' && WORD(seg[0], 'RUN')) return { at: k, what: 'STOP RUN', ends: true };
      if (st.verb === 'GO') {
        const words = seg.filter((x) => x.t === 'word' && x.u !== 'TO');
        if (!words.some((w) => w.u === 'DEPENDING')) return { at: k, what: words.length ? `GO TO ${words[0].u}` : 'GO TO', ends: false };
      }
      if (st.verb === 'EXIT' && (WORD(seg[0], 'METHOD') || WORD(seg[0], 'FUNCTION'))) return { at: k, what: `EXIT ${seg[0].u}`, ends: true };
      if (st.verb === 'CALL' && seg[0] && seg[0].t === 'lit' && ABEND_ROUTINE.test(String(seg[0].v).trim())) return { at: k, what: `CALL '${String(seg[0].v).trim()}'`, ends: true };
    }
    if (PHRASED.has(st.verb) && opensPhrase(seg)) stack.push(st.verb);
  }
  return null;
}

// The procedure names a statement's tokens name from `at` on: a name, OF or IN and its section,
// and THRU and the last name of the range.
function procedureName(seg, i, labelNames) {
  const t = seg[i];
  if (!t || t.t !== 'word' || !labelNames.has(t.u)) return null;
  let k = i + 1;
  let of = null;
  if ((WORD(seg[k], 'OF') || WORD(seg[k], 'IN')) && seg[k + 1]) { of = seg[k + 1].u; k += 2; }
  let thru = null;
  if ((WORD(seg[k], 'THRU') || WORD(seg[k], 'THROUGH')) && seg[k + 1] && seg[k + 1].t === 'word') {
    thru = seg[k + 1].u;
    k += 2;
    if ((WORD(seg[k], 'OF') || WORD(seg[k], 'IN')) && seg[k + 1]) k += 2;
  }
  return { name: t.u, of, thru, next: k };
}

// Every paragraph of `prog` with whether a run reaches it, and the statements that follow an
// unconditional STOP RUN or GOBACK. `undecided` names why the walk could not be trusted, in which
// case nothing it says is a finding. EXIT PROGRAM carries on to the next statement, as it does with
// no CALL active: a program taking parameters may be run from JCL with its PARM.
export function reachOf(prog, isData = () => false) {
  if (!prog.proc) return { undecided: 'the program has no procedure division' };
  const { tokens } = prog.proc;
  const { paras, main } = paragraphsOf(prog);
  const labelNames = new Set(prog.labels.map((l) => l.name));
  const byName = new Map();
  paras.forEach((p, i) => { if (p.name) { if (!byName.has(p.name)) byName.set(p.name, []); byName.get(p.name).push(i); } });
  const stmtAt = new Map();
  for (const st of prog.statements) if (st.at != null && st.verb !== 'WHEN') stmtAt.set(st.at, st);
  const cicsWords = prog.execs.filter((e) => e.kind === 'CICS').map((e) => execReading(e).words);
  const cics = { ignores: cicsWords.some((w) => w[0] === 'IGNORE') };
  let undecided = null;
  const named = (name) => byName.get(name) || [];
  // A range ends at its last paragraph, or at the last paragraph of a section it names.
  const lastOf = (name) => {
    const at = named(name);
    if (!at.length) return -1;
    const i = at[at.length - 1];
    if (paras[i].kind !== 'S') return i;
    let j = i;
    while (j + 1 < paras.length && paras[j + 1].kind === 'P' && paras[j + 1].section === name) j++;
    return j;
  };

  const edges = paras.map(() => ({ performs: [], gotos: [], sectionExit: false }));
  const entries = new Set([main]);
  const entryAt = [];
  paras.forEach((p, i) => { if (p.declarative && p.name) entries.add(i); });
  const owner = (k) => { let lo = 0; let hi = paras.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >>> 1; if (paras[mid].at <= k) lo = mid; else hi = mid - 1; } return lo; };
  for (const st of prog.statements) {
    if (st.at == null || st.verb === 'WHEN') continue;
    const i = owner(st.at);
    const seg = tokens.slice(st.at + 1, st.end);
    const e = edges[i];
    if (st.verb === 'PERFORM') {
      const pn = procedureName(seg, 0, labelNames);
      if (pn) { e.performs.push({ name: pn.name, end: pn.thru || pn.name }); if (pn.thru && !labelNames.has(pn.thru)) undecided ||= `PERFORM ${pn.name} THRU ${pn.thru} names a paragraph the parse did not find`; continue; }
      const first = seg[0];
      if (first && first.t === 'word' && !LOOP_START.has(first.u) && !isNumber(first) && !isData(first.u) && !stmtAt.has(st.at + 1)) undecided ||= `PERFORM ${first.u} names neither a paragraph the parse found nor data`;
    } else if (st.verb === 'GO') {
      const words = seg.filter((x) => x.t === 'word' && x.u !== 'TO');
      const dep = words.findIndex((w) => w.u === 'DEPENDING');
      for (const w of dep >= 0 ? words.slice(0, dep) : words) {
        if (w.u === 'OF' || w.u === 'IN') continue;
        if (labelNames.has(w.u)) e.gotos.push(w.u); else undecided ||= `GO TO ${w.u} names a paragraph the parse did not find`;
      }
    } else if (st.verb === 'ALTER') {
      seg.forEach((x, k) => { if (k && WORD(seg[k - 1], 'TO') && x.t === 'word' && labelNames.has(x.u)) for (const j of named(x.u)) entries.add(j); });
    } else if (st.verb === 'SORT' || st.verb === 'MERGE') {
      seg.forEach((x, k) => {
        if (!WORD(x, 'PROCEDURE') || !(WORD(seg[k - 1], 'INPUT') || WORD(seg[k - 1], 'OUTPUT'))) return;
        const pn = procedureName(seg, WORD(seg[k + 1], 'IS') ? k + 2 : k + 1, labelNames);
        if (pn) e.performs.push({ name: pn.name, end: pn.thru || pn.name }); else undecided ||= `a ${st.verb} procedure names a paragraph the parse did not find`;
      });
    } else if (st.verb === 'ENTRY') {
      entries.add(i);
      entryAt.push([i, st.end]);
    } else if (st.verb === 'EXIT' && WORD(seg[0], 'SECTION')) {
      e.sectionExit = true;
    }
  }
  for (const ex of prog.execs) for (const w of execReading(ex).words) if (labelNames.has(w)) for (const j of named(w)) entries.add(j);

  const ends = paras.map((p) => terminatorOf(prog, p, stmtAt, labelNames, cics));
  // A run entered at an ENTRY after its paragraph's terminator runs on from there.
  for (const [i, at] of entryAt) if (!terminatorOf(prog, paras[i], stmtAt, labelNames, cics, at) && i + 1 < paras.length && !paras[i + 1].boundary) entries.add(i + 1);
  const sectionLast = (i) => { let j = i; const s = paras[i].section; if (!s) return i; while (j + 1 < paras.length && paras[j + 1].kind === 'P' && paras[j + 1].section === s) j++; return j; };

  const reached = new Uint8Array(paras.length);
  const seen = new Map();
  const todo = [];
  let states = 0;
  const visit = (i, end) => {
    if (i < 0 || i >= paras.length) return;
    let s = seen.get(end);
    if (!s) { s = new Uint8Array(paras.length); seen.set(end, s); }
    if (s[i]) return;
    s[i] = 1;
    todo.push(i, end);
  };
  for (const i of entries) visit(i, -1);
  while (todo.length) {
    if (++states > STATE_BUDGET) return { undecided: 'the program has more routes than the walk follows' };
    const end = todo.pop();
    const i = todo.pop();
    reached[i] = 1;
    const e = edges[i];
    for (const p of e.performs) { const last = lastOf(p.end); for (const j of named(p.name)) visit(j, last); }
    for (const g of e.gotos) for (const j of named(g)) visit(j, end);
    const fall = (from) => { if (end === from) return; const n = from + 1; if (n < paras.length && !paras[n].boundary) visit(n, end); };
    if (e.sectionExit) { const last = sectionLast(i); if (!(end >= i && end <= last)) fall(last); }
    if (!ends[i]) fall(i);
  }

  // Statements after an unconditional STOP RUN or GOBACK, up to the next header or ENTRY.
  const deadRuns = [];
  paras.forEach((p, i) => {
    const t = ends[i];
    if (!reached[i] || !t || !t.ends || !/^(STOP RUN|GOBACK)$/.test(t.what)) return;
    const after = [];
    for (let k = stmtAt.get(t.at)?.end ?? t.at + 1; k < p.to; k++) {
      const x = tokens[k];
      const st = stmtAt.get(k);
      if (st && st.verb === 'ENTRY') break;
      if (st) after.push({ line: st.line, file: st.file, what: st.verb });
      else if (x.t === 'exec') after.push({ line: x.line, file: x.file, what: `EXEC ${x.kind}` });
    }
    if (after.length) deadRuns.push({ para: p, ender: { what: t.what, line: tokens[t.at].line, file: tokens[t.at].file }, after });
  });

  return {
    undecided,
    paras: paras.map((p, i) => ({ ...p, reached: !!reached[i], ender: ends[i] ? { what: ends[i].what, line: tokens[ends[i].at].line } : null, entry: entries.has(i) })),
    deadRuns,
  };
}
