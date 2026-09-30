// SPDX-License-Identifier: AGPL-3.0-or-later
// How a data description is laid out in storage: the bytes a PICTURE and USAGE take, where each item
// starts within its record, and how wide a report group prints. Items are { level, occurs, redefines,
// sync, children, ... } as lib/parser.mjs builds them.

// The binary sizes a dialect gives COMP by digit count.
export const BINARY_SIZE = { default: '1-2-4-8', ibm: '2-4-8', mf: '1--8' };

function picInfo(pic, constants) {
  const info = { digits: 0, display: 0, signed: false, alphanumeric: false, national: false };
  const re = /(.)\(([A-Za-z0-9_-]+)\)|(.)/g;
  let m;
  while ((m = re.exec(pic))) {
    const ch = (m[1] || m[3]).toUpperCase();
    let n = 1;
    if (m[1]) {
      const raw = m[2];
      n = /^\d+$/.test(raw) ? Number(raw) : Number(constants && constants.get(raw.toUpperCase()));
      if (!Number.isFinite(n) || n < 0) n = 0;
    }
    if (ch === 'S') { info.signed = true; continue; }
    if (ch === 'V' || ch === 'P') continue;
    if (ch === '9') { info.digits += n; info.display += n; continue; }
    if (ch === 'N' || ch === 'G') { info.national = true; info.display += 2 * n; continue; }
    if (ch === 'X' || ch === 'A') info.alphanumeric = true;
    info.display += n;
  }
  return info;
}

// Storage bytes of a literal: hexadecimal literals hold one byte per two digits, a Z literal adds a
// terminating null, a national literal holds two bytes per character.
export function literalBytes(tok) {
  const prefix = tok.prefix || '';
  if (prefix === 'X' || prefix === 'BX' || prefix === 'NX') return Math.floor(tok.v.length / (prefix === 'NX' ? 4 : 2)) * (prefix === 'NX' ? 2 : 1);
  if (prefix === 'Z') return tok.v.length + 1;
  if (prefix === 'N' || prefix === 'NC' || prefix === 'U') return tok.v.length * 2;
  return tok.v.length;
}

function binaryBytes(digits, scheme) {
  if (scheme === '2-4-8') return digits <= 4 ? 2 : digits <= 9 ? 4 : 8;
  if (scheme === '1--8') return [1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 6, 6, 6, 7, 7, 8, 8][Math.min(digits, 18)] || 8;
  return digits <= 2 ? 1 : digits <= 4 ? 2 : digits <= 9 ? 4 : 8;
}

function elementarySize(item, scheme, constants) {
  if (!item.picture && !item.usage) {
    const constBytes = constants && constants.textBytes;
    const fromValue = item.values.reduce((n, v) => n + (v.t === 'lit' ? literalBytes(v) : v.t === 'word' && constBytes && constBytes.has(v.u) ? constBytes.get(v.u) : 0), 0);
    if (item.section === 'SCREEN' && !fromValue && item.screenRefItem) return item.screenRefItem.size || 0;
    if (item.section === 'SCREEN') return Math.max(1, fromValue);
    if (fromValue) return fromValue;
  }
  if (item.section === 'SCREEN' && !item.picture) return 1;
  const usage = item.effectiveUsage || 'DISPLAY';
  const p = item.picture ? picInfo(item.picture, constants) : null;
  const digits = p ? p.digits : 0;
  const u = usage.replace('COMPUTATIONAL', 'COMP');
  if (u === 'COMP-1' || u === 'FLOAT-SHORT') return 4;
  if (u === 'COMP-2' || u === 'FLOAT-LONG' || u === 'FLOAT-DECIMAL-16') return 8;
  if (u === 'FLOAT-DECIMAL-34') return 16;
  if (u === 'INDEX') return 4;
  if (u === 'POINTER' || u === 'PROGRAM-POINTER' || u === 'FUNCTION-POINTER' || u === 'PROCEDURE-POINTER') return 8;
  if (u === 'BINARY-CHAR') return 1;
  if (u === 'BINARY-SHORT' || u === 'SIGNED-SHORT' || u === 'UNSIGNED-SHORT') return 2;
  if (u === 'BINARY-LONG' || u === 'BINARY-INT' || u === 'SIGNED-INT' || u === 'UNSIGNED-INT') return 4;
  if (u === 'BINARY-DOUBLE' || u === 'BINARY-LONG-LONG' || u === 'BINARY-C-LONG' || u === 'SIGNED-LONG' || u === 'UNSIGNED-LONG') return 8;
  if (u === 'COMP-3' || u === 'PACKED-DECIMAL') return Math.floor(digits / 2) + 1;
  if (u === 'COMP-6') return Math.ceil(digits / 2);
  if (u === 'COMP-X' || u === 'COMP-N' || (u === 'COMP-5' && p && p.alphanumeric)) {
    if (p && p.alphanumeric) return p.display;
    return Math.max(1, Math.ceil((digits * Math.log(10)) / Math.log(256)));
  }
  if (u === 'COMP' || u === 'COMP-4' || u === 'COMP-5' || u === 'BINARY') return binaryBytes(digits, scheme);
  let len = p ? p.display : 0;
  if (item.signSeparate && p && p.signed) len++;
  return len;
}

// SYNCHRONIZED aligns a binary, floating-point, pointer or index item to its own length; packed,
// COMP-X and display items are not moved.
const ALIGNED_USAGE = /^(COMP|COMP-[1245]|BINARY(-[A-Z-]+)?|FLOAT-[A-Z0-9-]+|(PROGRAM-|FUNCTION-|PROCEDURE-)?POINTER|INDEX|(UN)?SIGNED-[A-Z]+)$/;

