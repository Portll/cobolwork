// SPDX-License-Identifier: AGPL-3.0-or-later
// %INCLUDE expansion at the token level, as the preprocessor does it before statements exist: a
// member can hold the rest of a DECLARE (`DCL 1 REC, %INCLUDE RECFLDS;`), so a member's tokens
// replace the directive in the token stream and statements are split afterwards. Every token keeps
// the file and line it was read from.
import { basename, dirname, extname } from 'node:path';
import { tokenize, statements } from './lex.mjs';

// Upper-case member name -> paths of the files that could hold it, in path order.
export function membersOf(paths) {
  const out = new Map();
  for (const p of [...paths].sort()) {
    const name = basename(p, extname(p)).toUpperCase();
    if (!out.has(name)) out.set(name, []);
    out.get(name).push(p);
  }
  return out;
}

// The member a directive in `from` means: one in the same directory if there is one, else the first.
export function chooseMember(candidates, from) {
  if (!candidates || !candidates.length) return null;
  return candidates.find((p) => dirname(p) === dirname(from)) || candidates[0];
}

// The members a %INCLUDE or %XINCLUDE directive names: name, 'name' or ddname(name), comma-separated.
function directiveMembers(toks) {
  const names = [];
  for (let k = 2; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'op' && t.v === ',') continue;
    if (t.t === 'word' && toks[k + 1]?.t === 'op' && toks[k + 1].v === '(' && toks[k + 3]?.t === 'op' && toks[k + 3].v === ')') {
      const m = toks[k + 2];
      names.push(String(m.u ?? m.v).toUpperCase());
      k += 3;
    } else if (t.t === 'word') names.push(t.u);
    else if (t.t === 'lit') names.push(t.v.toUpperCase());
  }
  return names;
}

// readMember(name, fromFile) -> { path, text } or null.
export function expandIncludes(tokens, { file, readMember, maxDepth = 16 }) {
  const included = [];
  const unresolved = [];
  const cycles = [];
  const seen = new Set();
  const walk = (toks, from, chain) => {
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const d = toks[i + 1];
      if (!(t.t === 'op' && t.v === '%' && d && d.t === 'word' && (d.u === 'INCLUDE' || d.u === 'XINCLUDE'))) { out.push(t); continue; }
      let end = i;
      while (end < toks.length && toks[end].t !== 'semi') end++;
      const directive = toks.slice(i, end + 1);
      const keep = [];
      for (const name of directiveMembers(directive)) {
        if (d.u === 'XINCLUDE' && seen.has(name)) continue;
        if (chain.includes(name)) { cycles.push({ chain: [...chain, name] }); continue; }
        if (chain.length >= maxDepth) { unresolved.push({ name, file: t.file ?? from, line: t.line, why: 'too deep' }); continue; }
        const m = readMember(name, from);
        if (!m) { unresolved.push({ name, file: t.file ?? from, line: t.line }); keep.push(name); continue; }
        seen.add(name);
        included.push({ name, path: m.path, from: { file: t.file ?? from, line: t.line } });
        out.push(...walk(tokenize(m.text, { file: m.path }).tokens, m.path, [...chain, name]));
      }
      // An unresolved member keeps its directive, so the statement is still there to be counted.
      if (keep.length) out.push(...directive);
      i = end;
    }
    return out;
  };
  return { tokens: walk(tokens, file, []), included, unresolved, cycles };
}

// readPli with %INCLUDE members spliced in.
export function readPliExpanded(text, { file, readMember }) {
  const { tokens, diags, process, margins } = tokenize(text, { file });
  const ex = expandIncludes(tokens, { file, readMember });
  return { statements: statements(ex.tokens), diags, process, margins, included: ex.included, unresolved: ex.unresolved, cycles: ex.cycles };
}
