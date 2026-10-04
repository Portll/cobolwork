// How many programs with embedded SQL or CICS GnuCOBOL accepts through lib/precompile.mjs, against the
// grading stand-in that blanks each block, over a corpus, counted apart for programs with SQL only,
// CICS only and both. Programs with EXEC DLI are left out. Up to --per-repo programs of each kind are
// taken from a repository, so the SQL-only set is the one step 1 measured. Both sides get the symbolic
// maps of the mapsets a repository's BMS defines and its files lack, and the translator reads the
// members the program copies, from the directories cobc searches. One line per program: its kind,
// which of the two cobc accepted, and the first error of each.
//   node diag/precompile-probe.mjs <corpus-root> [--out rows.ndjson] [--per-repo n]
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { isProgram, readSource } from '../lib/sources.mjs';
import { detectFormat, parseSource } from '../lib/parser.mjs';
import { precompile } from '../lib/precompile.mjs';
import { copybookIn, repositoryBms } from '../lib/precompile-check.mjs';
import { prepareForWitness, writeStandInCopybooks, writeStandInMaps } from './precompiler.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const root = resolve(args.find((a, i) => !a.startsWith('--') && !['--out', '--per-repo'].includes(args[i - 1])) || '.');
const out = resolve(flag('--out') || 'precompile-probe.ndjson');
const perRepo = Number(flag('--per-repo') || Infinity);
writeFileSync(out, '');

function compiles(text, format, includeDirs, stubs) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-probe-'));
  try {
    const file = join(dir, 'PROGRAM.cbl');
    writeFileSync(file, text);
    for (const [name, body] of Object.entries(stubs)) writeFileSync(join(dir, `${name}.cpy`), body);
    const r = spawnSync('cobc', ['-fsyntax-only', ...(format === 'free' ? ['-free'] : []), '-I', dir, ...includeDirs.flatMap((d) => ['-I', d]), file],
      { encoding: 'utf8', timeout: 60000 });
    const error = (r.stderr || '').split('\n').find((l) => /error:/.test(l));
    const where = error && /^(.*?):\d+:/.exec(error);
    return { ok: r.status === 0, error: error ? error.replace(/^.*?error:\s*/, '').slice(0, 160) : null, in: where ? basename(where[1]) : null };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const kindOf = (src) => {
  if (/EXEC\s+DLI/i.test(src)) return null;
  const sql = /EXEC\s+SQL/i.test(src);
  const cics = /EXEC\s+CICS/i.test(src);
  return sql && cics ? 'mixed' : sql ? 'sql' : cics ? 'cics' : null;
};
const blank = () => ({ programs: 0, standIn: 0, translator: 0, both: 0, onlyTranslator: 0, onlyStandIn: 0 });
const totals = { sql: blank(), cics: blank(), mixed: blank() };
for (const repo of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort()) {
  const tree = directoryTree(join(root, repo));
  const includeDirs = [...(tree.index.copyDirs || [])];
  const taken = { sql: 0, cics: 0, mixed: 0 };
  let maps = null;
  for (const file of [...new Set(tree.list())].filter(isProgram).sort()) {
    let src;
    try { src = readSource(file).text; } catch { continue; }
    const kind = kindOf(src);
    if (!kind || taken[kind] >= perRepo) continue;
    taken[kind]++;
    const format = detectFormat(src);
    const dirs = [dirname(file), ...includeDirs];
    let mapDirs = [];
    let mapsets = [];
    if (kind !== 'sql') {
      if (!maps) {
        const bms = repositoryBms(join(root, repo));
        const dir = mkdtempSync(join(tmpdir(), 'cw-maps-'));
        maps = { dir, mapsets: bms.mapsets, written: writeStandInMaps(dir, bms.bms, bms.has).length > 0 };
      }
      mapDirs = maps.written ? [maps.dir] : [];
      mapsets = maps.mapsets;
    }
    const standInDir = writeStandInCopybooks(mkdtempSync(join(tmpdir(), 'cw-standin-')));
    const standIn = compiles(prepareForWitness(src, format), format, [standInDir, ...dirs, ...mapDirs], {});
    rmSync(standInDir, { recursive: true, force: true });
    let items = [];
    try { items = parseSource(src, file, { format, includeDirs: dirs }).programs.flatMap((pr) => pr.items); } catch { /* unparsed: no arrays known */ }
    const p = precompile(src, { format, items, mapsets, copybook: copybookIn(dirs) });
    const translator = compiles(p.text, format, dirs, p.copybooks);
    const t = totals[kind];
    t.programs++;
    if (standIn.ok) t.standIn++;
    if (translator.ok) t.translator++;
    if (standIn.ok && translator.ok) t.both++;
    if (translator.ok && !standIn.ok) t.onlyTranslator++;
    if (standIn.ok && !translator.ok) t.onlyStandIn++;
    appendFileSync(out, `${JSON.stringify({ repo, file: basename(file), kind, standIn: standIn.ok, translator: translator.ok, error: translator.ok ? null : translator.error, errorIn: translator.in, standInError: standIn.ok ? null : standIn.error, spilled: p.stats.spilled, unknown: p.stats.unknown, members: p.stats.members })}\n`);
  }
  if (maps) rmSync(maps.dir, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(totals)}\n`);
