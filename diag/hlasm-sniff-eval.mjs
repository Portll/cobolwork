// SPDX-License-Identifier: AGPL-3.0-or-later
// Grades extensionless-sniff variants against a reader label over the members under the given
// directories. Label: assembler when >= 5 statements and >= half of them are machine or assembler
// instructions, conditional assembly, macro definition or model statements the reader accepts
// (unknown macro calls do not count, so prose stays out). JCL, COBOL, copybooks and BMS, by the
// scanner's own tests over the whole member, are other sources and left out of both columns.
//   node diag/hlasm-sniff-eval.mjs <members-dir>... [--json out.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const out = jsonAt < 0 ? null : args.splice(jsonAt, 2)[1];
const ROOTS = args;

const JCL = /^\s*\/\/\S*\s+(?:JOB|EXEC|PROC|DD)\b/m;
const PROGRAM = /\bIDENTIFICATION\s+DIVISION|\bPROGRAM-ID\s*\./i;
const COPYBOOK = /^[^*\n]{0,10}\s*\d\d\s+[A-Z][A-Z0-9-]*\s+(?:PIC|PICTURE|OCCURS|REDEFINES|USAGE)\b/im;
const BMS = /^[^*\s]*[ \t]+DFHMSD(?=\s|$)/im;
const other = (t) => JCL.test(t) || PROGRAM.test(t) || COPYBOOK.test(t) || BMS.test(t);

const op = (ops) => new RegExp(String.raw`^[^*\s]*[ \t]+(?:${ops})(?=\s|$)`, 'm');
const FIRST = op('CSECT|RSECT|START|MACRO');
const SECOND = op('USING|DC|DS|BALR|BASR|STM|STMG|MEND');
const FIRST_X = op('CSECT|RSECT|START|MACRO|DSECT|TITLE|ENTRY|AMODE|RMODE');
const SECOND_X = op('USING|DC|DS|BALR|BASR|STM|STMG|MEND|AIF|AGO|SETA|SETB|SETC|GBLA|GBLB|GBLC|LCLA|LCLB|LCLC|ANOP|MNOTE|EQU|LTORG|EJECT|PRINT');

const variants = {
  'v0 4K current': (b) => sniff(b, 4096, FIRST, SECOND),
  'v1 16K current': (b) => sniff(b, 16384, FIRST, SECOND),
  'v2 64K current': (b) => sniff(b, 65536, FIRST, SECOND),
  'v3 whole current': (b) => sniff(b, Infinity, FIRST, SECOND),
  'v4 4K extended': (b) => sniff(b, 4096, FIRST_X, SECOND_X),
  'v5 16K extended': (b) => sniff(b, 16384, FIRST_X, SECOND_X),
  'v6 64K extended': (b) => sniff(b, 65536, FIRST_X, SECOND_X),
  'v8 v7 + instructions in the 64K read': (b) => {
    const head = sniff(b, 4096, FIRST, SECOND);
    if (head.hit || !cardShaped(b.subarray(0, 4096).toString('latin1'))) return head;
    const text = b.subarray(0, Math.min(b.length, 65536)).toString('latin1');
    return { hit: (FIRST_X.test(text) && SECOND_X.test(text)) || instructions(text) >= 5, read: Math.min(b.length, 65536) };
  },
  'v9 4K current, else 64K extended + instructions for any text head': (b) => {
    const head = sniff(b, 4096, FIRST, SECOND);
    if (head.hit || b.subarray(0, 4096).includes(0)) return head;
    const text = b.subarray(0, Math.min(b.length, 65536)).toString('latin1');
    return { hit: (FIRST_X.test(text) && SECOND_X.test(text)) || instructions(text) >= 5, read: Math.min(b.length, 65536) };
  },
  'v7 4K current, else 64K extended when the head is card-shaped': (b) => {
    const head = sniff(b, 4096, FIRST, SECOND);
    if (head.hit || !cardShaped(b.subarray(0, 4096).toString('latin1'))) return head;
    const more = sniff(b, 65536, FIRST_X, SECOND_X);
    return { hit: more.hit, read: more.read };
  },
};

function sniff(buf, window, first, second) {
  const head = buf.subarray(0, Math.min(buf.length, window));
  const text = head.toString('latin1');
  return { hit: !head.includes(0) && first.test(text) && second.test(text), read: head.length };
}

