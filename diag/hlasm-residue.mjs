// SPDX-License-Identifier: AGPL-3.0-or-later
// Classifies every statement the HLASM reader does not parse, outside conditional assembly, by a
// machine rule, and reports what each class costs: the parse rate with the class fixed or taken out
// of the denominator.
//   node diag/hlasm-residue.mjs <corpus-root> <split> [--json out.json]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { decodeSource } from '../lib/sources.mjs';
import { readHlasmStatements, parseHlasmStatement, NAMED_MACROS } from '../lib/hlasm/read.mjs';

const [root, split] = process.argv.slice(2);
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const MVS38_EXTKEYS = /invalid EXTKEY value (SUPR|SCHED|DATAMGT|TCAM|VTAM|HASP|JES|RBT\d?|\w+)/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function libraryOf(repo) {
  const dir = join(root, 'members', repo);
  if (!existsSync(dir)) return { names: new Set(), macros: new Set() };
  const names = new Set();
  const macros = new Set();
  for (const f of readdirSync(dir)) {
    const name = basename(f, extname(f)).toUpperCase();
    names.add(name);
    if (!NAMED_MACROS.has(name)) continue;
    const first = readHlasmStatements(decodeSource(readFileSync(join(dir, f))).text).statements.find((s) => s.kind === 'statement');
    if (first?.operation === 'MACRO') macros.add(name);
  }
  return { names, macros };
}

function classify(st, r, raw, library) {
  const reason = r.reason || `${r.kind} ${r.status}`;
  const op = String(st.operation || '');
  if (/^\/\//.test(raw) || /^\/\*/.test(raw.trim())) return 'not assembler: JCL';
  if (r.kind === 'UNREADABLE' || /[a-z]/.test(op) || /[:;!?"]|^\(|\)$/.test(op) || (r.kind === 'UNKNOWN' && !/^[A-Z$#@&.*]/.test(op))) return 'not assembler: prose';
  if (/[\x00-\x08\x0e-\x1f\x7f-\x9f]/.test(raw) || (/quoted string in the operands is not closed/.test(reason) && /[^\x20-\x7e]/.test(raw))) return 'unload artefact';
  if (/decided when the macro is expanded/.test(reason)) return 'decided at expansion';
  if (/MODESET: invalid EXTKEY value/.test(reason)) return 'MVS 3.8 dialect: MODESET EXTKEY';
  if (r.kind && /^[A-Z]{1,4}$/.test(r.kind) && library.names.has(op.toUpperCase())) return 'library macro named like an instruction';
  return `reader: ${r.kind}: ${reason.replace(/'[^']*'/g, "'…'").replace(/\b\d+\b/g, 'n').slice(0, 70)}`;
}

let total = 0;
let parsed = 0;
const scope = { open: { total: 0, parsed: 0, asm: 0, classes: {} }, macro: { total: 0, parsed: 0, asm: 0, classes: {} } };
const classes = new Map();
const examples = new Map();
for (const repo of readdirSync(join(root, split)).sort()) {
  const library = libraryOf(repo);
  for (const f of walk(join(root, split, repo))) {
    const text = decodeSource(readFileSync(f)).text;
    const phys = text.split(/\r?\n/);
    for (const st of readHlasmStatements(text, { libraryMacros: library.macros }).statements) {
      const r = parseHlasmStatement(st);
      if (r.kind === 'CONDITIONAL') continue;
      total++;
      const sc = scope[st.inMacro ? 'macro' : 'open'];
      sc.total++;
      if (r.status === 'parsed') { parsed++; sc.parsed++; continue; }
      const c = classify(st, r, phys[st.line - 1] || '', library);
      if (c.startsWith('not assembler') || c === 'unload artefact') sc.asm++;
      sc.classes[c] = (sc.classes[c] || 0) + 1;
      classes.set(c, (classes.get(c) || 0) + 1);
      if (!examples.has(c)) examples.set(c, `${f.slice(root.length + 1)}:${st.line} ${(phys[st.line - 1] || '').slice(0, 90)}`);
    }
  }
}

const failures = total - parsed;
const rows = [...classes].sort((a, b) => b[1] - a[1]);
const groups = {};
for (const [c, n] of rows) { const g = c.startsWith('reader:') ? 'reader gap' : c; groups[g] = (groups[g] || 0) + n; }
const out = { split, total, parsed, failures, rate: parsed / total, scope, groups, classes: Object.fromEntries(rows), examples: Object.fromEntries(examples) };
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
const nines = (x) => (x >= 1 ? 'inf' : (-Math.log10(1 - x)).toFixed(2));
console.log(`## ${split}: ${parsed}/${total} = ${(parsed / total).toFixed(5)} (${nines(parsed / total)} nines); ${failures} failures`);
for (const [g, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(44)} ${String(n).padStart(6)}`);
const notAsm = Object.entries(groups).filter(([g]) => g.startsWith('not assembler') || g === 'unload artefact').reduce((a, [, n]) => a + n, 0);
const denom = total - notAsm;
console.log(`  denominator without non-assembler and artefacts: ${parsed}/${denom} = ${(parsed / denom).toFixed(5)} (${nines(parsed / denom)} nines)`);
const readerGaps = groups['reader gap'] || 0;
console.log(`  ... and with every reader gap fixed: ${(parsed + readerGaps)}/${denom} = ${((parsed + readerGaps) / denom).toFixed(5)} (${nines((parsed + readerGaps) / denom)} nines)`);
for (const [k, v] of Object.entries(scope)) console.log(`  ${k.padEnd(6)} code: ${v.parsed}/${v.total - v.asm} = ${(v.parsed / (v.total - v.asm)).toFixed(5)} (${nines(v.parsed / (v.total - v.asm))} nines) on assembler statements`);
console.log('  top reader gaps:');
for (const [c, n] of rows.filter(([c]) => c.startsWith('reader:')).slice(0, 14)) console.log(`    ${String(n).padStart(5)} ${c.slice(8)}`);
