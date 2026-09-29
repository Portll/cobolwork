// SPDX-License-Identifier: AGPL-3.0-or-later
import { inScope, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { dirname, join } from 'node:path';
import { parseSource } from '../parser.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { buildControl, hasFact } from '../control.mjs';
import { parseCsd } from '../csd.mjs';


// `impact` says who can do what once the construct is present, so a reader can tell a defect they
// must act on from one that only wants a look; `remedy` is the standard fix, the same for every
// instance. Both ride with every finding of the rule (as ruleImpact/ruleRemedy).
export const CICS_RULES = {
  'cics-commarea-without-length-check': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-1284',
    text: 'A program reads its communication area without checking EIBCALEN',
    impact: 'A caller that passes no communication area, or a shorter one than the program reads, makes it read the storage past the area - and a transaction a terminal starts carries none',
    remedy: 'Test EIBCALEN before reading DFHCOMMAREA, and return when it is zero or shorter than the record the program expects',
  },
  'cics-transfer-to-variable-program': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-470',
    text: 'CICS transfers control to a program named by a variable',
    impact: 'Whoever controls the value the program name is read from chooses which program the region runs next',
    remedy: 'Transfer only to a name chosen from a fixed table of literals, never one taken from input, a record or the communication area',
  },
  'cics-commarea-length-exceeds-area': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-805',
    text: 'A CICS call passes a length longer than the area it passes',
    impact: 'The call reads past the passed area into the storage beside it on every invocation',
    remedy: 'Pass a LENGTH no greater than the passed area, or LENGTH OF that area',
  },
  'cics-commarea-length-exceeds-callee': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-805',
    text: 'A CICS call passes a length longer than the callee declares',
    impact: 'The callee reads past what the caller passed, into unrelated storage, on every call',
    remedy: "Pass a LENGTH no greater than the callee's declared communication area",
  },
  // A program that checks a password itself sends a successful sign-on somewhere. Another route to
  // the same place that does not pass the check - a PF key the sign-on screen does not expect, a
  // missing communication area - is a way in without a password (NetSPI, "Conquering CICS", way 6).
  // Which comparison is the sign-on is read from field names containing PWD, PSWD or PASSW, which is
  // a heuristic, and a sign-on that only sets a flag for a later test is not followed.
  'cics-signon-says-which-half-failed': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-204',
    text: 'A sign-on answers a bad user and a bad password differently',
    impact: 'The two failures carry different messages, so anyone can try a name and learn from the reply whether it exists - which turns guessing a password on one account into collecting the list of accounts first',
    remedy: 'Answer both failures with the same message and the same timing, as the programs that get this right do: one "Incorrect username or password" for either',
  },
  'cics-signon-bypassed': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-288',
    text: 'A route reaches the program a sign-on grants without passing the password check',
    impact: 'An entry the sign-on screen does not expect - an AID key it does not handle, a missing communication area - reaches the guarded program without the comparison, so it runs without a password',
    remedy: 'Reach the granted program only from the path where the password comparison succeeded; on any other entry, re-drive the sign-on',
  },
};

