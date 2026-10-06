// SPDX-License-Identifier: AGPL-3.0-or-later
// What Enterprise COBOL's generated code does that the source does not say, read from ironwork's
// model of the compiler: a binary store under TRUNC(OPT) that can exceed its PICTURE, an intermediate
// result wider than ARITH lets the compiler carry, and a range of characters whose order EBCDIC and
// ASCII disagree on. The first two rest on entries in ironwork's assumption register
// (crates/numeric/src/assumptions.rs), C2 and C1, which no Enterprise COBOL compile has settled yet,
// and each finding says so. cobolwork links nothing of ironwork; the rules are its model written down.
import { basename, extname } from 'node:path';
import { inScope, isProgram, isJcl, relPath, ebcdicByte } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { drive, loopOver } from '../kernel/shared-pass.mjs';
import { loadSite } from '../site.mjs';
import { parseJcl } from '../jcl.mjs';
import { optionCards, optionTokens, compileStepOptions } from '../options.mjs';

export const SEMANTICS_RULES = {
  'binary-store-exceeds-picture-under-trunc-opt': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-758',
    text: 'Under TRUNC(OPT) a binary field receives a value that can have more digits than its PICTURE',
    impact: 'TRUNC(OPT) lets the compiler assume every value fits the PICTURE, so when one does not, whether the field keeps the excess digits or loses them depends on the code generated for that statement and can change with the compiler level or its optimisation',
    remedy: 'Make the receiver COMP-5 or wide enough for the value, add ON SIZE ERROR, or compile the program with TRUNC(STD) or TRUNC(BIN)',
  },
  'intermediate-result-loses-high-order-digits': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-197',
    text: 'A COMPUTE has an intermediate result wider than the compiler carries, so high-order digits can be lost',
    impact: 'In ironwork\'s model of Enterprise COBOL a fixed-point intermediate carries at most 30 digits (31 under ARITH(EXTEND)) and, beyond that, keeps the decimal places the statement needs and drops high-order integer digits without raising SIZE ERROR, so a large enough value computes a wrong result silently',
    remedy: 'Split the expression so each step fits, carry fewer decimal places in the operands and receivers, or compile with ARITH(EXTEND) where one more digit is enough',
  },
  'character-range-reverses-in-ascii': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-474',
    text: 'A range of characters is in order in EBCDIC and reversed in ASCII, or the other way round, so it holds values in one and none in the other',
    impact: 'The same source tests a different set of characters when it is compiled with an ASCII collating sequence - GnuCOBOL, Micro Focus, a migration target - so a test on one platform passes or fails for a reason the source does not show',
    remedy: 'Test the class the range means (IS NUMERIC, IS ALPHABETIC, a CLASS condition) or list the values, rather than relying on the order of the code page',
  },
};

const MAX_SHOWN = 3;
const memberName = (file) => basename(file, extname(file)).toUpperCase();

// The last setting of an option family across the estate's defaults, the JCL step that compiles the
// member and its own CBL and PROCESS cards, with where it was set. null where no level sets it.
function lastSetting(names, { site, steps, cards }) {
  const settings = [
    ...site.flatMap((s) => optionTokens(s).map((token) => ({ token, where: 'compilerOptions in cobolwork.site.json' }))),
    ...steps.flatMap((s) => s.options.map((token) => ({ token, where: `the compile step at ${s.file}:${s.line}` }))),
    ...cards.flatMap((c) => c.options.map((token) => ({ token, where: `the ${c.level} statement at line ${c.line}` }))),
  ];
  for (let k = settings.length - 1; k >= 0; k--) {
    const m = /^([A-Z0-9-]+)(?:\((.*)\))?$/.exec(settings[k].token);
    if (m && names.includes(m[1])) return { sub: (m[2] || '').trim(), token: settings[k].token, where: settings[k].where };
  }
  return null;
}

// Integer and decimal places of a numeric PICTURE, with P scaling: P before the 9s adds decimal
// places, after them integer places. null for anything that is not a fixed-point number.
export function placesOf(picture) {
  if (!picture) return null;
  const pic = String(picture).toUpperCase().replace(/(.)\((\d+)\)/g, (_, c, n) => c.repeat(Number(n)));
  if (!/^S?[9PV]+$/.test(pic) || !pic.includes('9')) return null;
  const body = pic.replace(/^S/, '');
  const v = body.indexOf('V');
  const [left, right] = v < 0 ? [body, ''] : [body.slice(0, v), body.slice(v + 1)];
  const leadingP = /^P+/.test(left) ? left.match(/^P+/)[0].length : 0;
  const nines = (s) => (s.match(/9/g) || []).length;
  const ps = (s) => (s.match(/P/g) || []).length;
  if (leadingP || (v >= 0 && /^P/.test(right))) return { int: 0, dec: nines(left) + nines(right) + ps(left) + ps(right) };
  return { int: nines(left) + ps(left), dec: nines(right) };
}

