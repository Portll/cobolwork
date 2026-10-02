// SPDX-License-Identifier: AGPL-3.0-or-later
// A PL/I source file as the program the flow engine reads (lib/dataflow.mjs summarise): data items
// with offsets and sizes from lib/pli/layout.mjs, statements as the names they read and write,
// external calls with their arguments, EXEC blocks as the engine's tokens, and the MAIN procedure's
// parameters. The engine itself is unchanged.
import { basename } from 'node:path';
import { readPli } from './lex.mjs';
import { readPliExpanded } from './include.mjs';
import { parseStatement } from './statements.mjs';
import { layout } from './layout.mjs';

// The token naming a reference: its last name at parenthesis depth 0.
function nameToken(ref) {
  let depth = 0;
  let last = null;
  for (const t of ref.toks) {
    if (t.t === 'op' && t.v === '(') depth++;
    else if (t.t === 'op' && t.v === ')') depth--;
    else if (depth === 0 && t.t === 'word') last = t;
  }
  return last;
}

// EXEC block tokens as lib/parser.mjs gives them: parentheses as separators, commas dropped, a
// period between two names joined.
function execTokens(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'op' && (t.v === '(' || t.v === ')')) out.push({ ...t, t: 'sep' });
    else if (t.t === 'op' && t.v === ',') continue;
    else if (t.t === 'op' && t.v === '.') out.push({ ...t, t: 'period', joined: !!(toks[k - 1]?.t === 'word' && toks[k + 1]?.t === 'word' && toks[k + 1].col === t.col + 1) });
    else out.push(t);
  }
  return out;
}

const ARITHMETIC_OPS = new Set(['+', '-', '*', '/', '**', 'prefix-', 'prefix+']);

