// Seeded recall: plants a known flaw into a copy of a real program and asks whether the rule that
// should see it does. bench/cases measures the rules on programs written to exercise them; this
// measures them inside programs nobody wrote for the purpose - real copybooks, real layouts, real
// dialect - which is where a parser gap or a resolution miss would lose a finding.
//
//   node bench/seed.mjs <corpus-root> [--per-operator 25] [--skip a,b] [--exclude-paths a,b]
//                        [--out file] [--keep dir]
//
// It measures recall against the planter's idea of the bug, not against bugs as they occur, so it
// is reported as seeded recall and never as recall. It says nothing about precision.
//
// The seeded programs are built in a temporary directory and deleted. Corpus programs carry their
// own licences, so none of them is ever written into this repository; --keep names a directory to
// leave them in for reading.
import { readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join, basename, extname, dirname } from 'node:path';
import { REGISTRY } from '../lib/kernel/registry.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { detectFormat } from '../lib/parser.mjs';
import { inScope, isProgram, readSource } from '../lib/sources.mjs';

const SET = Object.fromEntries(REGISTRY.map((s) => [s.name, s.scan]));

// Fixed format only. Area A starts in column 8 and code ends at 72; a planted line that lands in
// the sequence area or past column 72 is a different program from the one intended.
const AREA_A = '       ';
const AREA_B = '           ';
const code = (line) => (line.length > 7 && line[6] !== '*' && line[6] !== '/' ? line.slice(7, 72) : '');

function sites(lines) {
  let ws = -1;
  for (let i = 0; i < lines.length; i++) {
    const c = code(lines[i]);
    if (/\bDECLARATIVES\b/i.test(c)) return null;
    if (ws < 0 && /\bWORKING-STORAGE\s+SECTION\s*\./i.test(c)) ws = i;
    if (/\bPROCEDURE\s+DIVISION\b/i.test(c)) {
      // The header ends at its period, which may be lines later when USING lists many items.
      let j = i;
      while (j < lines.length && !/\.\s*$/.test(code(lines[j]).trimEnd())) j++;
      return ws >= 0 && j < lines.length ? { ws, proc: j } : null;
    }
  }
  return null;
}