const BINARY_USAGE = new Set(['COMP', 'COMP-4', 'BINARY', 'COMPUTATIONAL', 'COMPUTATIONAL-4']);
const FLOAT_USAGE = new Set(['COMP-1', 'COMP-2', 'COMPUTATIONAL-1', 'COMPUTATIONAL-2', 'FLOAT-SHORT', 'FLOAT-LONG']);
const numberPlaces = (text) => {
  const m = /^[+-]?(\d*)(?:[.,](\d*))?$/.exec(String(text));
  if (!m || !(m[1] || m[2])) return null;
  return { int: m[1].replace(/^0+(?=\d)/, '').length, dec: (m[2] || '').length };
};

// IBM's places for an intermediate, as ironwork's numeric/src/precision.rs computes them.
const sum = (a, b) => ({ int: Math.max(a.int, b.int) + 1, dec: Math.max(a.dec, b.dec) });
const product = (a, b) => ({ int: a.int + b.int, dec: a.dec + b.dec });
const quotient = (a, b, dmax) => ({ int: a.int + b.dec, dec: Math.max(a.dec, dmax) });
function carried(ir, dmax, n) {
  if (ir.int + ir.dec <= n) return ir;
  if (ir.dec <= dmax) return { int: Math.max(0, n - ir.dec), dec: ir.dec };
  if (ir.int + dmax <= n) return { int: ir.int, dec: n - ir.int };
  return { int: Math.max(0, n - dmax), dec: dmax };
}

// A COMPUTE's expression as operands and operators: an identifier (with its subscript skipped), a
// numeric literal, parentheses, unary and binary + - * /. Exponentiation and functions are left
// unread: IBM computes them in floating point or by rules of their own.
function expression(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'op' && ['+', '-', '*', '/'].includes(t.v)) { out.push({ op: t.v }); continue; }
    if (t.t === 'op' && t.v === '**') return null;
    if (t.t === 'sep' && (t.v === '(' || t.v === ')')) { out.push({ paren: t.v }); continue; }
    if (t.t === 'num' || (t.t === 'word' && /^[+-]?\d+([.,]\d+)?$/.test(t.v))) { out.push({ literal: String(t.v) }); continue; }
    if (t.t === 'word' && t.u === 'FUNCTION') return null;
    if (t.t === 'word') {
      const name = [t.u];
      while (toks[k + 1] && toks[k + 1].t === 'word' && (toks[k + 1].u === 'OF' || toks[k + 1].u === 'IN') && toks[k + 2]) { name.push(toks[k + 2].u); k += 2; }
      out.push({ name: name[0], qualified: name.length > 1 });
      if (toks[k + 1] && toks[k + 1].t === 'sep' && toks[k + 1].v === '(') {
        let depth = 0;
        for (k++; k < toks.length; k++) {
          if (toks[k].t === 'sep' && toks[k].v === '(') depth++;
          if (toks[k].t === 'sep' && toks[k].v === ')' && --depth === 0) break;
        }
      }
      continue;
    }
    return null;
  }
  return out;
}

// Walks the expression by precedence, carrying each intermediate as IBM would, and returns the first
// intermediate whose integer places the carry cut, or null. `lookup` gives an operand's places.
function firstLoss(items, { lookup, dmax, n }) {
  let at = 0;
  let loss = null;
  const combine = (a, op, b) => {
    const ir = op === '+' || op === '-' ? sum(a, b) : op === '*' ? product(a, b) : quotient(a, b, dmax);
    const kept = carried(ir, dmax, n);
    if (!loss && kept.int < ir.int) loss = { ir, kept, op };
    return kept;
  };
  const primary = () => {
    const x = items[at++];
    if (!x) throw new Error('end');
    if (x.op === '+' || x.op === '-') return primary();
    if (x.paren === '(') { const v = additive(); if (!items[at] || items[at].paren !== ')') throw new Error('paren'); at++; return v; }
    const p = x.literal !== undefined ? numberPlaces(x.literal) : lookup(x);
    if (!p) throw new Error('operand');
    return p;
  };
  const multiplicative = () => {
    let v = primary();
    while (items[at] && (items[at].op === '*' || items[at].op === '/')) { const op = items[at++].op; v = combine(v, op, primary()); }
    return v;
  };
  const additive = () => {
    let v = multiplicative();
    while (items[at] && (items[at].op === '+' || items[at].op === '-')) { const op = items[at++].op; v = combine(v, op, multiplicative()); }
    return v;
  };
  try { additive(); } catch { return { unread: true }; }
  return at === items.length ? loss : { unread: true };
}

