// Grades the parser's sizes and offsets against the Data Division Map of an Enterprise COBOL
// listing: each map item is paired with the parser's item of the same depth and name, and its
// byte length and its displacement within the record are compared. The source is the listing's
// own, COPY-expanded, so no copybook is read unless the listing suppressed one, which --copy-dir
// supplies. The map's hierarchy column is the item's depth, 1 for a record, not its level number.
//
//   node diag/grade-against-ibm.mjs <listing>... [--out <file>] [--samples <n>] [--copy-dir <dir>]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseSource } from '../lib/parser.mjs';
import { parseIbmListing, sourceText } from './ibm-listing.mjs';
import { alignProgramKeys, compareFacts, factsFromListing, factsFromParse, multisetDiff } from './compare.mjs';

const args = process.argv.slice(2);
const valueOf = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const OUT = valueOf('--out');
const SAMPLES = Number(valueOf('--samples') ?? 20);
const COPY_DIR = valueOf('--copy-dir');
const files = args.filter((a, i) => !a.startsWith('--') && !['--out', '--samples', '--copy-dir'].includes(args[i - 1]));

const n30 = (s) => String(s).toUpperCase().slice(0, 30);
const plain = (name) => (/^FILLER/.test(name) ? 'FILLER' : n30(name));

function depthOf(item) {
  let depth = 1;
  for (let p = item.parent; p; p = p.parent) depth++;
  return depth;
}

function witnessSymbols(unit, nested) {
  const symbols = [];
  const offsets = [];
  for (const m of unit.map) {
    if (m.level === 88 || m.level === 'RD' || m.level === 'CD') continue;
    const prog = nested ? m.program : '';
    const name = plain(m.name);
    symbols.push({ prog, lvl: String(m.level), name, size: m.bytes });
    if (m.displacement != null && typeof m.level === 'number') offsets.push({ prog, lvl: String(m.level), name, offset: m.displacement });
  }
  return { symbols, offsets };
}

// The map prints one occurrence of a table whatever its usage; the parser prints the whole table
// for a group and for POINTER and INDEX, as GnuCOBOL's listing does.
function oneOccurrence(it) {
  const whole = it.occurs > 1 && (it.children?.length > 0 || ["POINTER", "INDEX"].includes(it.effectiveUsage || ""));
  return whole && it.size != null ? it.size / it.occurs : it.size;
}

// The parser's items with each level replaced by the item's depth, as the map prints it, and
// level 77 kept, as the map prints that too.
function mineSymbols(parsed) {
  const nested = parsed.programs.length > 1;
  const symbols = [];
  const offsets = [];
  for (const p of parsed.programs) {
    const prog = nested ? (p.id || '').replace(/^["']|["']$/g, '') : '';
    for (const fd of p.fds || []) symbols.push({ prog, lvl: 'FD', name: n30(fd.name), size: fd.size });
    for (const it of p.items) {
      if (it.level === 78 || it.level === 88 || it.constant || it.typeClone || it.section === 'COMMUNICATION') continue;
      const lvl = it.level === 77 ? '77' : String(depthOf(it));
      symbols.push({ prog, lvl, name: plain(it.name), size: oneOccurrence(it), section: it.section });
      if (it.offset != null) offsets.push({ prog, lvl, name: plain(it.name), offset: it.offset });
    }
  }
  return { symbols, offsets };
}

const total = { listings: 0, units: 0, parserThrew: 0, symbols: { witness: 0, mine: 0, matched: 0 }, sizes: { compared: 0, agree: 0 }, offsets: { compared: 0, agree: 0 }, samples: { sizeWrong: [], offsetWrong: [], symMissing: [], symExtra: [] }, rows: [] };
const sample = (kind, x) => { if (total.samples[kind].length < SAMPLES) total.samples[kind].push(x); };

for (const file of files) {
  const listing = parseIbmListing(readFileSync(file, 'latin1'));
  total.listings++;
  for (const unit of listing.units) {
    if (!unit.map.length) continue;
    total.units++;
    const programs = [...new Set(unit.map.map((m) => m.program))];
    const nested = programs.length > 1;
    const opts = COPY_DIR ? { format: 'fixed', std: 'ibm', mainDir: COPY_DIR, includeDirs: [COPY_DIR] } : { format: 'fixed', std: 'ibm', readText: () => '' };
    let parsed;
    try { parsed = parseSource(sourceText(unit), `${unit.name || 'UNIT'}.cbl`, opts); } catch (e) { total.parserThrew++; total.rows.push({ listing: basename(file), unit: unit.name, threw: String(e && e.message).slice(0, 120) }); continue; }
    const w = witnessSymbols(unit, nested);
    const m = mineSymbols(parsed);
    const witness = alignProgramKeys(factsFromListing({ symbols: w.symbols, xref: [], labels: [], calls: [] }), programs);
    const mine = alignProgramKeys({ symbols: m.symbols, xref: [], labels: [], calls: [] }, programs);
    const c = compareFacts(witness, mine);
    const od = multisetDiff(w.offsets, m.offsets, (x) => `${x.prog}|${x.lvl}|${x.name}`);
    let offsetAgree = 0;
    for (const [a, b] of od.matched) {
      if (a.offset === b.offset) offsetAgree++;
      else sample('offsetWrong', { listing: basename(file), unit: unit.name, name: a.name, depth: a.lvl, witness: a.offset, mine: b.offset });
    }
    total.rows.push({ listing: basename(file), unit: unit.name, compiler: listing.compiler, symbols: c.symbols, sizes: c.sizes, offsets: { compared: od.matched.length, agree: offsetAgree } });
    for (const k of ['witness', 'mine', 'matched']) total.symbols[k] += c.symbols[k];
    total.sizes.compared += c.sizes.compared;
    total.sizes.agree += c.sizes.agree;
    total.offsets.compared += od.matched.length;
    total.offsets.agree += offsetAgree;
    for (const s of c.samples.sizeWrong) sample('sizeWrong', { listing: basename(file), unit: unit.name, name: s.name, depth: s.lvl, witness: s.witness, mine: s.mine, section: s.section });
    for (const s of c.samples.symMissing) sample('symMissing', { listing: basename(file), unit: unit.name, depth: s.lvl, name: s.name });
    for (const s of c.samples.symExtra) sample('symExtra', { listing: basename(file), unit: unit.name, depth: s.lvl, name: s.name, section: s.section });
  }
}

if (OUT) writeFileSync(OUT, JSON.stringify(total, null, 2) + '\n');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(2)}%` : 'n/a');
console.log(`${total.listings} listings, ${total.units} units with a map, ${total.parserThrew} the parser refused`);
console.log(`symbols: witness ${total.symbols.witness}, mine ${total.symbols.mine}, matched ${total.symbols.matched}`);
console.log(`sizes: ${total.sizes.agree} of ${total.sizes.compared} agree (${pct(total.sizes.agree, total.sizes.compared)})`);
console.log(`offsets: ${total.offsets.agree} of ${total.offsets.compared} agree (${pct(total.offsets.agree, total.offsets.compared)})`);
for (const kind of ['sizeWrong', 'offsetWrong', 'symMissing', 'symExtra']) {
  if (!total.samples[kind].length) continue;
  console.log(`\n${kind}:`);
  for (const s of total.samples[kind]) console.log('  ' + JSON.stringify(s));
}
