// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I structure mapping: DECLARE items into structure trees, and each member's offset and size by the
// Enterprise PL/I Language Reference's rules, innermost minor structures first, every pair of units
// placed with the first shifted toward the second as far as its alignment allows.
import { storageOf } from './storage.mjs';

const DW = 64;
const mod = (a, m) => ((a % m) + m) % m;

// The trees a DECLARE's items describe. A member's logical level is one deeper than the structure
// that holds it, whatever level numbers the source wrote.
export function structuresOf(items) {
  const roots = [];
  const stack = [];
  for (const it of items) {
    const node = { name: it.name, level: it.level, dims: it.dims || [], attributes: it.attributes || [], line: it.line, children: [] };
    if (it.level == null || it.level <= 1) { roots.push(node); stack.length = 0; if (it.level != null) stack.push(node); node.logical = 1; continue; }
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (!parent) { roots.push(node); node.logical = 1; node.orphan = true; stack.push(node); continue; }
    node.logical = parent.logical + 1;
    parent.children.push(node);
    stack.push(node);
  }
  return roots;
}

// The number of elements a dimension list gives, or null when a bound is not a constant.
function extent(dims) {
  let n = 1;
  for (const d of dims) {
    const parts = [[]];
    for (const t of d) { if (t.t === 'op' && t.v === ':') parts.push([]); else parts[parts.length - 1].push(t); }
    const num = (p) => {
      if (p.length === 1 && p[0].t === 'num' && /^\d+$/.test(p[0].v)) return Number(p[0].v);
      if (p.length === 2 && p[0].t === 'op' && (p[0].v === '-' || p[0].v === '+') && p[1].t === 'num' && /^\d+$/.test(p[1].v)) return (p[0].v === '-' ? -1 : 1) * Number(p[1].v);
      return null;
    };
    const [lo, hi] = parts.length === 2 ? [num(parts[0]), num(parts[1])] : [1, num(parts[0])];
    if (lo == null || hi == null) return null;
    n *= Math.max(0, hi - lo + 1);
  }
  return n;
}

const explicitAlignment = (node) => (node.attributes.some((a) => a.name === 'ALIGNED') ? true : node.attributes.some((a) => a.name === 'UNALIGNED') ? false : null);

// Pairs two units: the first begins at its offset from a doubleword boundary, the second at the
// first position after it that its alignment allows, then the first moves toward the second by
// whole multiples of its own alignment. Positions are in bits.
function pair(a, b) {
  const end = a.offset + a.bits;
  const start = b.structure ? end + mod(b.offset - end, b.align) : Math.ceil(end / b.align) * b.align;
  const shift = Math.floor((start - end) / a.align) * a.align;
  const first = a.offset + shift;
  return { first, second: start, unit: { offset: mod(first, DW), bits: start + b.bits - first, align: Math.max(a.align, b.align), structure: true } };
}

// Maps one node: an element takes its storage; a structure maps its members into one unit, a union
// overlays them. Every node gets `at`, its start in bits within the unit of its parent.
function mapNode(node, inherited, problems) {
  const own = explicitAlignment(node);
  const inherit = own ?? inherited;
  const count = node.dims.length ? extent(node.dims) : 1;
  let unit;
  if (!node.children.length) {
    const s = storageOf(node.attributes, { inherited, name: node.name });
    node.storage = s;
    if (!s.known) problems.push({ name: node.name, line: node.line, why: s.type === 'TYPE' ? `type ${s.typeName} is defined by a DEFINE this reading does not resolve` : s.type ? `the extent of ${s.type} is not a constant` : 'no data attributes' });
    unit = { offset: 0, bits: s.bits ?? 0, align: s.align, structure: false };
  } else if (node.attributes.some((a) => a.name === 'UNION')) {
    const members = node.children.map((ch) => mapNode(ch, inherit, problems));
    let len = 0;
    node.children.forEach((ch, k) => { ch.at = mod(members[k].offset, members[k].align); len = Math.max(len, ch.at + members[k].bits); });
    unit = { offset: 0, bits: len, align: Math.max(...members.map((m) => m.align)), structure: true };
  } else {
    const members = node.children.map((ch) => mapNode(ch, inherit, problems));
    let acc = { ...members[0] };
    const starts = [members[0].offset];
    for (let k = 1; k < members.length; k++) {
      const { first, second, unit: u } = pair(acc, members[k]);
      const moved = first - acc.offset;
      for (let j = 0; j < k; j++) starts[j] += moved;
      starts.push(starts[0] + (second - first));
      acc = u;
    }
    const base = starts[0];
    node.children.forEach((ch, k) => { ch.at = starts[k] - base; });
    unit = { offset: acc.offset, bits: acc.bits, align: acc.align, structure: true };
  }
  if (count == null) problems.push({ name: node.name, line: node.line, why: 'a dimension bound is not a constant' });
  node.count = count;
  // Each element of an array starts on the same boundary, so an element is padded to its alignment.
  const stride = count > 1 ? Math.ceil(unit.bits / unit.align) * unit.align : unit.bits;
  node.strideBits = stride;
  return count > 1 ? { ...unit, bits: stride * count } : unit;
}

// Byte and bit offsets from the start of the major structure, and sizes, set on every node.
function place(node, atBits) {
  node.offsetBits = atBits;
  node.offset = Math.floor(atBits / 8);
  if (atBits % 8) node.bitOffset = atBits % 8;
  node.size = Math.ceil(node.strideBits / 8);
  node.occurs = node.count ?? null;
  for (const ch of node.children) place(ch, atBits + ch.at);
}

// Lays out every structure a DECLARE describes. Returns the trees, each node carrying offset (bytes
// from its major structure), bitOffset when not on a byte, size (bytes of one element), occurs, and
// storage for an element; problems lists what could not be sized.
export function layout(items) {
  const roots = structuresOf(items);
  const problems = [];
  for (const r of roots) {
    const u = mapNode(r, null, problems);
    // Storage begins at the byte holding the first bit; unaligned bits shifted toward their
    // successor leave their padding there.
    const lead = u.offset % 8;
    r.totalBits = u.bits;
    place(r, lead);
    r.total = Math.ceil((lead + u.bits) / 8);
  }
  return { roots, problems };
}
