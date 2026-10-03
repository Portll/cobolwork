// SPDX-License-Identifier: AGPL-3.0-or-later
// Grades lib/hlasm/locate.mjs against the z390 oracle diag/hlasm-oracle.mjs caches. Only values z390
// gives the same with and without sixteen bytes after each macro call are graded, so none depends on
// a macro's expansion. Locations are compared relative to their section, since a later CSECT's
// origin depends on the length of every one before it. Kinds: LOC, LEN and TYPE per symbol, SLOC per
// open-code statement, ESD per external name, ILEN per machine instruction. A value the locator does
// not place counts as unbuilt, one it places differently as unparsed.
//
//   node diag/hlasm-grade-z390.mjs <corpus-root> [--split dev,heldout] [--samples out.json]
// <corpus-root> holds <split>/<repo>/<path> and oracle/<sha256>.json.
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { locate } from '../lib/hlasm/locate.mjs';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import { HLASM_EXT } from '../lib/sources.mjs';

const KINDS = ['LOC', 'LEN', 'TYPE', 'SLOC', 'ESD', 'ILEN'];
const blank = () => ({ statements: 0, parsed: 0, unbuilt: 0, unparsed: 0, unknown: 0, crashes: 0 });
const sectionName = (n) => (n === '$PRIVATE' ? '' : n);

function files(dir) {
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d).sort()) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (HLASM_EXT.some((x) => p.toLowerCase().endsWith(x))) out.push(p); } };
  walk(dir);
  return out;
}

function gradeFile(text, oracle, record, notGraded) {
  let loc;
  try { loc = locate(text); } catch (e) { record('CRASH', 'file', 'unparsed', String(e && e.message), true); return; }
  const origin = new Map();
  for (const y of oracle.symbols) if (y.type === 'CST' || y.type === 'DST') origin.set(sectionName(y.name), y.type === 'DST' ? 0 : y.loc);
  if (!origin.has('')) origin.set('', 0);
  const mine = new Map(loc.symbols.map((y) => [y.name, y]));
  const relative = (y) => (y.type === 'ABS' ? y.loc : y.loc - (origin.get(sectionName(y.section)) ?? 0));

  for (const y of oracle.symbols) {
    if (!y.stable || y.line == null || y.type === 'CST' || y.type === 'DST' || y.type === 'EXT' || y.type === 'WXT') continue;
    const m = mine.get(y.name);
    const where = `${y.line}:${y.name}`;
    if (!m || m.loc === null) { for (const k of ['LOC', 'LEN', 'TYPE']) record(k, where, 'unbuilt', m ? `not placed (after line ${m.after})` : 'not defined'); continue; }
    const want = relative(y);
    const sameSection = y.type === 'ABS' || sectionName(y.section) === (m.section ?? '');
    record('LOC', where, sameSection && m.loc === want ? 'parsed' : 'unparsed', `z390 ${sectionName(y.section)}+${want}, locator ${m.section}+${m.loc}`);
    // z390 gives an EQU with no length operand length 1 where HLASM takes its leftmost term's length
    // (SC26-4940-09, EQU instruction), so an EQU's length is the one value z390 cannot grade.
    if (m.how === 'EQU') notGraded.equLengths++;
    else record('LEN', where, m.len === y.len ? 'parsed' : 'unparsed', `z390 ${y.len}, locator ${m.len}`);
    record('TYPE', where, m.type === y.type ? 'parsed' : 'unparsed', `z390 ${y.type}, locator ${m.type}`);
  }

  const placed = new Map(loc.statements.map((s) => [s.line, s]));
  const sectionOfLine = (line) => placed.get(line)?.section;
  for (const s of oracle.statements) {
    if (!s.stable) continue;
    const m = placed.get(s.line);
    const where = `${s.line}`;
    if (!m || m.loc === null) { record('SLOC', where, 'unbuilt', 'not placed'); continue; }
    const want = s.loc - (origin.get(sectionOfLine(s.line) ?? '') ?? 0);
    record('SLOC', where, m.loc === want ? 'parsed' : 'unparsed', `z390 +${want}, locator +${m.loc}`);
  }

  const external = new Set([...loc.esd.externals.map((e) => e.name), ...loc.esd.entries.map((e) => e.name)]);
  const sections = new Set(loc.sections.filter((s) => s.type === 'CST').map((s) => s.name));
  for (const e of oracle.esd) {
    const name = sectionName(e.name);
    if (!name) continue;
    const found = e.type === 'CST' ? sections.has(name) : external.has(name);
    record('ESD', `${e.type}:${name}`, found ? 'parsed' : 'unbuilt', found ? '' : `${e.type} ${name} not found`);
  }

  const statements = new Map(readHlasmStatements(text).statements.map((s) => [s.line, s]));
  for (const s of oracle.statements) {
    if (!s.instruction || s.objLen == null) continue;
    const st = statements.get(s.line);
    const r = st ? parseHlasmStatement(st) : null;
    if (!r || r.status !== 'parsed' || r.node.kind !== 'INSTRUCTION') { record('ILEN', `${s.line}`, 'unbuilt', r ? `${r.kind} ${r.status}` : 'no statement'); continue; }
    record('ILEN', `${s.line}`, r.node.length === s.objLen ? 'parsed' : 'unparsed', `z390 ${s.objLen}, table ${r.node.length}`);
  }
}

