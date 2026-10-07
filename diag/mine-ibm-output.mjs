#!/usr/bin/env node
// Inventory of IBM compiler and run-time output found in public repositories: which Enterprise
// COBOL levels wrote the listings, which listing sections they carry, and which compile-time and
// run-time message ids appear, with counts and one sample line each. It reads; it copies nothing.
//
//   node diag/mine-ibm-output.mjs [<root>...] [--list FILE] [--under DIR] [--json OUT] [--known]
//
// Roots are walked. --list adds paths from a file, one per line. --under names a directory whose
// first-level entries are repositories, for attribution of listed paths. --known marks each
// run-time id and abend code as known to ironwork (named in its README, docs/run-endings.tsv or
// crates/rt/src, under $IRONWORK or ../ironwork) and to cobolwork (named in lib/sets). A code a
// product matches by a regular expression is not found this way.
//
// A message counts as emitted when the system wrote it: a listing's diagnostic line (a line
// number, then the id), or a run-time id that opens its line after at most carriage control, a
// JES timestamp and job id, or the "+" of a WTO. Anywhere else it is mentioned: documentation,
// fixtures, catalogues, code.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIbmListing } from './ibm-listing.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const HEADER = /PP (\d{4}-[A-Z0-9]{3}) (IBM [A-Za-z/& ]*COBOL[A-Za-z/& ]*?)\s+(\d+\.\d+(?:\.\d+)?)(?:\s+(P\d{6}))?/g;
const SECTIONS = [
  ['Invocation parameters', /Invocation parameters:/],
  ['PROCESS(CBL) statements', /PROCESS\(CBL\) statements:/],
  ['Options in effect', /Options in effect:?/],
  ['Source listing', /LineID\s+PL\s+SL/],
  ['Data Division Map', /Data Division Map/],
  ['Nested Program Map', /Nested Program Map/],
  ['Cross-reference of data names', /Cross-reference of data names/],
  ['Cross-reference of procedures', /Cross-reference of procedures/],
  ['Cross-reference of programs', /Cross-reference of programs/],
  ['Offset listing', /Line\s+#\s+Hexloc\s+Verb/],
  ['Diagnostic messages', /IGY[A-Z]{2}\d{4}-[IWESU]/],
  ['Messages total', /Messages\s+Total\s+Informational/],
  ['Statistics', /Statistics for COBOL program/],
  ['End of compilation', /End of compilation \d+,/],
];
const COMPILE_MESSAGE = /\bIGY[A-Z]{2}\d{4}-[IWESU]\b/g;
const COMPILE_EMITTED = /^\s*\d+\s+IGY[A-Z]{2}\d{4}-[IWESU]\s/;
const RUNTIME = [
  ['IGZ', /\bIGZ\d{4}[SWIC]\b/g],
  ['CEE', /\bCEE\d{4}[SWIC]\b/g],
  ['IEA/IEC/IEF', /\bIE[ACF]\d{3}[IAWE]\b/g],
  ['DFH', /\bDFH[A-Z]{2}\d{4}[IWE]?\b/g],
  ['DSN', /\bDSN[A-Z]\d{3}[IE]\b/g],
  ['IKJ', /\bIKJ\d{5}[IE]\b/g],
];
const RUNTIME_EMITTED = /^[01+ -]?\s*(?:\d{2}[.:]\d{2}[.:]\d{2}\s+\S+\s+)?\+?(?:IGZ\d{4}[SWIC]|CEE\d{4}[SWIC]|IE[ACF]\d{3}[IAWE]|DFH[A-Z]{2}\d{4}|DSN[A-Z]\d{3}[IE]|IKJ\d{5}[IE])(?=\s|$)/;
const ABENDS = [
  /(?:SYSTEM|USER) COMPLETION CODE=([0-9A-F]{3,4})/g,
  /\bABEND[= ](S[0-9A-F]{3}|U\d{4})\b/g,
  /\b(S0C[0-9A-F])\b/g,
];
const ABEND_EMITTED = /COMPLETION CODE=|ABENDED|ABEND=/;
const KNOWN_TOKEN = /\b(S[0-9A-F]{3}|U\d{4}|IGZ\d{4}[SWIC]|CEE\d{4}[SWIC])\b/g;

function main(argv) {
  const roots = [];
  const lists = [];
  const under = [];
  let jsonOut = null;
  let known = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') lists.push(argv[++i]);
    else if (a === '--under') under.push(resolve(argv[++i]));
    else if (a === '--json') jsonOut = argv[++i];
    else if (a === '--known') known = true;
    else roots.push(resolve(a));
  }
  const paths = [];
  for (const root of roots) walk(root, paths);
  for (const list of lists) paths.push(...readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
  const inventory = inventoryOf(paths, [...roots, ...under]);
  if (known) markKnown(inventory);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(inventory, (k, v) => (v instanceof Set ? [...v] : v), 2) + '\n');
  process.stdout.write(markdown(inventory, known));
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (st.isFile() && st.size <= MAX_BYTES) out.push(path);
  }
}