// Each operator plants one flaw and names the rule and set that should report it. `plant` returns
// the new text, or a reason this host cannot take this flaw.
export const OPERATORS = {
  // Command-line input handed to an operating-system command.
  'argv-to-os-command': {
    set: 'flow', rule: 'argv-or-env-to-os-command',
    plant(src) {
      const lines = src.split(/\r?\n/);
      const at = sites(lines);
      if (!at) return { skip: 'no working-storage and procedure division to plant in' };
      lines.splice(at.proc + 1, 0, `${AREA_B}ACCEPT WS-SEED-IN FROM COMMAND-LINE`, `${AREA_B}CALL 'SYSTEM' USING WS-SEED-IN.`);
      lines.splice(at.ws + 1, 0, `${AREA_A}01 WS-SEED-IN PIC X(80).`);
      return { text: lines.join('\n') };
    },
  },
  // The program's own first literal CALL, wherever it sits, made to take its target from the
  // command line. The flaw is at a real call site rather than beside the header.
  'argv-to-dynamic-call': {
    set: 'flow', rule: 'argv-or-env-to-dynamic-program-load',
    plant(src) {
      const lines = src.split(/\r?\n/);
      const at = sites(lines);
      if (!at) return { skip: 'no working-storage and procedure division to plant in' };
      const CALL = /\bCALL\s+(['"])[A-Z0-9$#@-]+\1/i;
      const k = lines.findIndex((l, i) => i > at.proc && CALL.test(code(l)));
      if (k < 0) return { skip: 'no literal CALL' };
      const rewritten = code(lines[k]).replace(CALL, 'CALL WS-SEED-PGM').trimEnd();
      if (rewritten.length > 65) return { skip: 'the rewritten CALL would pass column 72' };
      lines[k] = lines[k].slice(0, 7) + rewritten;
      lines.splice(at.proc + 1, 0, `${AREA_B}ACCEPT WS-SEED-PGM FROM COMMAND-LINE.`);
      lines.splice(at.ws + 1, 0, `${AREA_A}01 WS-SEED-PGM PIC X(8).`);
      return { text: lines.join('\n') };
    },
  },
  // A CICS program that reads its communication area and checks EIBCALEN, made to stop checking.
  // EIBRESP is the same size in the same block, padded to the same width, so the program stays
  // valid and only the check is gone. A program that declares the area and never reads it is not a
  // host: the rule is right to stay quiet about it.
  'drop-length-check': {
    set: 'cics', rule: 'cics-commarea-without-length-check',
    plant(src, host) {
      if (!/\bEIBCALEN\b/i.test(src)) return { skip: 'does not check EIBCALEN' };
      const reads = host.parse().programs.some((p) => {
        const area = p.items.find((i) => i.name === 'DFHCOMMAREA' && i.section === 'LINKAGE');
        return area && subtreeRead(area);
      });
      if (!reads) return { skip: 'does not read a communication area' };
      return { text: src.replace(/\bEIBCALEN\b/gi, 'EIBRESP ') };
    },
  },
};

const subtreeRead = (x) => x.directRefs > 0 || x.children.some(subtreeRead);

// The host travels with the copybooks it pulls in, followed through nested COPY, at their paths in
// the repository so COPY resolves as it did there. Other programs do not: every planted flaw is
// inside the one program.
const COPY = /\bCOPY\s+['"]?([A-Z0-9$#@_-]+)/gi;
function stage(tree, byName, file, dir) {
  mkdirSync(dir, { recursive: true });
  const want = [file];
  const seen = new Set(want);
  for (let i = 0; i < want.length; i++) {
    let text;
    try { text = readSource(want[i]).text; } catch { continue; }
    for (const m of text.matchAll(COPY)) {
      for (const p of byName.get(m[1].toUpperCase()) || []) if (!seen.has(p)) { seen.add(p); want.push(p); }
    }
  }
  for (const p of want.slice(1)) {
    const to = join(dir, tree.rel(p));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(p, to);
  }
  return join(dir, basename(file));
}

const fires = (set, rule, dir, name) => SET[set](dir, {}).findings.some((f) => f.rule === rule && basename(f.path) === name);

export function seed(root, opts = {}) {
  const per = opts.perOperator ?? 25;
  const skipRepos = opts.skip || [];
  const deny = opts.excludePaths || [];
  const repos = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name).sort().filter((r) => !skipRepos.some((k) => r.includes(k)));
  const cache = new Map();
  const repoOf = (repo) => {
    if (!cache.has(repo)) {
      const tree = directoryTree(join(root, repo));
      const byName = new Map();
      for (const p of tree.list()) {
        const k = basename(p, extname(p)).toUpperCase();
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(p);
      }
      cache.set(repo, { tree, byName, hosts: tree.list().filter(isProgram).filter(inScope({ deny })) });
    }
    return cache.get(repo);
  };
  const work = mkdtempSync(join(opts.keep || tmpdir(), 'cobolwork-seed-'));
  const operators = {};
  try {
    for (const [op, spec] of Object.entries(OPERATORS)) {
      const r = (operators[op] = { rule: spec.rule, planted: 0, found: 0, hosts: [], missed: [], skipped: {} });
      const skip = (why) => { r.skipped[why] = (r.skipped[why] || 0) + 1; };
      // A byte-identical copy of a host already used is the same sample twice. The corpus holds 12
      // copies of one AWS sample application, which would otherwise supply most CICS hosts.
      const used = new Set();
      // Round-robin over repositories, so no one repository supplies every host.
      const queues = repos.map((repo) => ({ repo, i: 0 }));
      let progressed = true;
      while (r.planted < per && progressed) {
        progressed = false;
        for (const q of queues) {
          if (r.planted >= per) break;
          const { tree, byName, hosts } = repoOf(q.repo);
          if (q.i >= hosts.length) continue;
          progressed = true;
          const file = hosts[q.i++];
          let src;
          try { src = readSource(file).text; } catch { skip('unreadable'); continue; }
          if (!/PROCEDURE\s+DIVISION/i.test(src)) { skip('not a program'); continue; }
          if (detectFormat(src) !== 'fixed') { skip('not fixed format'); continue; }
          const digest = createHash('sha1').update(src).digest('hex');
          if (used.has(digest)) { skip('a copy of a host already used'); continue; }
          let planted;
          try { planted = spec.plant(src, { parse: () => tree.parse(file, src) }); } catch { skip('the host does not parse'); continue; }
          if (planted.skip) { skip(planted.skip); continue; }
          const dir = join(work, `${op}-${r.planted}-${q.repo}`.replace(/[^A-Za-z0-9_.-]/g, '_'));
          const host = stage(tree, byName, file, dir);
          writeFileSync(host, src, 'utf8');
          const name = basename(host);
          // A host that already fires the rule cannot show that the plant was found.
          try {
            if (fires(spec.set, spec.rule, dir, name)) { skip('the rule already fires on the host'); continue; }
          } catch { skip('the host does not scan'); continue; }
          writeFileSync(host, planted.text, 'utf8');
          r.planted++;
          used.add(digest);
          r.hosts.push(`${q.repo}/${tree.rel(file)}`);
          let hit = false;
          try { hit = fires(spec.set, spec.rule, dir, name); } catch { /* a scan that throws found nothing */ }
          if (hit) r.found++;
          else r.missed.push(`${q.repo}/${tree.rel(file)}`);
          if (!opts.keep) rmSync(dir, { recursive: true, force: true });
        }
      }
      r.seededRecall = r.planted ? Number((r.found / r.planted).toFixed(3)) : null;
    }
  } finally {
    if (!opts.keep) rmSync(work, { recursive: true, force: true });
  }
  return { root, perOperator: per, skippedRepos: skipRepos, excludedPaths: deny, operators };
}

if (process.argv[1] && basename(process.argv[1]) === 'seed.mjs') {
  const args = process.argv.slice(2);
  const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const list = (k) => (val(k) ? val(k).split(',').map((x) => x.trim()).filter(Boolean) : []);
  const root = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!root) {
    process.stderr.write('usage: node bench/seed.mjs <corpus-root> [--per-operator n] [--skip a,b] [--exclude-paths a,b] [--out file] [--keep dir]\n');
    process.exit(2);
  }
  const out = seed(root, { perOperator: val('--per-operator') ? Number(val('--per-operator')) : 25, skip: list('--skip'), excludePaths: list('--exclude-paths'), keep: val('--keep') });
  if (val('--out')) writeFileSync(val('--out'), JSON.stringify(out, null, 1));
  for (const [op, r] of Object.entries(out.operators)) {
    const repos = new Set(r.hosts.map((h) => h.split('/')[0])).size;
    process.stdout.write(`${op.padEnd(22)} ${String(r.found).padStart(3)} of ${String(r.planted).padStart(3)} found in ${repos} repositories  (${r.rule})\n`);
    for (const m of r.missed.slice(0, 5)) process.stdout.write(`    missed ${m}\n`);
  }
  process.stdout.write('\nSeeded recall: measured against planted flaws, not against flaws as they occur.\n');
}
