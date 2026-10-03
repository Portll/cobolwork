// SPDX-License-Identifier: AGPL-3.0-or-later
// The z390 oracle the HLASM locator is graded against. Each corpus file other than a macro definition
// is assembled twice: A as written, B with `DS XL16` after every open-code macro call, with missing
// macros stubbed as `&L DS 0H`. A value is stable when A and B agree on it, so no graded value
// depends on what a macro expands to. <out>/<sha256>.json holds, per file, the open-code statements'
// location counters, the open-code symbols, the ESD and z390's errors; stdout gets a summary per split.
//   Z390=/path/to/z390 node diag/hlasm-oracle.mjs <corpus-root> <out-dir> [--jobs 6] [--split dev,heldout] [--force]
// <corpus-root> holds <split>/<repo>/<path> and members/<repo>/<NAME>.<ext>.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, readdirSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, basename, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { foldStatements } from '../lib/bms.mjs';

const LISTED = /^([0-9A-F]{6,8}) ([0-9A-F ]*?)\((\d+)\/(\d+)\)(\d+)([+= ]|$)(.*)$/;
const ERROR = /^(AZ|MZ)390E error\s+(\d+)\s*(?:\((\d+)\/(\d+)\)(\d+))?\s?(.*)$/;
const ABORT = /^(AZ|MZ)390E abort\s+(\d+)\s*(.*)$/;
const ESD = /^ ESD=([0-9A-F]+) LOC=([0-9A-F]+) LEN=([0-9A-F]+) TYPE=(\S+) NAME=(.*)$/;
const SYM = /^ SYM=(\S+)\s+LOC=([0-9A-F]+) LEN=([0-9A-F]+) ESD=([0-9A-F]+) TYPE=(\S+)\s+XREF=(.*)$/;
const hex = (s) => parseInt(s, 16);
// A macro z390 does not have, defined as one that takes any operands and generates nothing.
export const stubMacro = (name) => `         MACRO\n&L       ${name}\n&L       DS    0H\n         MEND\n`;
export const missingMacros = (text) => [...new Set([...String(text).matchAll(/missing macro\s*=\s*(\S+)/g)].map((m) => m[1].toUpperCase()))];
const operationOf = (source) => (/^\S*\s+(\S+)/.exec(source)?.[1] ?? '').toUpperCase();

// Reads a z390 PRN, or its console output for the errors. finished: the symbol table was printed;
// aborted: a phase gave up, which z390 reports as an abort line or as error 165.
export function parseListing(text) {
  const esd = [];
  const statements = [];
  const symbols = [];
  const errors = [];
  let part = null;
  let last = null;
  let finished = false;
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (line === 'External Symbol Definitions') { part = 'esd'; continue; }
    if (line === 'Assembler Listing') { part = 'listing'; continue; }
    if (line === '.Symbol Table Listing.') { part = 'symbols'; finished = true; continue; }
    if (/^(?:\.Literal Table Listing\.|Relocation Definitions)$/.test(line)) { part = null; continue; }
    const explained = last;
    last = null;
    let m;
    if ((m = ERROR.exec(line))) {
      last = { tool: m[1], number: Number(m[2]), file: m[3] ? Number(m[3]) : null, line: m[4] ? Number(m[4]) : null, stmt: m[5] ? Number(m[5]) : null, text: m[6].trim() };
      errors.push(last);
    } else if ((m = ABORT.exec(line))) {
      errors.push({ tool: m[1], number: Number(m[2]), file: null, line: null, stmt: null, text: `abort: ${m[3].trim()}` });
    } else if (explained && explained.tool === 'AZ' && (m = /^AZ390I (?!ERRSUM)(.*)$/.exec(line))) {
      explained.text = m[1].trim();
    } else if ((m = LISTED.exec(line))) {
      const obj = /^[0-9A-F]*/.exec(line.slice(7, 23).trim())[0];
      statements.push({ stmt: Number(m[5]), loc: hex(m[1]), obj, file: Number(m[3]), line: Number(m[4]), generated: m[6] === '+' || m[6] === '=', source: m[7] });
    } else if (part === 'esd' && (m = ESD.exec(line))) {
      esd.push({ id: hex(m[1]), loc: hex(m[2]), len: hex(m[3]), type: m[4], name: m[5].trim() });
    } else if (part === 'symbols' && (m = SYM.exec(line))) {
      symbols.push({ name: m[1], loc: hex(m[2]), len: hex(m[3]), esd: hex(m[4]), type: m[5], xref: m[6].trim().split(/\s+/).filter(Boolean).map(Number) });
    }
  }
  const aborted = errors.some((e) => e.number === 165 || e.text.startsWith('abort: '));
  return { esd, statements, symbols, errors, end: statements.some((s) => operationOf(s.source) === 'END'), finished, aborted };
}