export function computeSizes(roots, scheme, constants) {
  // `at` is where the item starts, counted from the start of its record, because the compiler aligns
  // a SYNCHRONIZED item against the record and puts the slack inside the group that holds it. A
  // table's entry is laid out from its own start and rounded up to its widest alignment, so every
  // occurrence aligns alike.
  const visit = (item, inheritedUsage, inheritedSignSeparate, at) => {
    item.effectiveUsage = item.usage || inheritedUsage || null;
    if (inheritedSignSeparate && !item.signExplicit) item.signSeparate = true;
    const structural = item.children.filter(c => c.level !== 88 && c.level !== 66 && c.level !== 78);
    if (!structural.length) {
      const one = elementarySize(item, scheme, constants);
      item.contributes = one * item.occurs;
      // The listing prints the whole table only for POINTER and INDEX; every other usage prints one occurrence.
      const wholeTable = /^(POINTER|INDEX)$/.test(item.effectiveUsage || '');
      item.size = wholeTable ? item.contributes : one;
      const usage = (item.effectiveUsage || '').replace('COMPUTATIONAL', 'COMP');
      item.align = item.sync && ALIGNED_USAGE.test(usage) ? Math.min(one, 8) : 1;
      item.maxAlign = item.align;
      return;
    }
    const base = item.occurs > 1 ? 0 : at;
    let offset = 0;
    let end = 0;
    let maxAlign = 1;
    const startOf = new Map();
    for (const c of structural) {
      if (c.redefines) {
        // REDEFINES names a SIBLING. Resolving it by name across the whole program reached the
        // first item of that name anywhere, which crossed records.
        const known = startOf.has(c.redefines);
        visit(c, item.effectiveUsage, item.signSeparate, base + (known ? startOf.get(c.redefines) : offset));
        const start = known ? startOf.get(c.redefines) : offset - c.contributes;
        startOf.set(c.name, start);
        c.localStart = start;
        end = Math.max(end, start + c.contributes);
        // A REDEFINES larger than the item it redefines pushes the next sibling past its end.
        offset = Math.max(offset, start + c.contributes);
        maxAlign = Math.max(maxAlign, c.maxAlign);
        continue;
      }
      visit(c, item.effectiveUsage, item.signSeparate, base + offset);
      const skew = (base + offset) % c.align;
      if (c.align > 1 && skew) offset += c.align - skew;
      startOf.set(c.name, offset);
      c.localStart = offset;
      offset += c.contributes;
      end = Math.max(end, offset);
      maxAlign = Math.max(maxAlign, c.maxAlign);
    }
    if (item.occurs > 1 && end % maxAlign) end += maxAlign - (end % maxAlign);
    item.size = end * item.occurs;
    item.contributes = item.size;
    item.align = 1;
    item.maxAlign = maxAlign;
  };
  for (const r of roots) visit(r, null, false, 0);
  // Offsets are assigned after sizing: a child's absolute start depends on its parent's, which is
  // only known once the parent's own siblings have been laid out.
  const place = (item, at) => {
    item.offset = at;
    for (const c of item.children) if (c.localStart != null) place(c, at + c.localStart);
  };
  for (const r of roots) place(r, 0);
}

// A report group is laid out by column, not by adding up its items: a line is as wide as the column
// its rightmost item ends in, COLUMN PLUS counting on from the end of the item before. A group holds
// its lines one after another, and every 01 group of a report, like the file the report is written
// to, is as large as the largest group.
export function layoutReport(rd) {
  const structural = (x) => x.children.filter(c => c.level !== 88 && c.level !== 66 && c.level !== 78);
  const mark = (x) => { x.rd = rd; for (const c of x.children) mark(c); };
  for (const g of rd.groups) mark(g);
  let width = 0;
  // Items printed at the same column under PRESENT WHEN each keep their own storage, so a line is
  // never smaller than its items laid end to end.
  const lineWidth = (line) => {
    let last = 0;
    let right = 0;
    let total = 0;
    const place = (c) => {
      const len = c.contributes || c.size || 0;
      const start = c.rwColumn ? (c.rwColumn.at != null ? c.rwColumn.at : last + c.rwColumn.plus) : last + 1;
      last = start + len - 1;
      right = Math.max(right, last);
      total += len;
    };
    const walk = (x) => { for (const c of structural(x)) { if (structural(c).length) walk(c); else place(c); } };
    if (structural(line).length) walk(line);
    else place(line);
    return Math.max(right, total);
  };
  // The entries that open a line; a group with no LINE clause anywhere in it is one line.
  for (const g of rd.groups) {
    const lines = [];
    const collect = (x) => { if (x.rwLine) { lines.push(x); return; } for (const c of structural(x)) collect(c); };
    collect(g);
    if (!lines.length) lines.push(g);
    let total = 0;
    for (const line of lines) {
      const w = lineWidth(line);
      if (line !== g) { line.size = w; line.contributes = w * (line.occurs || 1); }
      total += w;
    }
    width = Math.max(width, total);
  }
  for (const g of rd.groups) { g.size = width; g.contributes = width; }
  rd.width = width;
}

// Whether an item's bytes are read as decimal digits: zoned (DISPLAY with a numeric picture) or
// packed. A group, an edited picture, binary and floating point are not.
export function holdsDecimal(it) {
  if ((it.children || []).some((c) => c.level !== 88)) return false;
  const usage = String(it.effectiveUsage || 'DISPLAY').replace('COMPUTATIONAL', 'COMP');
  if (usage === 'COMP-3' || usage === 'PACKED-DECIMAL' || usage === 'COMP-6') return true;
  return usage === 'DISPLAY' && !!it.picture && /9/.test(it.picture) && /^[S9VP()0-9]+$/i.test(it.picture);
}