// The integer places a value from `items` can have: no carry for + and -, as a counter's increment
// is not a value the program lets grow past its field; a product or quotient as IBM places it.
function naturalInt(items, lookup) {
  let at = 0;
  const primary = () => {
    const x = items[at++];
    if (!x) throw new Error('end');
    if (x.op === '+' || x.op === '-') return primary();
    if (x.paren === '(') { const v = additive(); at++; return v; }
    const p = x.literal !== undefined ? numberPlaces(x.literal) : lookup(x);
    if (!p) throw new Error('operand');
    return p;
  };
  const multiplicative = () => {
    let v = primary();
    while (items[at] && (items[at].op === '*' || items[at].op === '/')) {
      const op = items[at++].op;
      const b = primary();
      v = op === '*' ? product(v, b) : { int: v.int + b.dec, dec: v.dec };
    }
    return v;
  };
  const additive = () => {
    let v = multiplicative();
    while (items[at] && (items[at].op === '+' || items[at].op === '-')) { at++; const b = multiplicative(); v = { int: Math.max(v.int, b.int), dec: Math.max(v.dec, b.dec) }; }
    return v;
  };
  try { return additive().int; } catch { return null; }
}

// Two literals compared as the collating sequence would: shorter padded with spaces, by code.
function order(a, b, code) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = code(a[i] ?? ' ');
    const y = code(b[i] ?? ' ');
    if (x === null || y === null) return null;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
const asciiCode = (ch) => { const c = ch.codePointAt(0); return c >= 0x20 && c <= 0x7E ? c : null; };

// The literal pairs `lo THRU hi` in a run of VALUE or WHEN tokens.
function thruPairs(toks) {
  const out = [];
  for (let k = 0; k + 2 < toks.length; k++) {
    const [lo, thru, hi] = [toks[k], toks[k + 1], toks[k + 2]];
    if (lo.t === 'lit' && thru.t === 'word' && (thru.u === 'THRU' || thru.u === 'THROUGH') && hi.t === 'lit') out.push({ lo: String(lo.v), hi: String(hi.v), line: lo.line });
  }
  return out;
}
const WHEN_WORDS = new Set(['THRU', 'THROUGH', 'ALSO', 'OR', 'NOT', 'ANY', 'OTHER', 'TRUE', 'FALSE']);

