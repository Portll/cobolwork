// SPDX-License-Identifier: AGPL-3.0-or-later
// The literals that can be in a data item when a statement reads it, from the program's text: its
// VALUE clause and its subordinates', each MOVE and STRING into it or into a group holding it, and a
// hop or two back through an item those name. Anything else that can write it - a computation, a
// READ or ACCEPT INTO, a CALL it is passed to by reference, a MOVE from a field with no constant -
// leaves it open, which a caller reads as "and something this cannot see".
const FIGURATIVE = /^(LOW-VALUES?|HIGH-VALUES?|SPACES?|ZEROS?|ZEROES|QUOTES?|NULLS?)$/;
const WRITERS = new Set(['COMPUTE', 'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'READ', 'ACCEPT', 'UNSTRING', 'INITIALIZE', 'SET', 'RETURN', 'INSPECT']);
const NOT_OPERANDS = new Set(['TO', 'INTO', 'DELIMITED', 'BY', 'SIZE', 'OF', 'IN', 'ALL']);

// The item, its subordinates and the groups that hold it.
function family(p, name) {
  const self = p.items.find((x) => x.name === name);
  if (!self) return null;
  const under = [];
  const down = (it) => { for (const c of it.children || []) { if (c.level === 88) continue; under.push(c); down(c); } };
  down(self);
  const over = [];
  for (let up = self.parent; up; up = up.parent) over.push(up);
  return { self, under, over };
}

const nameOf = (t) => (typeof t === 'string' ? t : t && t.u);

const valuesOf = (item) => (item.values || []).map((v) => (v.t === 'lit' ? String(v.v) : FIGURATIVE.test(v.u || '') ? v.u : null)).filter((v) => v !== null);

// `ignoreCall(call)` names calls that read the item and do not write it, such as the one being judged.
export function constantsReaching(p, name, { depth = 2, ignoreCall = () => false } = {}, seen = new Set()) {
  const out = { values: [], open: false };
  if (seen.has(name)) return out;
  seen.add(name);
  const f = family(p, name);
  if (!f) return { values: [], open: true };
  const names = new Set([name, ...f.under.map((x) => x.name), ...f.over.map((x) => x.name)]);
  out.values.push(...valuesOf(f.self), ...f.under.flatMap(valuesOf));
  for (const st of p.statements || []) {
    if (!(st.targets || []).some((t) => names.has(nameOf(t)))) continue;
    if (st.verb === 'MOVE' || st.verb === 'STRING') {
      for (const t of st.sources || []) if (t && t.t === 'lit') out.values.push(String(t.v));
      for (const l of st.literals || []) out.values.push(String(l && l.v !== undefined ? l.v : l));
      for (const w of (st.sources || []).filter((t) => !(t && t.t === 'lit')).map(nameOf).filter((x) => x && !NOT_OPERANDS.has(x))) {
        if (FIGURATIVE.test(w) || /^[+-]?\d/.test(w) || names.has(w)) { if (FIGURATIVE.test(w)) out.values.push(w); continue; }
        if (depth === 0) { out.open = true; continue; }
        const r = constantsReaching(p, w, { depth: depth - 1, ignoreCall }, seen);
        out.values.push(...r.values);
        if (r.open || !r.values.length) out.open = true;
      }
      continue;
    }
    if (WRITERS.has(st.verb)) out.open = true;
  }
  for (const c of p.calls || []) {
    if (ignoreCall(c)) continue;
    if ((c.using || []).some((u) => names.has(u.word) && u.mode !== 'CONTENT' && u.mode !== 'VALUE')) out.open = true;
  }
  return out;
}

// A rule array is eight-byte keywords side by side; one held in several fields reads the same.
export const keywordsOf = (values) => new Set(values.flatMap((v) => (FIGURATIVE.test(v) ? [] : String(v).match(/.{1,8}/g) || []).map((k) => k.trim().toUpperCase()).filter(Boolean)));