// The statement-measure shape the lane runner compares before and after a draft.
export function measure(root, { statusMap = null, perKind = 25, oracle = join(dirname(root), 'oracle') } = {}) {
  const byKind = Object.fromEntries(KINDS.map((k) => [k, blank()]));
  const byRepo = {};
  const samples = {};
  const counts = { files: 0, graded: 0, ungraded: 0, noOracle: 0 };
  const notGraded = { equLengths: 0 };
  for (const f of files(root)) {
    const buf = readFileSync(f);
    const sha = createHash('sha256').update(buf).digest('hex');
    const p = join(oracle, `${sha}.json`);
    counts.files++;
    if (!existsSync(p)) { counts.noOracle++; continue; }
    const o = JSON.parse(readFileSync(p, 'utf8'));
    if (!o.graded) { counts.ungraded++; continue; }
    counts.graded++;
    const rel = relative(root, f);
    const repo = rel.split('/')[0];
    const r = (byRepo[repo] ||= blank());
    gradeFile(buf.toString('latin1'), o, (kind, where, status, reason, crash = false) => {
      const k = (byKind[kind] ||= blank());
      k.statements++; k[status]++; r.statements++; r[status]++;
      if (crash) { k.crashes++; r.crashes++; }
      if (statusMap) statusMap[`${rel}:${kind}:${where}`] = status;
      if (status !== 'parsed' && (samples[kind] ||= []).length < perKind) samples[kind].push({ file: rel, line: Number(String(where).split(':')[0]) || 0, status, reason, text: where });
    }, notGraded);
  }
  const all = Object.values(byRepo).reduce((a, x) => { for (const k of Object.keys(a)) a[k] += x[k]; return a; }, blank());
  const rate = (t) => (t.statements ? +(t.parsed / t.statements).toFixed(4) : null);
  return {
    summary: { ...counts, notGraded, all: { ...all, rate: rate(all) }, natural: { ...all, rate: rate(all) }, repoBalancedRate: null, synthetic: [] },
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { ...v, rate: rate(v) }])),
    byRepo, samples,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = process.argv.slice(2);
  const flag = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
  const root = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  const out = {};
  for (const split of String(flag('split', 'dev,heldout')).split(',')) {
    const m = measure(join(root, split), { oracle: join(root, 'oracle') });
    out[split] = { summary: m.summary, byKind: m.byKind, samples: Object.fromEntries(Object.entries(m.samples).map(([k, v]) => [k, v.slice(0, 8)])) };
  }
  const samplesFile = flag('samples', null);
  if (samplesFile) writeFileSync(samplesFile, JSON.stringify(out, null, 1));
  for (const [split, m] of Object.entries(out)) {
    console.log(`${split}: ${m.summary.graded} graded files of ${m.summary.files}; ${m.summary.all.parsed} of ${m.summary.all.statements} values agree (${m.summary.all.rate})`);
    for (const [k, v] of Object.entries(m.byKind)) console.log(`  ${k.padEnd(5)} agree ${v.parsed}, differ ${v.unparsed}, unplaced ${v.unbuilt} of ${v.statements}${v.rate === null ? '' : ` (${v.rate})`}`);
  }
}
