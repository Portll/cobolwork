// SPDX-License-Identifier: AGPL-3.0-or-later
// A program that carries on after something failed (build-gate.md §11a). Declaring a FILE STATUS,
// giving a CICS command RESP or NOHANDLE, and every EXEC SQL tell the runtime the program handles the
// failure itself, so nothing stops the run when the program does not look.
//
// Each statement that sets a status gets a fact of its own: it holds wherever the program is entered,
// the statement kills it, and a test of the status, or a CALL handed the status, makes it again. A
// statement that relies on the result - a read of what the setter wrote, or the next statement that
// sets the same status - where the fact does not hold is on a route from the setter that never
// looked. A MOVE into the status field is not the runtime setting it, so it kills nothing.
import { inScope, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { drive, loopOver } from '../kernel/shared-pass.mjs';
import { buildControl, hasFact, namesOf, fileStatusToken, ioFiles, setsSqlStatus, FILE_IO, SQL_STATUS } from '../control.mjs';
import { execReading } from '../exec-reading.mjs';

export const ERRORS_RULES = {
  'io-status-unchecked': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-252', measured: false,
    text: 'A file I/O statement\'s FILE STATUS is not tested before the program relies on it',
    impact: 'Declaring FILE STATUS stops an I/O error ending the run, so a failed open, read or write returns to the next statement and the program goes on with a record it never got or a file it never wrote',
    remedy: 'Test the FILE STATUS field after each I/O statement on every route, or declare a USE AFTER ERROR procedure for the file',
  },
  'sql-status-unchecked': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-252', measured: false,
    text: 'An EXEC SQL statement\'s SQLCODE is not tested before the program relies on it',
    impact: 'Db2 returns from every statement, failed or not, so a program that does not test SQLCODE goes on with host variables the statement never filled or a change it never made',
    remedy: 'Test SQLCODE or SQLSTATE after each statement on every route, or put WHENEVER SQLERROR GO TO before the statements it covers',
  },
  'cics-response-unchecked': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-252', measured: false,
    text: 'A CICS command given RESP or NOHANDLE is not tested before the program relies on it',
    impact: 'RESP and NOHANDLE turn off the abend CICS would have taken, so a command that failed returns as if it had worked and the program uses an area it never filled',
    remedy: 'Test the RESP field, or EIBRESP, after each such command on every route before using what it returns',
  },
};

const CICS_STATUS = new Set(['EIBRESP', 'EIBRESP2', 'EIBRCODE']);
const SQL_NAMES = new Set([...SQL_STATUS, 'SQLCA']);
// A failed RETURN or XCTL is the only way past it, so the statement after one is already the failure route.
const ENDS_ON_SUCCESS = new Set(['RETURN', 'XCTL', 'ABEND']);

const topOf = (it) => {
  let t = it;
  for (let hops = 0; t && (t.parent || t.redefinesItem) && hops < 64; hops++) t = t.parent || t.redefinesItem;
  return t;
};
const inside = (a, b) => { for (let x = a; x; x = x.parent) if (x === b) return true; return false; };
// Whether two items share storage: one holds the other, or they lie over the same bytes of a record.
const overlap = (a, b) => {
  if (!a || !b || a.index || b.index) return false;
  if (inside(a, b) || inside(b, a)) return true;
  const fa = a.level === 88 ? a.parent : a;
  const fb = b.level === 88 ? b.parent : b;
  if (!fa || !fb || topOf(fa) !== topOf(fb) || fa.offset == null || fb.offset == null || !fa.size || !fb.size) return false;
  return fa.offset < fb.offset + fb.size && fb.offset < fa.offset + fa.size;
};

// The USE AFTER ERROR or EXCEPTION declaratives of a program: the files they name, or every file
// where one names an open mode.
function declaredFiles(p) {
  const toks = (p.proc && p.proc.tokens) || [];
  const out = new Set();
  let all = false;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t !== 'word' || toks[i].u !== 'USE') continue;
    let j = i + 1;
    const words = [];
    for (; j < toks.length && toks[j].t !== 'period'; j++) if (toks[j].t === 'word') words.push(toks[j].u);
    if (!words.includes('ERROR') && !words.includes('EXCEPTION')) continue;
    const on = words.indexOf('ON');
    for (const w of on >= 0 ? words.slice(on + 1) : []) {
      if (['INPUT', 'OUTPUT', 'I-O', 'EXTEND'].includes(w)) all = true;
      else out.add(w);
    }
    i = j;
  }
  return { all, names: out };
}