function repoOf(path, attribution) {
  for (const root of attribution) {
    if (path.startsWith(root + sep)) return path.slice(root.length + 1).split(sep)[0];
  }
  return dirname(path).split(sep).pop();
}

function tally(map, key, path, sample, emitted = false) {
  const entry = map[key] ?? (map[key] = { count: 0, emitted: 0, files: new Set(), sample: null, sampleEmitted: false });
  entry.count += 1;
  entry.files.add(path);
  if (emitted) entry.emitted += 1;
  if (sample != null && (entry.sample == null || (emitted && !entry.sampleEmitted))) {
    entry.sample = sample;
    entry.sampleEmitted = emitted;
  }
}

export function inventoryOf(paths, attribution) {
  const inv = { files: 0, withHeader: 0, skipped: 0, compilers: {}, sections: {}, options: {}, compileMessages: {}, runtimeMessages: {}, abends: {}, repos: {} };
  for (const path of paths) {
    let text;
    try {
      const bytes = readFileSync(path);
      if (bytes.subarray(0, 4096).includes(0)) { inv.skipped += 1; continue; }
      text = bytes.toString('latin1');
    } catch { inv.skipped += 1; continue; }
    inv.files += 1;
    const repo = repoOf(path, attribution);
    const r = inv.repos[repo] ?? (inv.repos[repo] = { files: 0, compilers: new Set() });
    r.files += 1;
    let headed = false;
    for (const m of text.matchAll(HEADER)) {
      headed = true;
      const key = `${m[1]} ${m[2].trim()} ${m[3]}${m[4] ? ' ' + m[4] : ''}`;
      tally(inv.compilers, key, path);
      r.compilers.add(key);
    }
    if (headed) {
      inv.withHeader += 1;
      for (const option of new Set(parseIbmListing(text).options)) {
        const entry = inv.options[option] ?? (inv.options[option] = { count: 0, files: new Set(), repos: new Set() });
        entry.count += 1;
        entry.files.add(path);
        entry.repos.add(repo);
      }
    }
    for (const [name, re] of SECTIONS) if (re.test(text)) tally(inv.sections, name, path);
    for (const line of text.split('\n')) {
      const compileEmitted = COMPILE_EMITTED.test(line);
      for (const m of line.matchAll(COMPILE_MESSAGE)) tally(inv.compileMessages, m[0], path, after(line, m), compileEmitted);
      const runtimeEmitted = RUNTIME_EMITTED.test(line);
      for (const [, re] of RUNTIME) for (const m of line.matchAll(re)) tally(inv.runtimeMessages, m[0], path, after(line, m), runtimeEmitted);
      const abendEmitted = ABEND_EMITTED.test(line);
      for (const re of ABENDS) for (const m of line.matchAll(re)) tally(inv.abends, /^[SU]/.test(m[1]) ? m[1] : 'S' + m[1], path, line.trim().slice(0, 100), abendEmitted);
    }
  }
  return inv;
}

function after(line, m) {
  return line.slice(m.index + m[0].length).trim().slice(0, 100);
}

function knownSet(roots) {
  const files = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (statSync(root).isDirectory()) walk(root, files);
    else files.push(root);
  }
  if (files.length === 0) return null;
  return new Set(files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(KNOWN_TOKEN)].map((m) => m[1])));
}

