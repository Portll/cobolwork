// Grades the parser against GnuCOBOL's listing over a corpus.
//
//   node diag/grade-against-gnucobol.mjs <root> <parse.ndjson> [rescue.ndjson] [options]
//     --out <file>     write the full result
//     --auto           let the parser detect the source format instead of being told
//     --cics-prep      emulate the CICS and SQL precompilers so CICS programs can be witnessed
//     --rescue-only    grade only the rescue list
//     --stand-in-only  witness embedded SQL through the stand-in, not the translator
//   COBOLWORK_SAMPLES=<n> keeps n examples of each kind of disagreement (default 40).
//
// <parse.ndjson> is produced by diag/compiler-probe.mjs: one row per program file recording
// whether the compiler accepted it and in which format.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { parseSource, buildFileIndex } from '../lib/parser.mjs';
import { precompile } from '../lib/precompile.mjs';
import { parseListing, looksDegenerate } from './listing.mjs';
import { factsFromParse, factsFromListing, alignProgramKeys, compareFacts } from './compare.mjs';
import { prepareForWitness, maskExec, STUB_NAME, writeStandInCopybooks, writeRepositoryMaps } from './precompiler.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
// An option's value is not a positional: reading it as one turned --out into a second input file.
const positionals = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--out'));
const [ROOT, PARSE, RESCUE] = positionals;
const SYSTEM_COPY_DIR = process.env.COBOLWORK_SYSTEM_COPY_DIR || '/opt/homebrew/Cellar/gnucobol/3.2_1/share/gnucobol/copy';
const tmp = mkdtempSync(join(tmpdir(), 'cobolwork-grade-'));
const standInDir = writeStandInCopybooks(join(tmp, 'stand-in'));
const mapsByRepo = {};
const mapsOf = (repo) => (mapsByRepo[repo] ??= writeRepositoryMaps(join(ROOT, repo), join(tmp, 'maps', repo)));
const readNd = (p) => (p ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

const parseRows = new Map(readNd(PARSE).map(r => [r.file, r]));
const population = [];
if (!flags.has('--rescue-only')) for (const r of parseRows.values()) if (r.outcome === 'ok') population.push({ repo: r.repo, file: r.file, format: r.format, std: 'default', mask: false });
for (const r of readNd(RESCUE)) {
  if (!r.rescued) continue;
  const orig = (parseRows.get(r.file) || {}).format || 'fixed';
  const flip = orig === 'free' ? 'fixed' : 'free';
  const s = r.rescued;
  // A program rescued through the translator or the stand-in is compiled from one of them and parsed
  // as written, so what the parser makes of EXEC blocks and INCLUDEs is graded rather than rewritten
  // away.
  population.push({
    repo: r.repo, file: r.file, mask: s.startsWith('mask'), standIn: s.startsWith('stand-in') || s.startsWith('translator'), strategy: s,
    format: r.format || (s.includes('terminal') ? 'terminal' : s.includes('variable') ? 'variable' : s.includes('flip') ? flip : orig),
    std: s.includes('ibm') ? 'ibm' : s.includes('mf') ? 'mf' : 'default',
  });
}

function cobc(file, args, cwd) {
  return new Promise(res => {
    const ch = spawn('cobc', [...args, file], { cwd });
    let err = '';
    ch.stderr.on('data', d => { if (err.length < 20000) err += d; });
    const t = setTimeout(() => { ch.kill('SIGKILL'); res({ code: -1, err }); }, 60000);
    ch.on('close', code => { clearTimeout(t); res({ code, err }); });
  });
}

const agg = {
  files: 0, witnessRefused: 0, witnessDegenerate: 0, parserThrew: 0, formatDisagree: 0, translatorRefused: 0,
  symbols: { witness: 0, mine: 0, matched: 0 }, sizes: { compared: 0, agree: 0 }, filesExact: 0,
  labels: { witness: 0, mine: 0, matched: 0 }, calls: { witness: 0, mine: 0, matched: 0 },
  xref: { witness: 0, matched: 0, stateAgree: 0, witnessReceiving: 0, witnessReceivingCaught: 0, mineOnlyReceiving: 0, mineOnlyUnexplained: 0 },
  byClass: {}, samples: {}, perRepo: {}, byWitness: {},
};
const SAMPLES = Number(process.env.COBOLWORK_SAMPLES || 40);
const sample = (k, v) => { (agg.samples[k] ||= []).length < SAMPLES && agg.samples[k].push(v); };
const tally = (k) => { agg.byClass[k] = (agg.byClass[k] || 0) + 1; };

const indexCache = new Map();
let next = 0;
let seq = 0;

async function worker() {
  while (next < population.length) {
    const j = population[next++];
    const abs = join(ROOT, j.file);
    if (!indexCache.has(j.repo)) indexCache.set(j.repo, buildFileIndex(join(ROOT, j.repo)));
    const idx = indexCache.get(j.repo);
    const includeDirs = idx.copyDirs.slice(0, 80);
    const original = readFileSync(abs, 'latin1');
    const standIn = flags.has('--cics-prep') || j.standIn;
    const maps = standIn ? mapsOf(j.repo) : { dir: null, names: [] };
    const witnessDirs = standIn ? [...includeDirs, standInDir, ...(maps.dir ? [maps.dir] : [])] : includeDirs;
    const parseOpts = {
      format: flags.has('--auto') ? 'auto' : j.format, std: j.std, includeDirs, systemDirs: [SYSTEM_COPY_DIR],
      fileIndex: idx.index, mainDir: dirname(abs), copyFormat: flags.has('--auto') ? 'auto' : j.format,
    };
    const compile = async (text, dirs) => {
      const target = text === original ? abs : join(tmp, `m${seq++}${extname(abs)}`);
      if (target !== abs) writeFileSync(target, text, 'latin1');
      const lst = join(tmp, `l${seq++}.lst`);
      const r = await cobc(target, ['-fsyntax-only', '-frelax-syntax-checks', `-std=${j.std}`, `-fformat=${j.format}`, '-t', lst, '-Xref', '-ftsymbols', ...dirs.flatMap(d => ['-I', d])], dirname(abs));
      return { ...r, lst };
    };

    // A program with embedded SQL or CICS is compiled through the translator, which hands the data
    // each block names to the compiler as CALL arguments, and through the stand-in only where the
    // compiler refuses the translation. What the translator declares, and the CALLs it writes, are its own and not graded.
    let kind = standIn ? 'stand-in' : 'plain';
    let src = null;
    let r = null;
    let parsed = null;
    const txNames = new Set();
    if (j.standIn && !flags.has('--cics-prep') && !flags.has('--stand-in-only') && /EXEC\s+(SQL|CICS)\b/i.test(original)) {
      try { parsed = parseSource(original, abs, parseOpts); } catch (e) { agg.parserThrew++; sample('parserThrew', { file: j.file, err: String(e && e.message) }); continue; }
      const tx = precompile(original, { format: j.format, items: parsed.programs.flatMap((p) => p.items) });
      const dir = join(tmp, `c${seq++}`);
      mkdirSync(dir);
      for (const [name, body] of Object.entries(tx.copybooks)) {
        writeFileSync(join(dir, `${name}.cpy`), body);
        for (const m of body.matchAll(/^\s*\d+\s+([A-Za-z0-9-]+)/gm)) txNames.add(m[1].toUpperCase());
      }
      const txSrc = prepareForWitness(tx.text, j.format);
      const rt = await compile(txSrc, [...includeDirs, dir, standInDir, ...(maps.dir ? [maps.dir] : [])]);
      if (rt.code === 0) { kind = 'translator'; src = txSrc; r = rt; }
      else {
        agg.translatorRefused++;
        sample('translatorRefused', { file: j.file, err: (rt.err.match(/error: ([^\n]*)/) || [])[1] });
        parsed = null;
        txNames.clear();
      }
    }
    if (!r) {
      src = standIn ? prepareForWitness(original, j.format) : j.mask ? maskExec(original) : original;
      r = await compile(src, witnessDirs);
    }
    if (r.code !== 0) { agg.witnessRefused++; sample('witnessRefused', { file: j.file, err: (r.err.match(/error: ([^\n]*)/) || [])[1] }); continue; }
    let listing;
    try { listing = parseListing(readFileSync(r.lst, 'latin1')); } catch (e) { if (e.code !== 'ENOENT') throw e; agg.witnessRefused++; continue; }
    rmSync(r.lst, { force: true });
    if (looksDegenerate(listing, src)) { agg.witnessDegenerate++; sample('witnessDegenerate', { file: j.file, strategy: j.strategy || 'ok' }); continue; }

    if (!parsed) {
      try {
        parsed = parseSource(j.standIn && !flags.has('--cics-prep') ? original : src, abs, {
          ...parseOpts,
          // The stand-in blanks every EXEC block, so the compiler it witnesses sees no host variable.
          hostVariables: kind !== 'stand-in',
        });
      } catch (e) { agg.parserThrew++; sample('parserThrew', { file: j.file, err: String(e && e.message) }); continue; }
    }
    if (parsed.format !== j.format) agg.formatDisagree++;
    agg.files++;

    const witness = alignProgramKeys(factsFromListing(listing), listing.programs);
    let mine = alignProgramKeys(factsFromParse(parsed), listing.programs);
    if (standIn) {
      const mapNames = new Set(maps.names);
      const ours = (x) => !STUB_NAME.test(x.name) && !mapNames.has(x.name) && !txNames.has(x.name);
      witness.symbols = witness.symbols.filter(ours); witness.xref = witness.xref.filter(ours);
      mine.symbols = mine.symbols.filter(ours); mine.xref = mine.xref.filter(ours);
      witness.calls = witness.calls.filter((x) => !/^CW-(SQL|CICS)-/.test(x.name));
    }
    const c = compareFacts(witness, mine);
    const w = (agg.byWitness[kind] ||= {
      files: 0, symbols: { witness: 0, mine: 0, matched: 0 }, sizes: { compared: 0, agree: 0 }, labels: { witness: 0, mine: 0, matched: 0 },
      calls: { witness: 0, mine: 0, matched: 0 }, xref: { witness: 0, matched: 0, stateAgree: 0, witnessReceiving: 0, witnessReceivingCaught: 0, mineOnlyReceiving: 0, mineOnlyUnexplained: 0 },
    });
    w.files++;
    for (const k of ['symbols', 'labels', 'calls']) for (const f of ['witness', 'mine', 'matched']) w[k][f] += c[k][f];
    w.sizes.compared += c.sizes.compared; w.sizes.agree += c.sizes.agree;
    for (const f of Object.keys(w.xref)) w.xref[f] += c.xref[f];

    const rp = (agg.perRepo[j.repo] ||= { files: 0, symWitness: 0, symMatched: 0, sizeAgree: 0, sizeCompared: 0, labelWitness: 0, labelMine: 0, labelMatched: 0 });
    rp.files++;
    rp.labelWitness += c.labels.witness; rp.labelMine += c.labels.mine; rp.labelMatched += c.labels.matched;
    for (const k of ['symbols', 'labels', 'calls']) for (const f of ['witness', 'mine', 'matched']) agg[k][f] += c[k][f];
    agg.sizes.compared += c.sizes.compared; agg.sizes.agree += c.sizes.agree;
    rp.symWitness += c.symbols.witness; rp.symMatched += c.symbols.matched; rp.sizeAgree += c.sizes.agree; rp.sizeCompared += c.sizes.compared;
    for (const f of Object.keys(agg.xref)) agg.xref[f] += c.xref[f];
    if (c.symbols.matched === c.symbols.witness && c.symbols.matched === c.symbols.mine && c.sizes.agree === c.sizes.compared) agg.filesExact++;

    for (const x of c.samples.symMissing) { tally(`symMissing|${x.lvl}|${x.name === 'FILLER' ? 'FILLER' : 'named'}`); sample('symMissing', { file: j.file, witnessed: kind, ...x }); }
    for (const x of c.samples.symExtra) { tally(`symExtra|${x.lvl}|${x.name === 'FILLER' ? 'FILLER' : 'named'}|${x.section || ''}`); sample('symExtra', { file: j.file, witnessed: kind, ...x }); }
    for (const x of c.samples.sizeWrong) { tally(`size|${x.section || 'data'}`); sample('sizeWrong', { file: j.file, witnessed: kind, ...x }); }
    for (const x of c.samples.stateWrong) { tally(`state|${x.witness}->${x.mine}`); sample('stateWrong', { file: j.file, witnessed: kind, ...x }); }
    for (const x of c.samples.receivingMissed) { tally(`receivingMissed|${x.verbs}`); sample('receivingMissed', { file: j.file, witnessed: kind, ...x }); }
    for (const x of c.samples.receivingExtra) { tally(`receivingExtra|${x.via}`); sample('receivingExtra', { file: j.file, witnessed: kind, ...x }); }
    for (const x of c.samples.labelMissing) sample('labelMissing', { file: j.file, witnessed: kind, ...x });
    for (const x of c.samples.labelExtra) sample('labelExtra', { file: j.file, witnessed: kind, ...x });
    for (const x of c.samples.callMissing) { tally(`callMissing|${x.kind}`); sample('callMissing', { file: j.file, witnessed: kind, ...x }); }
    for (const x of c.samples.callExtra) { tally(`callExtra|${x.kind}`); sample('callExtra', { file: j.file, witnessed: kind, ...x }); }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: Number(process.env.COBOLWORK_JOBS || 8) }, worker));