// readMember(name, fromFile) -> { path, text } | null splices %INCLUDE members in; without it the
// directives stay as statements and what they would have declared is missing.
export function pliProgram(text, file, { readMember = null } = {}) {
  const read = readMember ? readPliExpanded(text, { file, readMember }) : readPli(text, { file });
  const statements = read.statements.map((st) => ({ st, r: parseStatement(st) }));
  const declared = [];
  for (const { st, r } of statements) if (r.status === 'parsed' && r.kind === 'DECLARE') declared.push(...r.node.items.map((it) => ({ ...it, file: st.file || file })));
  const { roots } = layout(declared);

  const items = [];
  const flatten = (node, parent) => {
    const item = {
      name: node.name, level: node.logical, parent, children: [], file: node.file || file, line: node.line, values: [],
      offset: node.offset, occurs: node.occurs || 1,
      size: node.children.length ? node.size * Math.max(1, node.occurs || 1) : node.size,
      attributes: node.attributes.map((a) => a.name), storage: node.storage || null,
    };
    items.push(item);
    for (const ch of node.children) item.children.push(flatten(ch, item));
    return item;
  };
  for (const r of roots) flatten(r, null);
  const byName = new Map();
  for (const it of items) { if (!byName.has(it.name)) byName.set(it.name, []); byName.get(it.name).push(it); }
  const builtin = new Set(items.filter((it) => it.attributes.includes('BUILTIN') || it.attributes.includes('GENERIC')).map((it) => it.name));

  // A qualified reference A.B.C names the C whose containing structures include B and then A; after
  // a locator, P->X.Y, only the part after the arrow qualifies the data.
  const resolved = new Map();
  const resolve = (ref) => {
    const qual = ref.path.slice(ref.locators.length ? ref.locators[ref.locators.length - 1] : 0);
    const cands = (byName.get(ref.name) || []).filter((it) => !builtin.has(it.name));
    const fits = cands.filter((it) => {
      let k = qual.length - 2;
      for (let a = it.parent; a && k >= 0; a = a.parent) if (a.name === qual[k]) k--;
      return k < 0;
    });
    const item = fits[0] || null;
    const tok = nameToken(ref);
    if (item && tok) resolved.set(tok, item);
    return item ? tok : null;
  };

  // The names an expression reads: references to declared data; a reference that names no declared
  // item and has arguments is a function, read through its arguments.
  // A subscript names a table element; SUBSTR's start and length bound a reference into its
  // first argument. Both are what the engine's subscript and reference-modification sinks read.
  const tableOf = (it) => { for (let a = it; a; a = a.parent) if ((a.occurs || 1) > 1) return a; return null; };
  const indexOf = (a) => {
    const t = a && a.tree;
    if (!t) return null;
    if (t.t === 'ref') { const tok = resolve(t); return tok ? { tok, offset: 0 } : null; }
    if ((t.op === '+' || t.op === '-') && t.args[0]?.t === 'ref' && t.args[1]?.t === 'num' && /^\d+$/.test(t.args[1].tok.v)) {
      const tok = resolve(t.args[0]);
      return tok ? { tok, offset: (t.op === '+' ? 1 : -1) * Number(t.args[1].tok.v) } : null;
    }
    return null;
  };
  const noteIndexes = (n, hostTok, indexes) => {
    if (!indexes) return;
    const item = resolved.get(hostTok);
    if (item && tableOf(item)) {
      for (const list of n.args) for (const a of list) { const x = indexOf(a); if (x) indexes.push({ host: hostTok, tok: x.tok, kind: 'subscript', ...(x.offset ? { offset: x.offset } : {}) }); }
    } else if (!item && n.name === 'SUBSTR' && n.args[0]?.[0]?.tree?.t === 'ref') {
      const host = resolve(n.args[0][0].tree);
      const [, from, len] = n.args[0].map(indexOf);
      if (host && from) indexes.push({ host, tok: from.tok, kind: 'refmod-offset', ...(from.offset ? { offset: from.offset } : {}) });
      if (host && len) indexes.push({ host, tok: len.tok, kind: 'refmod-length' });
    }
  };
  const reads = (expr, out = [], indexes = null) => {
    const walk = (n) => {
      if (!n) return;
      if (n.t === 'ref') {
        const tok = resolve(n);
        if (tok) out.push(tok);
        noteIndexes(n, tok, indexes);
        if (!tok) for (const list of n.args) for (const a of list) if (a.tree) walk(a.tree);
        for (const at of n.locators) { const p = byName.get(n.path[at - 1]); if (p) { const t = n.toks.find((x) => x.t === 'word' && x.u === n.path[at - 1]); if (t) { resolved.set(t, p[0]); out.push(t); } } }
      } else if (n.t === 'paren') walk(n.expr.tree);
      else if (n.t === 'lit' && n.factor) walk(n.factor.tree);
      else if (n.args) n.args.forEach(walk);
    };
    walk(expr.tree ?? expr);
    return out;
  };
  const hasOp = (tree, ops) => !!tree && (ops.has(tree.op) || (tree.args || []).some((a) => hasOp(a, ops)));

  const prog = { id: null, line: 1, file, items, resolved, statements: [], execs: [], calls: [], paramTokens: [], labels: [], proc: null, files: [], fds: [], accepts: [], unresolvedRefs: [] };
  const procs = new Map();
  for (const { st, r } of statements) {
    if (r.status !== 'parsed' || r.kind !== 'PROCEDURE') continue;
    procs.set(r.node.name, { node: r.node, st });
    if (!prog.id) {
      prog.id = r.node.name;
      prog.line = st.line;
    }
    if (r.node.options.some((o) => o.name === 'MAIN') && !prog.paramTokens.length) {
      for (const p of r.node.params) {
        const tok = st.toks.find((t) => t.t === 'word' && t.u === p);
        const item = (byName.get(p) || [])[0];
        if (tok && item) {
          resolved.set(tok, item);
          prog.paramTokens.push({ tok, mode: 'REFERENCE' });
          // A MAIN procedure's parameter is the PARM string, or the command line off z/OS.
          prog.accepts.push({ target: p, targetTok: tok, from: 'COMMAND-LINE', line: st.line, file: st.file || file });
        }
      }
    }
  }
  if (!prog.id) prog.id = basename(file).replace(/\.[^.]*$/, '').toUpperCase();

  const add = (st, verb, sources, targets, extra = {}) => prog.statements.push({ verb, sources, targets, file: st.file || file, line: st.line, ...extra });
  const visit = (st, r, top = true) => {
    if (r.status !== 'parsed' && r.status !== 'unbuilt') return;
    const n = r.node;
    if (!n) return;
    if (r.kind === 'ASSIGNMENT') {
      const indexes = [];
      const sources = reads(n.value, [], indexes);
      const targets = [];
      for (const t of n.targets) {
        const tok = resolve(t);
        noteIndexes(t, tok, indexes);
        if (tok) { targets.push(tok); continue; }
        // A pseudovariable such as SUBSTR(X, 1, 2) = ... writes its first argument.
        const first = t.args[0]?.[0];
        if (first?.tree?.t === 'ref') { const a = resolve(first.tree); if (a) targets.push(a); }
      }
      const verb = n.value.tree?.t === 'ref' ? 'MOVE' : hasOp(n.value.tree, new Set(['||'])) ? 'STRING' : hasOp(n.value.tree, ARITHMETIC_OPS) ? 'COMPUTE' : 'MOVE';
      add(st, verb, sources, targets, indexes.length ? { indexes } : {});
    } else if (r.kind === 'IF' || r.kind === 'WHEN' || (r.kind === 'DO' && (n.while || n.until))) {
      // A condition is what the engine credits as a check on the names it compares.
      const conds = r.kind === 'IF' ? [n.cond] : r.kind === 'WHEN' ? n.values : [n.while, n.until].filter(Boolean);
      const indexes = [];
      const sources = conds.flatMap((c) => reads(c, [], indexes));
      const ops = [];
      const walk = (t) => { if (!t) return; if (t.op) ops.push(t.op); (t.args || []).forEach(walk); if (t.t === 'paren') walk(t.expr.tree); };
      conds.forEach((c) => walk(c.tree));
      add(st, r.kind === 'WHEN' ? 'WHEN' : 'IF', sources, [], { ops, ...(indexes.length ? { indexes } : {}) });
    } else if (r.kind === 'READ') {
      const into = n.options?.INTO;
      const recTok = into ? resolve(into) : null;
      add(st, 'READ', [], recTok ? [recTok] : []);
      // A PL/I file's DD name is its own name unless OPEN gives it a TITLE; the record it reads
      // into is what a job's DD for that name supplies.
      const fname = n.file?.name;
      if (fname && recTok) {
        let fd = prog.fds.find((x) => x.name === fname);
        if (!fd) { fd = { name: fname, records: [], file: st.file || file, line: st.line }; prog.fds.push(fd); prog.files.push({ name: fname, assign: { t: 'lit', v: fname }, file: st.file || file, line: st.line }); }
        const rec = resolved.get(recTok);
        if (rec && !fd.records.includes(rec)) fd.records.push(rec);
      }
    } else if (r.kind === 'WRITE' || r.kind === 'REWRITE') {
      const from = n.options?.FROM;
      add(st, 'WRITE', from ? [resolve(from)].filter(Boolean) : [], []);
    } else if (r.kind === 'CALL') {
      const internal = procs.get(n.name);
      const argToks = n.args.map((a) => (a.tree?.t === 'ref' ? resolve(a.tree) : null));
      if (internal) {
        // Arguments pass by reference: an internal procedure's parameter is the argument's storage.
        internal.node.params.forEach((p, k) => {
          const pTok = internal.st.toks.find((t) => t.t === 'word' && t.u === p);
          const pItem = (byName.get(p) || [])[0];
          if (!pTok || !pItem || !argToks[k]) return;
          resolved.set(pTok, pItem);
          add(st, 'MOVE', [argToks[k]], [pTok]);
          add(st, 'MOVE', [pTok], [argToks[k]]);
        });
      } else {
        const variable = (byName.get(n.callee.name) || []).some((it) => it.attributes.includes('ENTRY') && it.attributes.includes('VARIABLE'));
        const targetTok = variable ? resolve(n.callee) : nameToken(n.callee);
        add(st, 'CALL', [], []);
        prog.calls.push({
          kind: variable ? 'I' : 'L', name: n.name, line: st.line, file: st.file || file, targetTok,
          using: n.args.map((a, k) => ({ tok: argToks[k], word: argToks[k]?.u ?? null, mode: 'REFERENCE' })),
          stmtIndex: prog.statements.length - 1,
        });
      }
    } else if (r.kind === 'FETCH') {
      // A TITLE that is a variable names the module loaded at run time.
      for (const e of n.entries) {
        const t = e.title && e.title.tree;
        const tok = t && t.t === 'ref' ? resolve(t) : null;
        if (!tok) continue;
        add(st, 'CALL', [], []);
        prog.calls.push({ kind: 'I', name: tok.u, line: st.line, file: st.file || file, targetTok: tok, using: [], stmtIndex: prog.statements.length - 1 });
      }
    } else if (r.kind === 'OPEN') {
      // A TITLE that is a variable names the dataset opened, as SELECT ... ASSIGN TO a data item does.
      for (const f of n.files) {
        const t = f.options && f.options.TITLE && f.options.TITLE.tree;
        if (t && t.t === 'ref' && resolve(t)) prog.files.push({ name: f.file.name, assign: { t: 'word', v: t.name }, file: st.file || file, line: st.line });
      }
    } else if (r.kind === 'EXEC' && top) {
      prog.execs.push({ t: 'exec', kind: n.processor, toks: execTokens(st.toks.slice(2)), line: st.line, file: st.file || file });
      for (const t of st.toks) if (t.t === 'word' && byName.has(t.u)) resolved.set(t, byName.get(t.u)[0]);
    }
    for (const u of n.units || []) if (u.node) visit(st, u, false);
  };
  for (const { st, r } of statements) visit(st, r);
  prog.includes = { included: read.included || [], unresolved: read.unresolved || [], cycles: read.cycles || [] };
  return prog;
}

// The engine's parse result for one PL/I source file.
export function parsePliSource(text, file, opts = {}) {
  return { file, format: 'pli', programs: [pliProgram(text, file, opts)], options: [], diags: [], copies: [] };
}