function markKnown(inv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const ironwork = process.env.IRONWORK ?? resolve(here, '..', '..', 'ironwork');
  inv.known = {
    ironwork: knownSet([join(ironwork, 'README.md'), join(ironwork, 'docs', 'run-endings.tsv'), join(ironwork, 'crates', 'rt', 'src')]),
    cobolwork: knownSet([resolve(here, '..', 'lib', 'sets')]),
  };
}

function rows(map, limit = Infinity, by = (e) => e.files.size) {
  return Object.entries(map).sort((a, b) => by(b[1]) - by(a[1]) || b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, limit);
}

function cell(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/`/g, "'");
}

function knownMark(inv, id) {
  const mark = (set) => (set == null ? '?' : set.has(id) ? 'yes' : 'no');
  return `${mark(inv.known.ironwork)} | ${mark(inv.known.cobolwork)}`;
}

export function markdown(inv, known) {
  const out = [];
  const byEmitted = (e) => e.emitted;
  out.push(`Files read: ${inv.files} (${inv.withHeader} with a compiler header, ${inv.skipped} skipped as binary or unreadable) from ${Object.keys(inv.repos).length} repositories.\n`);
  out.push('## Compilers named in listing headers\n\n| Product | Compiler and level | Files |\n|---|---|---|');
  for (const [key, e] of rows(inv.compilers)) out.push(`| ${key.slice(0, 8)} | ${cell(key.slice(9))} | ${e.files.size} |`);
  out.push('\n## Listing sections\n\n| Section | Files |\n|---|---|');
  for (const [name, e] of rows(inv.sections)) out.push(`| ${name} | ${e.files.size} |`);
  const census = Object.entries(inv.options).map(([token, e]) => ({ token, name: token.replace(/\(.*$/, '').replace(/^NO(?=[A-Z])/, ''), e }));
  const varied = new Set(census.filter((a) => census.some((b) => b.name === a.name && b.token !== a.token)).map((a) => a.name));
  out.push(`\n## Options in effect\n\nOptions whose setting differs between listings, by files and by repositories.\n\n| Option | Files | Repositories |\n|---|---|---|`);
  for (const { token, e } of census.filter((c) => varied.has(c.name)).sort((a, b) => a.name.localeCompare(b.name) || b.e.files.size - a.e.files.size)) out.push(`| ${token} | ${e.files.size} | ${e.repos.size} |`);
  const emitted = Object.fromEntries(Object.entries(inv.compileMessages).filter(([, e]) => e.emitted > 0));
  out.push(`\n## Compile-time messages emitted in listings\n\n${Object.keys(emitted).length} ids emitted; ${Object.keys(inv.compileMessages).length - Object.keys(emitted).length} more only mentioned are in the JSON.\n\n| Id | Emitted | Files | Sample |\n|---|---|---|---|`);
  for (const [id, e] of rows(emitted, 80, byEmitted)) out.push(`| ${id} | ${e.emitted} | ${e.files.size} | ${cell(e.sample)} |`);
  const knownHead = known ? ' Known to ironwork | Known to cobolwork |' : '';
  const knownRule = known ? '---|---|' : '';
  out.push(`\n## Run-time messages\n\n| Id | Emitted | Mentioned | Files |${knownHead} Sample |\n|---|---|---|---|${knownRule}---|`);
  for (const [id, e] of rows(inv.runtimeMessages, Infinity, byEmitted)) out.push(`| ${id} | ${e.emitted} | ${e.count - e.emitted} | ${e.files.size} |${known ? ' ' + knownMark(inv, id) + ' |' : ''} ${cell(e.sample)} |`);
  out.push(`\n## Abend codes\n\n| Code | Emitted | Mentioned | Files |${knownHead} Sample |\n|---|---|---|---|${knownRule}---|`);
  for (const [code, e] of rows(inv.abends, Infinity, byEmitted)) out.push(`| ${code} | ${e.emitted} | ${e.count - e.emitted} | ${e.files.size} |${known ? ' ' + knownMark(inv, code) + ' |' : ''} ${cell(e.sample)} |`);
  out.push('\n## Repositories\n\n| Repository | Files | Compilers |\n|---|---|---|');
  for (const [repo, r] of Object.entries(inv.repos).sort((a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0]))) {
    out.push(`| ${cell(repo)} | ${r.files} | ${cell([...r.compilers].map((c) => c.slice(9)).join('; '))} |`);
  }
  return out.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