agg.population = population.length;
agg.secs = Math.round((Date.now() - started) / 1000);
rmSync(tmp, { recursive: true, force: true });
if (OUT) writeFileSync(OUT, JSON.stringify(agg, null, 1));

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a');
console.log(`files=${agg.files} witnessRefused=${agg.witnessRefused} degenerate=${agg.witnessDegenerate} parserThrew=${agg.parserThrew} formatDisagree=${agg.formatDisagree} secs=${agg.secs}`);
console.log(`items   recall=${pct(agg.symbols.matched, agg.symbols.witness)} precision=${pct(agg.symbols.matched, agg.symbols.mine)} sizes=${pct(agg.sizes.agree, agg.sizes.compared)} (${agg.sizes.compared - agg.sizes.agree} of ${agg.sizes.compared}) filesExact=${pct(agg.filesExact, agg.files)}`);
console.log(`labels  recall=${pct(agg.labels.matched, agg.labels.witness)} precision=${pct(agg.labels.matched, agg.labels.mine)}`);
console.log(`calls   recall=${pct(agg.calls.matched, agg.calls.witness)} precision=${pct(agg.calls.matched, agg.calls.mine)}`);
console.log(`refs    matched=${pct(agg.xref.matched, agg.xref.witness)} state=${pct(agg.xref.stateAgree, agg.xref.matched)} receivingCaught=${pct(agg.xref.witnessReceivingCaught, agg.xref.witnessReceiving)} extraUnexplained=${agg.xref.mineOnlyUnexplained}`);
if (agg.byWitness.translator || agg.translatorRefused) console.log(`translator refused ${agg.translatorRefused}, witnessed by the stand-in instead`);
for (const [kind, w] of Object.entries(agg.byWitness)) {
  console.log(`  ${kind.padEnd(10)} files=${w.files} items=${pct(w.symbols.matched, w.symbols.witness)}/${pct(w.symbols.matched, w.symbols.mine)} labels=${pct(w.labels.matched, w.labels.witness)}/${pct(w.labels.matched, w.labels.mine)} calls=${pct(w.calls.matched, w.calls.witness)}/${pct(w.calls.matched, w.calls.mine)} refs=${pct(w.xref.matched, w.xref.witness)} state=${pct(w.xref.stateAgree, w.xref.matched)} (${w.xref.matched - w.xref.stateAgree} of ${w.xref.matched}) extraUnexplained=${w.xref.mineOnlyUnexplained}`);
}
