// SPDX-License-Identifier: AGPL-3.0-or-later
// The compile check `cobolwork build --precompile` runs before the caller's compiler: each program the
// compiler command names that holds EXEC SQL or EXEC CICS is translated by lib/precompile.mjs into a
// directory of its own, beside the stand-in copybooks and translated members it needs, and given to
// the same compiler with -fsyntax-only, so a program GnuCOBOL refuses only for its EXEC blocks is
// checked. Nothing it writes outlives the check.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, join, relative, resolve } from 'node:path';
import { parseBms } from './bms.mjs';
import { printable } from './kernel/printable.mjs';
import { detectFormat, parseSource } from './parser.mjs';
import { precompile } from './precompile.mjs';
import { isBms, isProgram, readSource } from './sources.mjs';

const COPY_EXTENSIONS = ['', '.cpy', '.CPY', '.cbl', '.CBL', '.cob', '.COB'];
const MAX_ERRORS = 3;

// A COPY member's text from the first directory holding it, as cobc searches them.
export const copybookIn = (dirs) => (name) => {
  for (const d of dirs) {
    for (const ext of COPY_EXTENSIONS) {
      const p = join(d, name + ext);
      try { if (statSync(p).isFile()) return readSource(p).text; } catch { /* not here */ }
    }
  }
  return null;
};

// The BMS files under a repository, the member names its other files supply, and the mapsets it holds
// no copybook for, whose symbolic maps the translator writes.
export function repositoryBms(repoRoot) {
  const files = [];
  const walk = (d) => {
    let es;
    try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name === '.git' || e.name.startsWith('._')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p); else files.push(p);
    }
  };
  walk(repoRoot);
  const bms = files.filter(isBms);
  const members = new Set(files.filter((f) => !bms.includes(f)).map((f) => basename(f, extname(f)).toUpperCase()));
  const mapsets = bms.flatMap((f) => { try { return parseBms(readFileSync(f, 'latin1')).mapsets; } catch { return []; } })
    .filter((ms) => ms.name && !members.has(ms.name.toUpperCase()));
  return { bms, has: (n) => members.has(n.toUpperCase()), mapsets };
}

const EXEC = /EXEC\s+(?:SQL|CICS)\b/i;
const DLI = /EXEC\s+DLI\b/i;
const redact = (s) => String(s).replace(/'[^']*'|"[^"]*"/g, "'…'");

// The copy directories a cobc or gcobol argument vector names, in order: -I <dir> and -I<dir>.
function includeDirsOf(argv, cwd) {
  const dirs = [];
  argv.forEach((a, i) => {
    if (a === '-I' && argv[i + 1]) dirs.push(resolve(cwd, argv[i + 1]));
    else if (a.startsWith('-I') && a.length > 2) dirs.push(resolve(cwd, a.slice(2)));
  });
  return dirs;
}

// The argument vector with -o and its value taken out: a syntax check writes nothing.
const withoutOutput = (argv) => argv.filter((a, i) => a !== '-o' && argv[i - 1] !== '-o' && !(a.startsWith('-o') && a.length > 2));

// A compiler's first error lines, each named by the source line it came from and with every quoted
// literal masked, since a diagnostic may quote the program and no output of the gate carries source.
function errorsOf(stderr, translated, map, rel) {
  const out = [];
  for (const line of String(stderr || '').split('\n')) {
    const m = /^(.*?):(\d+):\s*error:\s*(.*)$/.exec(line);
    if (!m) continue;
    const at = resolve(m[1]) === translated ? `${rel}:${map[Number(m[2]) - 1] ?? m[2]}` : `${basename(m[1])}:${m[2]}`;
    out.push(printable(`${at}: ${redact(m[3])}`, 300));
    if (out.length === MAX_ERRORS) break;
  }
  return out;
}

// Runs the check. `compilerPath` is the resolved compiler and `argv` the caller's arguments after it;
// `cwd` is where the caller's compiler runs, so its relative paths resolve there. Returns, for each
// program the argument vector names that holds EXEC SQL or CICS, whether the compiler accepted its
// translation and its first errors; programs holding EXEC DLI, which nothing translates, are skipped.
export function precompileCheck({ compilerPath, argv, cwd = process.cwd(), repo, copylibs = [], env = process.env }) {
  const sources = argv.map((a, i) => ({ a, i, path: resolve(cwd, a) }))
    .filter(({ a, i, path }) => !a.startsWith('-') && argv[i - 1] !== '-o' && argv[i - 1] !== '-I' && isProgram(path) && isFile(path));
  const includeDirs = [...includeDirsOf(argv, cwd), ...String(env.COBCPY || '').split(delimiter).filter(Boolean), ...copylibs];
  const others = withoutOutput(argv.filter((_, i) => !sources.some((s) => s.i === i)));
  const programs = [];
  const skipped = [];
  let mapsets = null;
  const root = mkdtempSync(join(tmpdir(), 'cw-precompile-'));
  try {
    for (const { path } of sources) {
      const rel = printable(relative(repo, path).startsWith('..') ? relative(cwd, path) : relative(repo, path), 200);
      const text = readSource(path).text;
      if (DLI.test(text)) { skipped.push({ path: rel, why: 'EXEC DLI is not translated' }); continue; }
      if (!EXEC.test(text)) continue;
      const format = detectFormat(text);
      const dirs = [dirname(path), ...includeDirs];
      let items = [];
      try { items = parseSource(text, path, { format, includeDirs: dirs }).programs.flatMap((p) => p.items); } catch { /* unparsed: no host-variable arrays known */ }
      if (/EXEC\s+CICS\b/i.test(text) && !mapsets) mapsets = repositoryBms(repo).mapsets;
      const p = precompile(text, { format, items, mapsets: /EXEC\s+CICS\b/i.test(text) ? mapsets : [], copybook: copybookIn(dirs) });
      const dir = mkdtempSync(join(root, 'p-'));
      const translated = join(dir, basename(path));
      writeFileSync(translated, p.text);
      for (const [name, body] of Object.entries(p.copybooks)) writeFileSync(join(dir, `${name}.cpy`), body);
      const r = spawnSync(compilerPath, ['-fsyntax-only', '-I', dir, ...others, translated], { cwd, env, encoding: 'utf8', windowsHide: true });
      const ok = !r.error && r.status === 0;
      programs.push({ path: rel, ok, ...(ok ? {} : { errors: r.error ? [printable(r.error.message, 200)] : errorsOf(r.stderr, translated, p.map, rel) }) });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return { argv: ['-fsyntax-only', '-I', '<translation>', ...others, '<program>'], programs, skipped };
}

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}