// Every status-setting statement of one program, the facts that follow them, and the places that
// rely on each. Returns findings, or null where the program's order could not be read.
export function uncheckedStatuses(p, root, path) {
  const { resolve } = namesOf(p);
  const tokens = (p.proc && p.proc.tokens) || [];
  const where = (x) => ({ path: x.file ? relPath(root, x.file) : path, line: x.line || 1 });
  const word = (u) => ({ t: 'word', u, v: u });

  // Resources: a file with a FILE STATUS, Db2, or a CICS RESP field (EIB stands for NOHANDLE alone).
  const resources = new Map();
  const resource = (key, make) => { if (!resources.has(key)) resources.set(key, { key, setters: [], aliases: [], ...make() }); return resources.get(key); };
  const declared = declaredFiles(p);
  const fdOf = new Map((p.fds || []).map((fd) => [fd.name, fd]));
  for (const select of p.files || []) {
    const fd = fdOf.get(select.name);
    const tok = fileStatusToken(select);
    const status = tok ? resolve(tok) : null;
    if (!fd || !status || declared.all || declared.names.has(select.name)) continue;
    resource(`file:${select.name}`, () => ({ kind: 'io', name: select.name, fd, status: [status] }));
  }
  const ys = [];
  const setter = (r, node, wrote, label, at) => { const y = { id: `y${ys.length}`, r, node, wrote, label, at }; ys.push(y); r.setters.push(y); };
  for (const st of p.statements) {
    if (!FILE_IO.has(st.verb)) continue;
    for (const fd of ioFiles(st, tokens, resolve)) {
      const r = resources.get(`file:${fd.name}`);
      if (!r) continue;
      const into = st.verb === 'READ' ? (st.targets || []).map(resolve).filter((it) => it && !it.index) : [];
      setter(r, st, into, `${st.verb} of ${fd.name}`, st);
    }
  }
  let whenever = false;
  for (const e of p.execs) {
    const reading = execReading(e);
    const w = reading.words;
    if (e.kind === 'SQL') {
      if (w[0] === 'WHENEVER' && w[1] === 'SQLERROR') whenever = w[2] === 'GO' || w[2] === 'GOTO';
      if (whenever || !setsSqlStatus(e)) continue;
      const r = resource('sql', () => ({ kind: 'sql', status: SQL_STATUS.map((u) => resolve(word(u))).filter(Boolean) }));
      const wrote = (e.hostVariables || []).filter((h) => h.written).map((h) => resolve(h.tok)).filter(Boolean);
      setter(r, e, wrote, `EXEC SQL ${w[0] || ''}`.trim(), e);
    } else if (e.kind === 'CICS') {
      const resp = (reading.opts.get('RESP') || []).find((t) => t.t === 'word');
      if ((!resp && !w.includes('NOHANDLE')) || ENDS_ON_SUCCESS.has(w[0])) continue;
      const field = resp ? resolve(resp) : null;
      const r = field ? resource(`resp:${field.name}`, () => ({ kind: 'cics', status: [field] })) : resource('eib', () => ({ kind: 'cics', status: [] }));
      const wrote = [];
      for (const [option, args] of reading.opts) {
        if (option === 'RESP' || option === 'RESP2') continue;
        const d = reading.direction(option);
        if (d !== 'receives' && d !== 'both') continue;
        for (const t of args) { const it = t.t === 'word' ? resolve(t) : null; if (it && !it.index) wrote.push(it); }
      }
      setter(r, e, wrote, `EXEC CICS ${reading.verb || w[0] || ''}`.trim(), e);
    }
  }
  if (!ys.length) return [];

  // A MOVE of a status into another field makes a test of that field a test of the status.
  const isStatusOf = (r, tok, it) => {
    if (r.kind === 'sql' && SQL_NAMES.has(tok.u)) return true;
    if (r.kind === 'cics' && CICS_STATUS.has(tok.u)) return true;
    return !!it && (r.status.some((s) => overlap(it, s)) || r.aliases.some((a) => overlap(it, a)));
  };
  const all = [...resources.values()];
  for (const st of p.statements) {
    if (st.verb !== 'MOVE') continue;
    for (const r of all) {
      if (!st.sources.some((t) => isStatusOf(r, t, resolve(t)))) continue;
      for (const t of st.targets || []) { const it = resolve(t); if (it && !it.index) r.aliases.push(it); }
    }
  }
  const testedIn = (toks) => {
    const out = new Set();
    for (const t of toks) {
      if (t.t !== 'word') continue;
      const it = resolve(t);
      for (const r of all) if (isStatusOf(r, t, it)) out.add(r);
    }
    return out;
  };
  const keysOf = (rs) => [...rs].flatMap((r) => r.setters.map((y) => y.id));
  const callTests = new Map();
  for (const st of p.statements) if (st.verb === 'CALL') { const rs = testedIn(st.sources); if (rs.size) callTests.set(st, keysOf(rs)); }
  const kills = new Map(ys.map((y) => [y.node, []]));
  for (const y of ys) kills.get(y.node).push(y.id);

  let ctl;
  try {
    ctl = buildControl(p, resolve, {
      extra: (t) => {
        const toks = t.evaluate ? [...t.evaluate.subjects, ...t.evaluate.conds.flat()] : t.cond || [];
        const keys = keysOf(testedIn(toks));
        return keys.length ? { true: keys, false: keys } : null;
      },
      effects: ({ st, e }) => {
        const node = st || e;
        const kill = kills.get(node);
        const gen = st ? callTests.get(st) : null;
        return kill || gen ? { kill: kill || [], gen: gen || [] } : null;
      },
      entering: ys.map((y) => y.id),
    });
  } catch { return null; }
  if (ctl.partial) return null;
  const bitOf = new Map(ys.map((y) => [y, ctl.extraFacts.get(y.id)]));

  // The earliest place in the source each setter's result is relied on unchecked.
  const first = new Map();
  const earlier = (a, b) => (a.file || '') === (b.file || '') && a.line < b.line;
  const relyAt = (node, candidates) => {
    const id = ctl.nodeOf.get(node);
    const bits = id == null ? null : ctl.facts.get(id);
    if (!bits) return;
    for (const y of candidates) if ((!first.has(y) || earlier(node, first.get(y))) && !hasFact(bits, bitOf.get(y))) first.set(y, node);
  };
  // Who wrote what, by the record it lies in, so a read looks only at writers of its own record.
  const byRecord = new Map();
  const note = (it, entry) => { const t = topOf(it); if (!byRecord.has(t)) byRecord.set(t, []); byRecord.get(t).push(entry); };
  for (const r of all) if (r.kind === 'io') for (const rec of r.fd.records) note(rec, { r });
  for (const y of ys) for (const w of y.wrote) note(w, { y, w });
  const readers = (items, skip) => {
    const due = new Set();
    for (const it of items) {
      for (const e of byRecord.get(topOf(it)) || []) {
        if (e.r && !skip.has(e.r)) for (const y of e.r.setters) due.add(y);
        else if (e.y && !skip.has(e.y.r) && overlap(it, e.w)) due.add(e.y);
      }
    }
    return due;
  };
  for (const st of p.statements) {
    if (st.verb === 'WHEN') continue;
    const items = (st.sources || []).map(resolve).filter((it) => it && !it.index);
    const tests = st.verb === 'IF' || st.verb === 'EVALUATE' || st.verb === 'PERFORM' ? testedIn(st.sources || []) : new Set();
    const due = readers(items, tests);
    if (FILE_IO.has(st.verb)) {
      for (const fd of ioFiles(st, tokens, resolve)) { const r = resources.get(`file:${fd.name}`); if (r) for (const y of r.setters) due.add(y); }
    }
    if (due.size) relyAt(st, due);
  }
  for (const e of p.execs) {
    const reading = execReading(e);
    const items = e.kind === 'SQL' ? (e.hostVariables || []).filter((h) => !h.written).map((h) => resolve(h.tok)).filter(Boolean)
      : [...reading.opts].filter(([o]) => reading.direction(o) === 'sends' || o === 'FROM').flatMap(([, args]) => args.filter((t) => t.t === 'word').map(resolve)).filter((it) => it && !it.index);
    const due = readers(items, new Set());
    for (const r of all) {
      if ((r.kind === 'sql' && e.kind === 'SQL' && setsSqlStatus(e)) || (r.kind === 'cics' && e.kind === 'CICS')) for (const y of r.setters) due.add(y);
    }
    if (due.size) relyAt(e, due);
  }

  const RULE = { io: 'io-status-unchecked', sql: 'sql-status-unchecked', cics: 'cics-response-unchecked' };
  const out = [];
  for (const y of ys) {
    const z = first.get(y);
    if (!z) continue;
    const at = where(y.at);
    const zAt = where(z);
    const place = zAt.path === at.path ? `line ${zAt.line}` : `${zAt.path.split('/').pop()} line ${zAt.line}`;
    const what = y.r.kind === 'io' ? `its FILE STATUS ${y.r.status[0].name}` : y.r.kind === 'sql' ? 'SQLCODE' : y.r.status.length ? `its RESP field ${y.r.status[0].name}` : 'EIBRESP';
    out.push({ rule: RULE[y.r.kind], ...at, program: p.id, detail: `${y.label} sets ${what}, and a route from it reaches ${place} without testing it` });
  }
  return out;
}

export function* scanErrorsSteps(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isProgram).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, programsUnordered: 0 };

  const run = yield loopOver(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    stats.filesScanned++;
    if (!/\bSTATUS\b|EXEC\s+SQL|\bRESP\b|NOHANDLE/i.test(src)) return src.length;
    let r;
    try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    const path = relPath(root, f);
    for (const p of r.programs) {
      const found = uncheckedStatuses(p, root, path);
      if (found) findings.push(...found); else stats.programsUnordered++;
    }
    return src.length;
  }, { label: 'errors', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('errors', { rules: ERRORS_RULES, findings, stats, run });
}

export const scanErrors = (root, opts = {}) => drive(scanErrorsSteps(root, opts));