const PASSWORD = /PWD|PSWD|PASSW|PASSCODE|PASSPHRASE/;
// A message that says a sign-on failed. Which half it names is the whole question: a reply that
// distinguishes "no such user" from "wrong password" answers the attacker's first question for them.
const FAILED = /(not found|invalid|incorrect|unknown|wrong|does not exist|not match|mismatch|no such)/i;
// Which half the message names, by the words in it rather than by a regex: a word-boundary escape
// written into this file became a literal backspace byte once, and the regex then matched nothing.
const wordsOf = (text) => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const NAMES_USER = new Set(['user', 'userid', 'username', 'logon', 'signon']);
const NAMES_PASSWORD = new Set(['password', 'passwd', 'pwd', 'passcode', 'passphrase']);
const names = (set) => (text) => wordsOf(text).some((w) => set.has(w));
const namesUser = names(NAMES_USER);
const namesPassword = names(NAMES_PASSWORD);
export function tellsWhichHalfFailed(literals) {
  const failures = [...new Set(literals.map((l) => String(l).trim()))].filter((l) => l.length >= 6 && FAILED.test(l));
  const user = failures.filter((l) => namesUser(l) && !namesPassword(l));
  const password = failures.filter((l) => namesPassword(l) && !namesUser(l));
  if (!user.length || !password.length) return null;
  return { user: user[0], password: password[0] };
}
const FIGURATIVE = /^(SPACES?|ZEROS?|ZEROES|LOW-VALUES?|HIGH-VALUES?|QUOTES?|NULLS?)$/;
const RELOPS = new Set(['=', '<>']);
// A test that compares one password-named field with another field, which is what checking a password
// looks like: equal on one outcome, not equal on the other. A comparison with a literal or SPACES
// checks that one was typed, not that it is right.
export function signOnTest(test) {
  const toks = test.cond || (test.evaluate && test.evaluate.subjects.length === 1 && test.evaluate.subjects[0].u === 'TRUE' && test.evaluate.conds.length === 1 ? test.evaluate.conds[0] : null);
  if (!toks) return null;
  const at = toks.findIndex((t) => (t.t === 'op' && RELOPS.has(t.v)) || (t.t === 'word' && (t.u === 'EQUAL' || t.u === 'EQUALS')));
  if (at < 0 || toks.some((t) => t.t === 'word' && (t.u === 'AND' || t.u === 'OR'))) return null;
  const names = (side) => side.filter((t) => t.t === 'word' && !['NOT', 'IS', 'TO', 'OF', 'IN', 'EQUAL', 'EQUALS', 'FUNCTION', 'UPPER-CASE', 'LOWER-CASE', 'TRIM'].includes(t.u));
  const left = toks.slice(0, at), right = toks.slice(at + 1);
  const l = names(left), r = names(right);
  if (!l.length || !r.length || [...left, ...right].some((t) => t.t === 'lit' || t.t === 'num') || [...l, ...r].some((t) => FIGURATIVE.test(t.u))) return null;
  if (![...l, ...r].some((t) => PASSWORD.test(t.u))) return null;
  const negated = (toks[at].t === 'op' && toks[at].v === '<>') || left.some((t) => t.t === 'word' && t.u === 'NOT');
  return negated ? { false: 'SIGNON' } : { true: 'SIGNON' };
}


function execOptions(exec) {
  const opts = new Map();
  const words = [];
  const toks = exec.toks;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'word') continue;
    words.push(t.u);
    if (toks[i + 1] && toks[i + 1].t === 'sep' && toks[i + 1].v === '(') {
      const inner = [];
      let depth = 1;
      for (let k = i + 2; k < toks.length && depth > 0; k++) {
        if (toks[k].t === 'sep') { depth += toks[k].v === '(' ? 1 : -1; if (depth === 0) break; continue; }
        inner.push(toks[k]);
      }
      if (!opts.has(t.u)) opts.set(t.u, inner);
    }
  }
  return { opts, words };
}

const subtreeRead = (x) => x.directRefs > 0 || x.children.some(subtreeRead);

