// SPDX-License-Identifier: AGPL-3.0-or-later
// How often the HLASM reader agrees with an assembler about which statements are well formed: z390's
// verdict on each open-code statement of each file the oracle assembled, against the reader's. A
// statement z390 reports a syntax error on is one it refuses; an error that needs the symbol table
// (an undefined symbol, a base register, a missing COPY) says nothing about the statement's form.
// Macro calls are left out: z390 stubs the macros it lacks and cannot judge their operands.
//   node diag/hlasm-agreement.mjs <corpus-root> <split> <oracle-dir> [--json out.json]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { decodeSource } from '../lib/sources.mjs';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import { readHlasm, isDocument } from '../lib/hlasm.mjs';

const [root, split, oracleDir] = process.argv.slice(2);
const judgeCalls = process.argv.includes('--calls');
const forms = { mvs38: !process.argv.includes('--no-mvs38-forms') };
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const SEMANTIC = /symbol not (?:defined|found)|USING|base reg|addressab|END entry|csect end|missing copy|not found|undefined|duplicate|previously defined|batch assemblies|abort|length attribute|rld expression|absolute value|displacement|duplication factor|invalid length/i;
const SYNTAX = /parsing error|invalid|delimiter|continuation|out of range|hex length|must be less|must start|unbalanced|missing operand|too many|unknown|illegal|expected|truncated|not allowed|operand/i;
// What z390 refuses and HLASM takes: a source line holding a character outside ASCII (error 138),
// and the Unicode constants CU and CA (error 45). Those statements are not judged.
// Q-type address constants and an exponent modifier on a floating-point constant (DE-1'1') too.
// z390's own macros MNOTE operands they do not implement: a limit of the oracle, not a refusal.
const unsupportedMnote = (e) => e.number === 'MNOTE' && /NOT SUPPORTED|NON-SUPPORTED|UNSUPPORTED|ONLY SUPPORTS|NOT A SUPPORT/i.test(e.text);
const oracleLimit = (e) => unsupportedMnote(e) || e.number === 138 || (e.number === 45 && /type - (?:C[UA]\b|[DE][EDHB]?-)/.test(e.text)) || (e.number === 51 && /type - Q\b/.test(e.text));
const verdictOf = (e) => (oracleLimit(e) ? 'oracle limit' : SEMANTIC.test(e.text) ? 'semantic' : SYNTAX.test(e.text) ? 'syntax' : 'other');

const walk = (d, o = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p, o) : o.push(p); } return o; };
const nines = (x) => (x >= 1 ? '∞' : (-Math.log10(1 - x)).toFixed(2));

const counts = { files: 0, noOracle: 0, aborted: 0, definitions: 0, judged: 0, bothAccept: 0, bothRefuse: 0, falseRefusal: 0, falseAcceptance: 0, macroCalls: 0, otherErrors: 0, oracleLimit: 0, ibmBacked: 0, callsJudged: 0, callsAgree: 0, callFalseRefusal: 0, callFalseAcceptance: 0, callsMvs38: 0, callsLimited: 0, listings: 0, documents: 0 };
const why = { falseRefusal: new Map(), falseAcceptance: new Map(), callFalseRefusal: new Map(), callFalseAcceptance: new Map() };
const errorKinds = new Map();
const note = (map, key, example) => { const v = map.get(key) || { n: 0, ex: [] }; v.n++; if (v.ex.length < 3) v.ex.push(example); map.set(key, v); };

