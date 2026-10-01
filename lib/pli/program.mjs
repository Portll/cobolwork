// SPDX-License-Identifier: AGPL-3.0-or-later
// A PL/I source file as the program the flow engine reads (lib/dataflow.mjs summarise): data items
// with offsets and sizes from lib/pli/layout.mjs, statements as the names they read and write,
// external calls with their arguments, EXEC blocks as the engine's tokens, and the MAIN procedure's
// parameters. The engine itself is unchanged.
import { basename } from 'node:path';
import { readPli } from './lex.mjs';
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

export function pliProgram(text, file) {
  const statements = readPli(text, { file }).statements.map((st) => ({ st, r: parseStatement(st) }));
  const declared = [];
  for (const { r } of statements) if (r.status === 'parsed' && r.kind === 'DECLARE') declared.push(...r.node.items);
  const { roots } = layout(declared);

  const items = [];
  const flatten = (node, parent) => {
    const item = {
      name: node.name, level: node.logical, parent, children: [], file, line: node.line, values: [],
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
  const reads = (expr, out = []) => {
    const walk = (n) => {
      if (!n) return;
      if (n.t === 'ref') {
        const tok = resolve(n);
        if (tok) out.push(tok);
        else for (const list of n.args) for (const a of list) if (a.tree) walk(a.tree);
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
        if (tok && item) { resolved.set(tok, item); prog.paramTokens.push({ tok, mode: 'REFERENCE' }); }
      }
    }
  }
  if (!prog.id) prog.id = basename(file).replace(/\.[^.]*$/, '').toUpperCase();

  const add = (st, verb, sources, targets, extra = {}) => prog.statements.push({ verb, sources, targets, file, line: st.line, ...extra });
  const visit = (st, r, top = true) => {
    if (r.status !== 'parsed' && r.status !== 'unbuilt') return;
    const n = r.node;
    if (!n) return;
    if (r.kind === 'ASSIGNMENT') {
      const sources = reads(n.value);
      const targets = [];
      for (const t of n.targets) {
        const tok = resolve(t);
        if (tok) { targets.push(tok); continue; }
        // A pseudovariable such as SUBSTR(X, 1, 2) = ... writes its first argument.
        const first = t.args[0]?.[0];
        if (first?.tree?.t === 'ref') { const a = resolve(first.tree); if (a) targets.push(a); }
      }
      const verb = n.value.tree?.t === 'ref' ? 'MOVE' : hasOp(n.value.tree, new Set(['||'])) ? 'STRING' : hasOp(n.value.tree, ARITHMETIC_OPS) ? 'COMPUTE' : 'MOVE';
      add(st, verb, sources, targets);
    } else if (r.kind === 'READ') {
      const into = n.options?.INTO;
      add(st, 'READ', [], into ? [resolve(into)].filter(Boolean) : []);
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
          kind: variable ? 'I' : 'L', name: n.name, line: st.line, file, targetTok,
          using: n.args.map((a, k) => ({ tok: argToks[k], word: argToks[k]?.u ?? null, mode: 'REFERENCE' })),
          stmtIndex: prog.statements.length - 1,
        });
      }
    } else if (r.kind === 'EXEC' && top) {
      prog.execs.push({ t: 'exec', kind: n.processor, toks: execTokens(st.toks.slice(2)), line: st.line, file });
      for (const t of st.toks) if (t.t === 'word' && byName.has(t.u)) resolved.set(t, byName.get(t.u)[0]);
    }
    for (const u of n.units || []) if (u.node) visit(st, u, false);
  };
  for (const { st, r } of statements) visit(st, r);
  return prog;
}

// The engine's parse result for one PL/I source file.
export function parsePliSource(text, file) {
  return { file, format: 'pli', programs: [pliProgram(text, file)], options: [], diags: [], copies: [] };
}