// Mnemonics from z390's instruction summary: Fmt HLASM is an assembler instruction, any other a machine one.
function opcodes(z390) {
  const rows = readFileSync(join(z390, 'zopcheck', 'HLASM_Instruction_Set_Summary.TXT'), 'latin1').split(/\r?\n/);
  const head = rows[0];
  const [name, fmt, opcd] = [head.indexOf('Operands'), head.indexOf('Fmt'), head.indexOf('Opcd')];
  const assembler = new Set();
  const machine = new Set();
  for (const row of rows.slice(2)) {
    const mnemonic = row.slice(0, name).trim();
    if (mnemonic) (row.slice(fmt, opcd).trim() === 'HLASM' ? assembler : machine).add(mnemonic);
  }
  return { assembler, machine };
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const NAME = /^[A-Z$#@_][A-Z0-9$#@_]{0,62}$/;

// The repository's members under the names z390 searches, a .mac preferred for NAME.MAC and a .cpy or .copy for NAME.CPY.
function stageLibrary(dir, lib) {
  mkdirSync(lib, { recursive: true });
  const byName = new Map();
  for (const f of walk(dir)) {
    const name = basename(f, extname(f)).toUpperCase();
    if (!NAME.test(name)) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(f);
  }
  for (const [name, files] of byName) {
    const ext = (f) => extname(f).toLowerCase();
    copyFileSync(files.find((f) => ext(f) === '.mac') || files[0], join(lib, `${name}.MAC`));
    copyFileSync(files.find((f) => ext(f) === '.cpy' || ext(f) === '.copy') || files[0], join(lib, `${name}.CPY`));
  }
  return lib;
}

function main(args) {
  const Z390 = process.env.Z390;
  if (!Z390 || !existsSync(join(Z390, 'z390.jar'))) { console.error('set Z390 to an unpacked z390 release'); process.exit(2); }
  const valued = new Set(['--jobs', '--split']);
  const flag = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const [root, outDir] = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  if (!root || !outDir) { console.error('usage: node diag/hlasm-oracle.mjs <corpus-root> <out-dir> [--jobs 6] [--split dev,heldout] [--force]'); process.exit(2); }
  const jobs = Number(flag('--jobs', 6));
  const splits = flag('--split', 'dev,heldout').split(',').filter(Boolean);
  const force = args.includes('--force');
  const VERSION = /z390_(\d[\d.]*)$/.exec(basename(Z390))?.[1] ?? basename(Z390);
  const { assembler, machine } = opcodes(Z390);
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'cw-oracle-'));
  const libraries = new Map();
  const libraryOf = (repo) => {
    if (!libraries.has(repo)) libraries.set(repo, stageLibrary(join(root, 'members', repo), join(scratch, `lib-${libraries.size}`)));
    return libraries.get(repo);
  };

  const assemble = (dir, name, source, stub, lib) => new Promise((done) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.MLC`), source);
    const child = spawn('java', ['-classpath', join(Z390, 'z390.jar'), '-Xrs', '-Xmx400m', 'mz390', `${name}.MLC`,
      `sysmac(+${stub}+${join(Z390, 'mac')}+${lib})`, `syscpy(+${join(Z390, 'mac')}+${lib})`, 'xref', 'printall'], { cwd: dir });
    let out = '';
    let timedOut = false;
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60000);
    child.on('close', () => {
      clearTimeout(timer);
      const prnPath = join(dir, `${name}.PRN`);
      const prn = existsSync(prnPath) ? readFileSync(prnPath, 'latin1') : '';
      rmSync(dir, { recursive: true, force: true });
      const listing = parseListing(prn);
      const logged = parseListing(out);
      const seen = new Set(listing.errors.map((e) => `${e.tool}|${e.number}|${e.file}/${e.line}|${e.stmt}`));
      for (const e of logged.errors) if (!seen.has(`${e.tool}|${e.number}|${e.file}/${e.line}|${e.stmt}`)) listing.errors.push(e);
      for (const e of listing.errors) e.text = e.text.replace(/\S*\/cw-oracle-[^\s/]+\/(?:[^\s/]+\/)*/g, '');
      listing.aborted ||= logged.aborted;
      const missing = missingMacros(`${out}\n${prn}`);
      done({ timedOut, listing, missing });
    });
  });

  async function oracle(file, n) {
    const bytes = readFileSync(join(root, file));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const result = { file, sha256, z390: VERSION, graded: false, why: null, stubs: [], errors: [], macroCalls: [], esd: [], symbols: [], statements: [] };
    const text = bytes.toString('latin1');
    const folded = foldStatements(text).statements;
    if (folded.find((s) => s.kind === 'statement')?.operation === 'MACRO') return { ...result, why: 'macro definition' };

    const open = [];
    const definitionLines = new Set();
    let depth = 0;
    for (const st of folded) {
      if (st.kind !== 'statement') continue;
      const inside = depth > 0 || st.operation === 'MACRO';
      if (st.operation === 'MACRO') depth++;
      else if (depth && st.operation === 'MEND') depth--;
      if (inside) st.lines.forEach((l) => definitionLines.add(l));
      else open.push(st);
    }
    const statementAt = new Map();
    for (const st of open) for (const l of st.lines) statementAt.set(l, st);
    const isCall = (op) => !assembler.has(op) && !machine.has(op) && !/^[&.]/.test(op);
    const calls = open.filter((st) => isCall(st.operation));
    result.macroCalls = calls.map((st) => st.line);

    const callEnds = new Set(calls.map((st) => st.endLine));
    const bSource = [];
    const original = [null];
    text.replace(/\r\n?/g, '\n').split('\n').forEach((l, i) => {
      bSource.push(l);
      original.push(i + 1);
      if (callEnds.has(i + 1)) { bSource.push('         DS    XL16'); original.push(null); }
    });

    const job = join(scratch, `job-${n}`);
    const stubDir = join(job, 'stub');
    mkdirSync(stubDir, { recursive: true });
    const name = basename(file, extname(file)).toUpperCase().replace(/[^A-Z0-9$#@]/g, '').slice(0, 8) || 'SOURCE';
    const lib = libraryOf(file.split('/')[1]);
    try {
      let a;
      for (let round = 0; ; round++) {
        a = await assemble(join(job, `a${round}`), name, bytes, stubDir, lib);
        const fresh = a.missing.filter((m) => NAME.test(m) && !result.stubs.includes(m));
        if (a.timedOut || !fresh.length || round === 3) break;
        for (const m of fresh) writeFileSync(join(stubDir, `${m}.MAC`), stubMacro(m));
        result.stubs.push(...fresh);
      }
      if (a.timedOut) return { ...result, why: 'timeout in run A' };
      // A source with no END is assembled to its last line, as HLASM does; an abort leaves the listing short.
      const hasEnd = open.some((st) => st.operation === 'END');
      const failure = (r, run) => (r.timedOut ? `timeout in run ${run}` : r.listing.aborted ? `z390 aborted in run ${run}`
        : r.listing.finished && (r.listing.end || !hasEnd) ? null : `no listing through END in run ${run}`);
      const failed = failure(a, 'A');
      const b = failed ? null : await assemble(join(job, 'b'), name, Buffer.from(`${bSource.join('\n')}\n`, 'latin1'), stubDir, lib);
      const compared = compare(a.listing, b && !b.timedOut ? b.listing : null);
      const why = failed ?? failure(b, 'B') ?? compared.why;
      return { ...result, ...compared, graded: !why, why };
    } finally {
      rmSync(job, { recursive: true, force: true });
    }

    function compare(A, B) {
      // The operation must match too: z390 and foldStatements can fold a malformed continuation differently.
      const openOf = (e, map) => {
        if (e.file !== 1 || e.generated) return null;
        const st = statementAt.get(map ? original[e.line] : e.line);
        return st && operationOf(e.source) === st.operation ? st : null;
      };
      const firstListing = (L, map) => {
        const at = new Map();
        for (const e of L.statements) {
          const st = openOf(e, map);
          if (st && !at.has(st)) at.set(st, e);
        }
        return at;
      };
      const aAt = firstListing(A);
      const bAt = B ? firstListing(B, true) : new Map();
      const statements = [];
      for (const st of open) {
        const e = aAt.get(st);
        if (!e) continue;
        const instruction = machine.has(st.operation);
        statements.push({ line: st.line, loc: e.loc, stable: bAt.get(st)?.loc === e.loc, instruction, objLen: instruction && e.obj ? e.obj.length / 2 : null });
      }

      const sectionOf = new Map();
      for (const x of A.esd) if (!['ENT', 'EXT', 'WXT'].includes(x.type) && !sectionOf.has(x.id)) sectionOf.set(x.id, x.name);
      for (const s of [...A.symbols].sort((p, q) => (p.xref[0] ?? 0) - (q.xref[0] ?? 0))) if (s.type === 'DST' && !sectionOf.has(s.esd)) sectionOf.set(s.esd, s.name);
      const aByStmt = new Map(A.statements.map((e) => [e.stmt, e]));
      const bSymbol = new Map((B?.symbols ?? []).map((s) => [s.name, s]));
      const symbols = [];
      for (const s of A.symbols) {
        const def = s.type === 'UND' ? null : aByStmt.get(s.xref[0]);
        const st = def && openOf(def);
        if (!st) continue;
        const o = bSymbol.get(s.name);
        symbols.push({ name: s.name, line: st.line, loc: s.loc, len: s.len, type: s.type, section: s.esd ? sectionOf.get(s.esd) ?? null : null, stable: !!o && o.loc === s.loc && o.len === s.len && o.type === s.type });
      }
      const bEsd = new Map((B?.esd ?? []).map((x) => [`${x.type}|${x.name}`, x]));
      const esd = A.esd.map((x) => ({ name: x.name, type: x.type, len: x.len, stable: bEsd.get(`${x.type}|${x.name}`)?.len === x.len }));

      // The open-code statement that produced a generated listing line is the last one listed before it.
      const caller = (L, map) => {
        const at = new Map();
        let current = null;
        for (const e of L.statements) {
          const st = openOf(e, map);
          if (st) current = st;
          else if (e.generated && !at.has(e.stmt)) at.set(e.stmt, current);
        }
        return at;
      };
      const callers = [caller(A), B ? caller(B, true) : new Map()];
      const errors = [];
      const seen = new Set();
      let why = null;
      [A, B].forEach((L, run) => {
        if (!L) return;
        const listed = new Map(L.statements.map((e) => [e.stmt, e]));
        for (const e of L.errors) {
          const line = e.file === 1 && e.line != null ? (run ? original[e.line] ?? null : e.line) : null;
          // An assembly-phase error carries the listing's statement number; a macro-phase error only its position.
          const entry = e.tool === 'AZ' ? listed.get(e.stmt) : null;
          const generated = (e.file != null && e.file !== 1) || !!entry?.generated || definitionLines.has(line);
          const st = generated ? (entry ? callers[run].get(e.stmt) : null) : entry ? openOf(entry, run === 1) : statementAt.get(line);
          const record = { line: st ? st.line : line, generated, number: e.number, text: e.text };
          const key = JSON.stringify(record);
          if (seen.has(key)) continue;
          seen.add(key);
          errors.push(record);
          if (why || e.number === 144 || generated || (st && machine.has(st.operation))) continue;
          const on = e.file == null ? 'with no position' : !st ? 'on no statement' : isCall(st.operation) ? 'on macro call' : `on ${st.operation}`;
          why = `error ${e.number} ${on}${run ? ' in run B' : ''}`;
        }
      });
      return { why, errors, esd, symbols, statements };
    }
  }

  return (async () => {
    const work = [];
    for (const split of splits) for (const f of walk(join(root, split))) work.push(relative(root, f));
    const results = new Map();
    let next = 0;
    const worker = async () => {
      while (next < work.length) {
        const i = next++;
        const file = work[i];
        const sha = createHash('sha256').update(readFileSync(join(root, file))).digest('hex');
        const cached = join(outDir, `${sha}.json`);
        if (!force && existsSync(cached)) {
          const r = JSON.parse(readFileSync(cached, 'utf8'));
          if (r.z390 === VERSION) { results.set(file, r); continue; }
        }
        const r = await oracle(file, i);
        writeFileSync(cached, `${JSON.stringify(r)}\n`);
        results.set(file, r);
      }
    };
    try {
      await Promise.all(Array.from({ length: jobs }, worker));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

    const tally = (into, key) => { into[key] = (into[key] || 0) + 1; };
    const summary = {};
    for (const split of splits) {
      const rs = work.filter((f) => f.startsWith(`${split}/`)).map((f) => results.get(f));
      const graded = rs.filter((r) => r.graded);
      const s = { files: rs.length, graded: graded.length, why: {}, symbols: { total: 0, stable: 0 }, statements: { total: 0, stable: 0 }, instructions: 0, esd: { total: 0, stable: 0 }, stubs: {} };
      for (const r of rs) {
        if (!r.graded) tally(s.why, r.why);
        for (const m of r.stubs) tally(s.stubs, m);
      }
      for (const r of graded) {
        s.symbols.total += r.symbols.length;
        s.symbols.stable += r.symbols.filter((x) => x.stable).length;
        s.statements.total += r.statements.length;
        s.statements.stable += r.statements.filter((x) => x.stable).length;
        s.instructions += r.statements.filter((x) => x.instruction).length;
        s.esd.total += r.esd.length;
        s.esd.stable += r.esd.filter((x) => x.stable).length;
      }
      s.why = Object.fromEntries(Object.entries(s.why).sort((p, q) => q[1] - p[1]));
      s.stubs = Object.fromEntries(Object.entries(s.stubs).sort((p, q) => q[1] - p[1]));
      summary[split] = s;
    }
    console.log(JSON.stringify(summary, null, 1));
  })();
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) await main(process.argv.slice(2));