// Sizes come from the parser's data-division layout, which is graded against the compiler, so a
// length compared here is the length the compiler would compute.
//
// Everything this rule set needs from one program is taken while its parse tree is in hand, and the
// tree is then released. Holding every tree until the end is what the flow engine was refactored
// away from, and this set kept doing it: on a 100,000-program repository it exhausted an 8 GB heap
// and took a corpus run with it. What survives per program is an identifier, a communication area's
// size, one boolean, and a short list of transfers.
export function scanCics(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isProgram).filter(inScope(opts));
  // Identifier to the size of that program's DFHCOMMAREA, which is all a caller needs of a callee.
  const commareaSize = new Map();
  const summaries = [];
  const findings = [];
  const stats = { filesScanned: 0, cicsPrograms: 0, withCommarea: 0, commareaRead: 0, filesUnreadable: 0 };
  // Where a statement really is. One that came from a copybook carries the copybook's path and
  // line; reporting it at the program's path with the copybook's line points at an unrelated line.
  const where = (x, path) => ({ path: x.file ? relPath(root, x.file) : path, line: x.line || 1 });

  // The whole of what the second pass reads, computed once, while the tree is still here.
  function summarise(p, path) {
    const isSignOn = [...new Set([...p.refs.map(x => x.tok.u), ...p.execs.flatMap(e => e.toks.filter(t => t.t === 'word').map(t => t.u))])].some((w) => PASSWORD.test(w));
    const words = new Set([...p.refs.map(x => x.tok.u), ...p.execs.flatMap(e => e.toks.filter(t => t.t === 'word').map(t => t.u))]);
    const commarea = p.items.find(i => i.name === 'DFHCOMMAREA' && i.section === 'LINKAGE');
    // A variable naming the program usually holds one literal from its VALUE clause.
    const valueOf = (name) => {
      const it = p.items.find(i => i.name === name);
      const lit = it && it.values && it.values.find(v => v.t === 'lit');
      return lit ? String(lit.v).trim().toUpperCase() : null;
    };
    const transfers = [];
    for (const e of p.execs) {
      if (e.kind !== 'CICS') continue;
      const { opts: o, words: w } = execOptions(e);
      const verb = w[0];
      if (!['LINK', 'XCTL', 'START'].includes(verb)) continue;
      const pgm = (o.get('PROGRAM') || o.get('TRANSID') || [])[0];
      const areaTok = (o.get('COMMAREA') || o.get('FROM') || [])[0];
      const lenTok = (o.get('LENGTH') || [])[0];
      const declared = lenTok && (lenTok.t === 'num' || /^\d+$/.test(lenTok.v)) ? Number(lenTok.v) : null;
      const area = areaTok ? p.items.find(i => i.name === areaTok.u) : null;
      const variableProgram = pgm && pgm.t === 'word' ? pgm.u : null;
      transfers.push({
        at: where(e, path), verb,
        variableProgram,
        calleeName: pgm && pgm.t === 'lit' ? String(pgm.v).trim().toUpperCase() : null,
        callee: pgm && pgm.t === 'lit' ? String(pgm.v).trim().toUpperCase() : variableProgram ? valueOf(variableProgram) : null,
        areaName: areaTok ? areaTok.u : null,
        areaSize: area && area.size ? area.size : null,
        declared,
      });
    }
    // A program that points DFHCOMMAREA at storage of its own is not reading a caller's area.
    const tokens = (p.proc && p.proc.tokens) || [];
    const pointsItself = (p.statements || []).some((st) => {
      if (st.verb !== 'SET') return false;
      const w = tokens.slice(st.at + 1, st.end).filter((t) => t.t === 'word').map((t) => t.u);
      return w.some((x, k) => x === 'ADDRESS' && w[k + 1] === 'OF' && w[k + 2] === 'DFHCOMMAREA');
    });
    return {
      id: p.id, path,
      ownCics: p.execs.some((e) => e.kind === 'CICS'),
      pointsItself,
      commarea: commarea ? { ...where(commarea, path), size: commarea.size, read: subtreeRead(commarea) } : null,
      checksLength: words.has('EIBCALEN'),
      transfers,
      signOnBypasses: isSignOn ? signOnBypasses(p, path) : [],
      // Gated the same way: a program with no password-named field is not answering a sign-on,
      // and 'User not found' in a lookup screen is not telling anyone which accounts exist.
      tellsWhichHalf: isSignOn ? tellsWhichHalfFailed((p.statements || []).flatMap((st) => (st.literals || []).map((l) => (l && l.v !== undefined ? l.v : l)))) : null,
      lineOf: (text) => { const st = (p.statements || []).find((x) => (x.literals || []).some((l) => String(l && l.v !== undefined ? l.v : l).trim() === text)); return (st && st.line) || 1; },
    };
  }

  // Where a program sends control after its sign-on succeeds, and every other route there.
  function signOnBypasses(p, path) {
    let ctl;
    const byName = new Map();
    for (const it of p.items) if (!byName.has(it.name)) byName.set(it.name, it);
    const resolve = (tok) => (tok && tok.t === 'word' ? p.resolved.get(tok) || byName.get(tok.u) || null : null);
    try { ctl = buildControl(p, resolve, { extra: signOnTest }); } catch { return []; }
    const bit = ctl.extraFacts && ctl.extraFacts.get('SIGNON');
    if (bit == null) return [];
    const sends = [];
    for (const e of p.execs) {
      if (e.kind !== 'CICS') continue;
      const { opts: o, words: w } = execOptions(e);
      const opt = w[0] === 'XCTL' || w[0] === 'LINK' ? 'PROGRAM' : (w[0] === 'RETURN' || w[0] === 'START') ? 'TRANSID' : null;
      const t = opt && (o.get(opt) || [])[0];
      if (!t || t.t !== 'lit') continue;
      const target = `${opt === 'PROGRAM' ? '' : 'transaction '}${String(t.v).trim().toUpperCase()}`;
      if (target === p.id) continue;
      const bits = ctl.facts.get(ctl.nodeOf.get(e));
      if (!bits) continue;
      sends.push({ e, verb: w[0], target, signedOn: hasFact(bits, bit) });
    }
    const granted = new Set(sends.filter((x) => x.signedOn).map((x) => x.target));
    const aid = p.refs.some((r) => r.tok.u === 'EIBAID');
    return sends.filter((x) => !x.signedOn && granted.has(x.target)).map((x) => ({
      ...where(x.e, path),
      detail: `${p.id} runs EXEC CICS ${x.verb} to ${x.target} on a route that does not pass its password check, and ${x.target} is where a successful sign-on goes${aid ? '; the program dispatches on EIBAID, so a key the sign-on screen does not expect may take this route' : ''}`,
    }));
  }

  // Releasing each tree bounds what one program costs; it does not bound what a hundred thousand of
  // them cost together. The shared loop watches the heap and stops before V8 cannot collect, and
  // names every file it did not reach.
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    if (!/EXEC\s+CICS/i.test(src) && !/(?:^|[\s.])COPY\s+/i.test(src)) return src.length;
    let r;
    try {
      r = tree.parse(f, src);
    } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    if (!r.programs.some(p => p.execs.some(e => e.kind === 'CICS'))) return src.length;
    stats.filesScanned++;
    const path = relPath(root, f);
    for (const p of r.programs) {
      const sum = summarise(p, path);
      summaries.push(sum);
      if (p.id && !commareaSize.has(p.id)) commareaSize.set(p.id, sum.commarea ? sum.commarea.size : null);
    }
    r = null;                       // the tree is not needed past this point
    return src.length;
  }, { label: 'cics', maxBytes: opts.maxSourceBytes ?? Infinity });


  // What every caller in the tree passes each program, and which programs a transaction starts: a
  // terminal starts a transaction with no communication area at all.
  const callersOf = new Map();
  for (const s of summaries) for (const t of s.transfers) {
    if (t.verb === 'START' || !t.callee) continue;
    if (!callersOf.has(t.callee)) callersOf.set(t.callee, []);
    callersOf.get(t.callee).push(t.declared ?? t.areaSize ?? 0);
  }
  const startable = new Set();
  for (const f of tree.list().filter((p) => /\.csd$/i.test(p)).filter(inScope(opts))) {
    try { for (const t of parseCsd(tree.text(f).text).transactions.values()) if (t.program) startable.add(String(t.program).toUpperCase()); } catch { /* unreadable: nothing is known to start from it */ }
  }

  const reported = new Set();
  for (const s of summaries) {
    stats.cicsPrograms++;
    if (s.commarea) stats.withCommarea++;
    if (s.commarea && s.commarea.read) {
      stats.commareaRead++;
      // A zero-length area is a parse that read a program as a copybook, and a program with no
      // EXEC CICS of its own, or one that points DFHCOMMAREA at storage itself, has no caller's area.
      const key = `${s.commarea.path}|${s.commarea.line}|${s.id}`;
      if (!s.checksLength && s.ownCics && !s.pointsItself && s.commarea.size > 0 && !reported.has(key)) {
        reported.add(key);
        const callers = callersOf.get(String(s.id || '').toUpperCase()) || [];
        const covered = callers.length > 0 && callers.every((n) => n >= s.commarea.size) && !startable.has(String(s.id || '').toUpperCase());
        findings.push({
          rule: 'cics-commarea-without-length-check', path: s.commarea.path, line: s.commarea.line, program: s.id,
          ...(covered ? { sev: 'low' } : {}),
          detail: `${s.id} reads DFHCOMMAREA (${s.commarea.size} bytes declared) and never references EIBCALEN, so a shorter or absent communication area is read as if it were whole${covered ? `; every caller in the tree passes at least ${s.commarea.size} bytes, and no transaction starts it` : ''}`,
        });
      }
    }
    for (const b of s.signOnBypasses) findings.push({ rule: 'cics-signon-bypassed', path: b.path, line: b.line, program: s.id, detail: b.detail });
    if (s.tellsWhichHalf) {
      findings.push({
        rule: 'cics-signon-says-which-half-failed', path: s.path, line: s.lineOf(s.tellsWhichHalf.user), program: s.id,
        detail: `${s.id} answers a bad user with '${s.tellsWhichHalf.user}' and a bad password with '${s.tellsWhichHalf.password}', so the reply says which of the two was wrong`,
      });
    }
    for (const t of s.transfers) {
      if (t.variableProgram) {
        findings.push({ rule: 'cics-transfer-to-variable-program', ...t.at, program: s.id, detail: `${s.id} runs EXEC CICS ${t.verb} with the program name taken from ${t.variableProgram}` });
      }
      if (t.declared == null || !t.areaName) continue;
      if (t.areaSize && t.declared > t.areaSize) {
        findings.push({ rule: 'cics-commarea-length-exceeds-area', ...t.at, program: s.id, detail: `${s.id} passes LENGTH(${t.declared}) with ${t.areaName}, which is ${t.areaSize} bytes` });
      }
      const targetSize = t.calleeName ? commareaSize.get(t.calleeName) : undefined;
      if (targetSize && t.declared > targetSize) {
        findings.push({ rule: 'cics-commarea-length-exceeds-callee', ...t.at, program: s.id, detail: `${s.id} passes LENGTH(${t.declared}) to ${t.calleeName}, whose DFHCOMMAREA is ${targetSize} bytes` });
      }
    }
  }

  return report('cics', { rules: CICS_RULES, findings, stats, run });
}