for (const f of walk(join(root, split))) {
  const buf = readFileSync(f);
  const sha = createHash('sha256').update(buf).digest('hex');
  const at = join(oracleDir, `${sha}.json`);
  counts.files++;
  if (!existsSync(at)) { counts.noOracle++; continue; }
  const o = JSON.parse(readFileSync(at, 'utf8'));
  if (o.why && /abort|no PRN|did not finish/i.test(o.why)) { counts.aborted++; continue; }
  // A macro definition is not assembled on its own, so z390 says nothing about its statements.
  if (o.why === 'macro definition') { counts.definitions++; continue; }
  const calls = new Set(o.macroCalls || []);
  const refusedAt = new Map();
  const expansionRefused = new Map();
  const limitedCalls = new Set();
  const stubbed = new Set((o.stubs || []).map((m) => m.toUpperCase()));
  const limited = new Set();
  for (const e of o.errors || []) {
    if (e.line == null) continue;
    // An error in a macro's expansion, or its MNOTE, is the macro refusing the call written on that line.
    if (e.generated) { const v = verdictOf(e); if (v === 'oracle limit') limitedCalls.add(e.line); else if (v !== 'semantic') expansionRefused.set(e.line, e); continue; }
    const v = verdictOf(e);
    errorKinds.set(`${v} ${e.number}`, (errorKinds.get(`${v} ${e.number}`) || 0) + 1);
    if (v === 'oracle limit') limited.add(e.line);
    else if (v === 'syntax') refusedAt.set(e.line, e);
    else if (v === 'other') counts.otherErrors++;
  }
  const decoded = decodeSource(buf);
  const text = decoded.text;
  // z390 reads bytes, so on a line holding a character UTF-8 writes in more than one byte its
  // columns are not the source's; such a line, and one that may continue it, is not judged.
  const wide = new Set();
  if (decoded.encoding === 'utf-8') text.split(/\r?\n/).forEach((l, i) => { if (/[^\x00-\x7f]/.test(l)) { wide.add(i + 1); wide.add(i + 2); } });
  // As a scan does: a listing and a document are not read as source.
  if (readHlasm(text).kind === 'listing') { counts.listings++; continue; }
  const all = readHlasmStatements(text).statements;
  const open = all.filter((st) => !st.inMacro);
  const refusedHere = open.filter((st) => { const r = parseHlasmStatement(st, forms); return r.status === 'unparsed' || r.status === 'unknown'; }).length;
  if (isDocument(all.filter((st) => st.kind === 'statement'), open.length, refusedHere)) { counts.documents++; continue; }
  for (const st of all) {
    if (st.inMacro || st.kind !== 'statement') continue;
    if (calls.has(st.line)) {
      counts.macroCalls++;
      if (!judgeCalls || stubbed.has(String(st.operation).toUpperCase())) continue;
      if (limitedCalls.has(st.line)) { counts.callsLimited++; continue; }
      const r = parseHlasmStatement(st, forms);
      const ours = r.status === 'parsed';
      const theirs = !expansionRefused.has(st.line) && !refusedAt.has(st.line);
      const example = `${f.slice(root.length + 1)}:${st.line} ${st.operation} ${String(st.field).slice(0, 60)}`;
      counts.callsJudged++;
      if (r.node?.mvs38) counts.callsMvs38++;
      if (ours === theirs) counts.callsAgree++;
      else if (!ours) { counts.callFalseRefusal++; note(why.callFalseRefusal, `${r.kind}: ${(r.reason || '').replace(/'[^']*'/g, "'…'").replace(/\b\d+\b/g, 'n').slice(0, 70)}`, example); }
      else { const e = expansionRefused.get(st.line) || refusedAt.get(st.line); counts.callFalseAcceptance++; note(why.callFalseAcceptance, `${st.operation} / z390 ${e.number}: ${e.text.replace(/\d+/g, 'n').slice(0, 60)}`, example); }
      continue;
    }
    if (limited.has(st.line) || (st.continues && limited.has(st.line - 1)) || st.lines.some((n) => wide.has(n))) { counts.oracleLimit++; continue; }
    const r = parseHlasmStatement(st, forms);
    if (r.kind === 'CONDITIONAL' || r.kind === 'MACRO DEFINITION' || r.status === 'unbuilt') continue;
    counts.judged++;
    const ours = r.status === 'parsed';
    const theirs = !refusedAt.has(st.line);
    const example = `${f.slice(root.length + 1)}:${st.line} ${st.operation} ${String(st.field).slice(0, 60)}`;
    if (ours && theirs) counts.bothAccept++;
    else if (!ours && !theirs) counts.bothRefuse++;
    else if (!ours) { counts.falseRefusal++; if (/CONTINUED|MSG takes|DD takes|DSECT/.test(`${r.kind} ${r.reason}`)) counts.ibmBacked++; note(why.falseRefusal, `${r.kind}: ${(r.reason || '').replace(/'[^']*'/g, "'…'").replace(/\b\d+\b/g, 'n').slice(0, 70)}`, example); }
    else { counts.falseAcceptance++; note(why.falseAcceptance, `${r.kind} / z390 ${refusedAt.get(st.line).number}: ${refusedAt.get(st.line).text.replace(/\d+/g, 'n').slice(0, 60)}`, example); }
  }
}
const agree = counts.bothAccept + counts.bothRefuse;
const out = { split, counts, agreement: agree / counts.judged, errorKinds: Object.fromEntries([...errorKinds].sort((a, b) => b[1] - a[1])), falseRefusal: Object.fromEntries([...why.falseRefusal].sort((a, b) => b[1].n - a[1].n)), falseAcceptance: Object.fromEntries([...why.falseAcceptance].sort((a, b) => b[1].n - a[1].n)) };
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
console.log(`## ${split}: ${counts.files} files (${counts.noOracle} without an oracle result, ${counts.definitions} macro definitions, ${counts.aborted} aborted, ${counts.listings} listings, ${counts.documents} documents); ${counts.judged} statements judged, ${counts.macroCalls} macro calls and ${counts.oracleLimit} past z390's limits left out`);
console.log(`  refusals IBM's documentation supports (column 72 continuation, an instruction before a library macro): ${counts.ibmBacked}; without them ${(agree + counts.ibmBacked)}/${counts.judged} = ${((agree + counts.ibmBacked) / counts.judged).toFixed(6)} (${nines((agree + counts.ibmBacked) / counts.judged)} nines)`);
console.log(`  agreement ${agree}/${counts.judged} = ${(agree / counts.judged).toFixed(6)} (${nines(agree / counts.judged)} nines); false refusals ${counts.falseRefusal}, false acceptances ${counts.falseAcceptance}, both refuse ${counts.bothRefuse}`);
for (const [k, v] of [...why.falseRefusal].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`  refused, z390 accepts ${String(v.n).padStart(5)} ${k} | ${v.ex.map((e) => e.slice(0, 90)).join(" || ")}`);
for (const [k, v] of [...why.falseAcceptance].sort((a, b) => b[1].n - a[1].n).slice(0, 8)) console.log(`  accepted, z390 refuses ${String(v.n).padStart(5)} ${k}`);
if (judgeCalls) {
  console.log(`  macro calls judged against expanded macros: ${counts.callsAgree}/${counts.callsJudged} = ${(counts.callsAgree / counts.callsJudged).toFixed(6)} (${nines(counts.callsAgree / counts.callsJudged)} nines); we refuse, the macro takes ${counts.callFalseRefusal}; we accept, the macro refuses ${counts.callFalseAcceptance}; read as MVS 3.8 forms ${counts.callsMvs38}; left out where z390's macro does not implement the operands ${counts.callsLimited}`);
  for (const [k, v] of [...why.callFalseRefusal].sort((a, b) => b[1].n - a[1].n).slice(0, 10)) console.log(`  call refused, macro takes ${String(v.n).padStart(5)} ${k} | ${v.ex[0].slice(0, 80)}`);
  for (const [k, v] of [...why.callFalseAcceptance].sort((a, b) => b[1].n - a[1].n).slice(0, 10)) console.log(`  call taken, macro refuses ${String(v.n).padStart(5)} ${k} | ${v.ex[0].slice(0, 80)}`);
  if (jsonOut) writeFileSync(jsonOut.replace(/\.json$/, '.calls.json'), JSON.stringify({ callFalseRefusal: Object.fromEntries(why.callFalseRefusal), callFalseAcceptance: Object.fromEntries(why.callFalseAcceptance) }, null, 1));
}