export function* scanSemanticsSteps(root, opts = {}) {
  const tree = treeFor(root, opts);
  const all = tree.list().filter(inScope(opts));
  const files = all.filter(isProgram);
  const findings = [];
  const stats = {
    filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0,
    truncOptPrograms: 0, truncUnknownPrograms: 0, arithExtendPrograms: 0, beyondEnterprisePrograms: 0, computesRead: 0, computesUnread: 0,
    rangesRead: 0, collatingDeclaredPrograms: 0,
  };
  const site = loadSite(root, opts.site || null, opts.tree).compilerOptions || [];
  const parsedJcl = [];
  for (const f of all.filter(isJcl)) {
    try { parsedJcl.push({ ...parseJcl(tree.text(f).text, f), file: relPath(root, f) }); } catch { /* the jcl set reports it */ }
  }
  const stepsOf = new Map();
  for (const s of compileStepOptions(parsedJcl)) {
    if (!stepsOf.has(s.member)) stepsOf.set(s.member, []);
    stepsOf.get(s.member).push(s);
  }

  function judge(p, path, levels, collatingDeclared) {
    const byName = new Map();
    for (const it of p.items) {
      const k = String(it.name).toUpperCase();
      byName.set(k, byName.has(k) ? null : it);
    }
    const numeric = (x) => {
      const it = byName.get(x.name);
      if (!it || FLOAT_USAGE.has(String(it.effectiveUsage || '').toUpperCase())) return null;
      return placesOf(it.picture);
    };
    const trunc = lastSetting(['TRUNC'], levels);
    const arith = lastSetting(['ARITH', 'AR'], levels);
    // ARITH(COMPAT) allows 18 digits in an item and ARITH(EXTEND) 31 (ironwork's
    // Arith::max_picture_digits): a wider item says which one the program needs, or that it is not
    // Enterprise COBOL at all.
    const widest = Math.max(0, ...p.items.map((it) => { const x = placesOf(it.picture); return x ? x.int + x.dec : 0; }));
    const extendByItem = !arith && widest > 18;
    const n = (arith && /^(EXTEND|E)$/.test(arith.sub)) || extendByItem ? 31 : 30;
    const beyondIbm = widest > 31;
    if (beyondIbm) stats.beyondEnterprisePrograms++;
    const truncOpt = trunc && trunc.sub === 'OPT';
    if (truncOpt) stats.truncOptPrograms++;
    if (!trunc) stats.truncUnknownPrograms++;
    if (n === 31) stats.arithExtendPrograms++;
    const toks = p.proc ? p.proc.tokens : [];
    const narrowed = [];

    for (const st of p.statements) {
      // Without TRUNC(OPT) only a COMPUTE is judged, and the slice below runs to the end of the
      // program for a statement whose end the parse did not mark.
      if (st.verb !== 'COMPUTE' && !truncOpt) continue;
      const seg = toks.slice(st.at + 1, st.end ?? toks.length);
      const sizeError = seg.some((t, k) => t.t === 'word' && t.u === 'SIZE' && seg[k + 1] && seg[k + 1].u === 'ERROR');

      if (st.verb === 'COMPUTE') {
        const eq = seg.findIndex((t) => (t.t === 'op' && t.v === '=') || (t.t === 'word' && (t.u === 'EQUAL' || t.u === 'EQUALS')));
        if (eq < 0) continue;
        let stop = seg.findIndex((t, k) => k > eq && t.t === 'word' && (t.u === 'ON' || t.u === 'NOT' || t.u === 'SIZE' || t.u === 'END-COMPUTE'));
        if (stop < 0) stop = seg.length;
        const items = expression(seg.slice(eq + 1, stop));
        const receivers = seg.slice(0, eq).filter((t) => t.t === 'word' && t.u !== 'ROUNDED').map((t) => byName.get(t.u)).filter(Boolean);
        if (!items || beyondIbm) { stats.computesUnread++; continue; }
        const dmax = Math.max(0, ...receivers.map((r) => (placesOf(r.picture) || { dec: 0 }).dec),
          ...items.filter((x, k) => !(items[k - 1] && items[k - 1].op === '/')).map((x) => (x.name ? (numeric(x) || { dec: 0 }).dec : x.literal ? (numberPlaces(x.literal) || { dec: 0 }).dec : 0)));
        const loss = firstLoss(items, { lookup: numeric, dmax, n });
        if (loss && loss.unread) { stats.computesUnread++; continue; }
        stats.computesRead++;
        if (loss) {
          findings.push({
            rule: 'intermediate-result-loses-high-order-digits', path, line: st.line, program: p.id,
            detail: `${p.id}: a ${loss.op === '*' ? 'product' : loss.op === '/' ? 'quotient' : 'sum'} in this COMPUTE has ${loss.ir.int} integer and ${loss.ir.dec} decimal places; under ARITH(${n === 31 ? 'EXTEND' : 'COMPAT'}) (${arith ? `set by ${arith.where}` : extendByItem ? `which its ${widest}-digit item needs, since no level this set reads sets ARITH` : 'IBM\'s default: no level this set reads sets ARITH'}) the compiler carries ${n} digits and keeps ${loss.kept.int} integer places. This follows ironwork's intermediate table, assumption C1, which no Enterprise COBOL compile has settled yet`,
          });
        }
        if (truncOpt && !sizeError) {
          const int = naturalInt(items, numeric);
          for (const r of receivers) {
            const rp = placesOf(r.picture);
            if (rp && BINARY_USAGE.has(String(r.effectiveUsage || '').toUpperCase()) && int !== null && int > rp.int) narrowed.push({ st, r, rp, int, via: 'COMPUTE' });
          }
        }
        continue;
      }

      if (!truncOpt || sizeError) continue;
      if (st.verb === 'MOVE' && !st.corresponding) {
        const to = seg.findIndex((t) => t.t === 'word' && t.u === 'TO');
        if (to !== 1) continue;
        const src = seg[0];
        const sp = src.t === 'num' || (src.t === 'word' && /^[+-]?\d/.test(src.v)) ? numberPlaces(src.v) : src.t === 'word' ? numeric({ name: src.u }) : null;
        if (!sp) continue;
        for (const t of seg.slice(to + 1)) {
          if (t.t !== 'word') continue;
          const r = byName.get(t.u);
          const rp = r && placesOf(r.picture);
          if (rp && BINARY_USAGE.has(String(r.effectiveUsage || '').toUpperCase()) && sp.int > rp.int) narrowed.push({ st, r, rp, int: sp.int, via: 'MOVE' });
        }
        continue;
      }
      if (['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE'].includes(st.verb)) {
        const operands = st.sources.map((t) => numeric({ name: t.u })).filter(Boolean);
        const literal = st.literals.map((l) => numberPlaces(l.v)).filter(Boolean);
        const all = [...operands, ...literal];
        if (!all.length) continue;
        for (const t of st.targets) {
          const r = byName.get(t.u);
          const rp = r && placesOf(r.picture);
          if (!rp || !BINARY_USAGE.has(String(r.effectiveUsage || '').toUpperCase())) continue;
          const giving = seg.some((x) => x.t === 'word' && x.u === 'GIVING');
          const int = st.verb === 'MULTIPLY' ? all.reduce((a, b) => a + b.int, giving ? 0 : rp.int)
            : st.verb === 'DIVIDE' ? Math.max(...all.map((x) => x.int))
              : Math.max(...all.map((x) => x.int));
          if (int > rp.int) narrowed.push({ st, r, rp, int, via: st.verb });
        }
      }
    }

    // One finding per statement: the receivers it narrows, and where TRUNC(OPT) was set.
    const byStatement = new Map();
    for (const x of narrowed) {
      if (!byStatement.has(x.st)) byStatement.set(x.st, []);
      byStatement.get(x.st).push(x);
    }
    for (const [st, xs] of byStatement) {
      const shown = xs.slice(0, MAX_SHOWN).map((x) => `${x.r.name} (${x.r.picture} ${String(x.r.effectiveUsage).toUpperCase()}, ${x.rp.int} integer digits) a value with up to ${x.int} integer digits`).join('; ');
      findings.push({
        rule: 'binary-store-exceeds-picture-under-trunc-opt', path, line: st.line, program: p.id,
        detail: `${p.id}: this ${xs[0].via} gives ${shown}, under ${trunc.token} set by ${trunc.where}; what the field then holds depends on the generated code (ironwork's model keeps the binary width, assumption C2, which no Enterprise COBOL compile has settled yet)`,
      });
    }

    if (collatingDeclared) { stats.collatingDeclaredPrograms++; return; }
    const ranges = [];
    for (const it of p.items) if (it.level === 88) for (const r of thruPairs(it.values || [])) ranges.push({ ...r, where: `88 ${it.name}` });
    for (const st of p.statements) {
      if (st.verb !== 'WHEN') continue;
      const run = [];
      for (let k = st.at + 1; k < toks.length; k++) {
        const t = toks[k];
        if (t.t === 'lit' || (t.t === 'word' && WHEN_WORDS.has(t.u))) run.push(t); else break;
      }
      for (const r of thruPairs(run)) ranges.push({ ...r, line: st.line, where: 'WHEN' });
    }
    for (const r of ranges) {
      stats.rangesRead++;
      const e = order(r.lo, r.hi, ebcdicByte);
      const a = order(r.lo, r.hi, asciiCode);
      if (e === null || a === null || e === 0 || a === 0 || e === a) continue;
      findings.push({
        rule: 'character-range-reverses-in-ascii', path, line: r.line, program: p.id,
        detail: `${p.id}: ${r.where} '${r.lo}' THRU '${r.hi}' is ${e < 0 ? 'in order' : 'reversed'} in EBCDIC and ${a < 0 ? 'in order' : 'reversed'} in ASCII, so it is empty ${e < 0 ? 'under an ASCII collating sequence' : 'in EBCDIC, on the mainframe'}`,
      });
    }
  }

  const run = yield loopOver(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    let r;
    try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    const path = relPath(root, f);
    const levels = { site, steps: stepsOf.get(memberName(f)) || [], cards: optionCards(src) };
    const collatingDeclared = /\bPROGRAM\s+COLLATING\s+SEQUENCE\b/i.test(src);
    for (const p of r.programs) judge(p, path, levels, collatingDeclared);
    r = null;
    return src.length;
  }, { label: 'semantics', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('semantics', { rules: SEMANTICS_RULES, findings, stats, run });
}

export const scanSemantics = (root, opts = {}) => drive(scanSemanticsSteps(root, opts));