// Lines whose operation is a common machine instruction with a register and a second operand.
const INSTRUCTION = /^[^*\s]*[ \t]+(?:L|LA|LR|LH|ST|STH|STM|LM|MVC|MVI|CLC|CLI|CL|CR|CH|C|LTR|TM|IC|STC|SR|AR|A|S|N|O|X|NI|OI|XC|NC|OC|ZAP|AP|SP|CVD|CVB|PACK|UNPK|ED|EX|BAL|BALR|BAS|BASR|BCT|BXLE|BXH|SLL|SRL|SLA|SRA|SLDL|SRDL|ICM|STCM|CLM|TR|TRT|MVCL|CLCL)[ \t]+(?:R?\d{1,2}|[A-Z$#@][A-Z0-9$#@_]*\(?)[^ \t,]*,\S/gim;
const instructions = (text) => new Set(text.match(INSTRUCTION) || []).size;

// Most lines are assembler comments or fit the card's fields: what a long assembler prologue looks
// like and a prose document mostly does not.
function cardShaped(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 10) return false;
  const card = lines.filter((l) => /^(?:\*|\.\*)/.test(l) || /^(?:[A-Z$#@&.][A-Z0-9$#@_&.]{0,62})?[ \t]+[A-Z$#@][A-Z0-9$#@]{0,7}(?:[ \t]|$)/i.test(l)).length;
  return card / lines.length >= 0.8;
}

const ACCEPTED_KINDS = new Set(['UNKNOWN', 'UNREADABLE', 'MACRO CALL']);
function label(text) {
  let statements = 0;
  let known = 0;
  for (const st of readHlasmStatements(text).statements) {
    if (st.kind !== 'statement') continue;
    statements++;
    const r = parseHlasmStatement(st);
    const kind = (r.kind === 'MODEL' || r.kind === 'SUBSTITUTED') && r.node ? r.node.as : r.kind;
    if (!ACCEPTED_KINDS.has(kind) && (r.status === 'parsed' || r.status === 'unbuilt')) known++;
  }
  if (statements < 5) return 'tiny';
  return known / statements >= 0.5;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const tally = Object.fromEntries(Object.keys(variants).map((k) => [k, { tp: 0, fn: 0, fp: 0, tn: 0, bytes: 0, fpExamples: [], fnExamples: [] }]));
const counts = { members: 0, binary: 0, other: 0, iebupdte: 0, tiny: 0, assembler: 0, text: 0 };
const IEBUPDTE = /^\.\/\s+(?:ADD|REPL|CHANGE|REPRO)\s/m;
for (const root of ROOTS) for (const f of walk(root)) {
  const buf = readFileSync(f);
  counts.members++;
  if (buf.subarray(0, 4096).includes(0)) { counts.binary++; continue; }
  const text = buf.toString('latin1');
  if (other(text)) { counts.other++; continue; }
  if (IEBUPDTE.test(text)) { counts.iebupdte++; continue; }
  const isAsm = label(text);
  if (isAsm === 'tiny') { counts.tiny++; continue; }
  isAsm ? counts.assembler++ : counts.text++;
  for (const [k, v] of Object.entries(variants)) {
    const r = v(buf);
    const t = tally[k];
    t.bytes += r.read;
    if (isAsm && r.hit) t.tp++;
    else if (isAsm) { t.fn++; if (t.fnExamples.length < 8) t.fnExamples.push(relative(root, f)); }
    else if (r.hit) { t.fp++; if (t.fpExamples.length < 8) t.fpExamples.push(relative(root, f)); }
    else t.tn++;
  }
}
console.log(JSON.stringify(counts));
for (const [k, t] of Object.entries(tally)) {
  console.log(`${k.padEnd(62)} recall ${(t.tp / (t.tp + t.fn)).toFixed(4)}  fn ${String(t.fn).padStart(5)}  fp ${String(t.fp).padStart(4)}  precision ${(t.tp / (t.tp + t.fp)).toFixed(4)}  read ${(t.bytes / 1e6).toFixed(0)} MB`);
}
if (out) writeFileSync(out, JSON.stringify({ counts, tally }, null, 1));
