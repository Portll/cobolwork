// Seeded recall and seeded false alarms: plants known flaws, and near-misses of them, into copies
// of real programs and asks whether the rule that should see the flaw does, and whether it stays
// quiet about the near-miss. bench/cases measures the rules on programs written to exercise them;
// this measures them inside programs nobody wrote for the purpose - real copybooks, real layouts,
// real dialect - which is where a parser gap or a resolution miss would lose a finding.
//
//   node bench/seed.mjs <corpus-root> [--per-operator 25] [--skip a,b] [--exclude-paths a,b]
//                        [--out file] [--keep dir]
//
// A near-miss is the flaw's change with the one property that makes it a flaw taken away: the
// input or its length checked before it is used, or the input read and not used. Every variant of
// an operator is planted into the same host, so a flaw and its near-misses differ only in that
// property. Each planted program is a label by construction (`labels` in --out, source `planted`):
// a flaw the rule does not report is a miss, a near-miss it reports is a false alarm. Both are
// measured against the planter's idea of the bug, not against bugs as they occur, so they are
// reported as seeded recall and seeded false alarms, never as recall or precision.
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

export const FLAW = 'flaw';
export const NEAR_MISS = 'near-miss';

// Fixed format only. Area A starts in column 8 and code ends at 72; a planted line that lands in
// the sequence area or past column 72 is a different program from the one intended.
const AREA_A = '       ';
const AREA_B = '           ';
const code = (line) => (line.length > 7 && line[6] !== '*' && line[6] !== '/' ? line.slice(7, 72) : '');

// DECLARATIVES open the procedure division, so nothing may be planted between its header and them.
function sites(lines) {
  if (lines.some((l) => /\bDECLARATIVES\b/i.test(code(l)))) return null;
  let ws = -1;
  for (let i = 0; i < lines.length; i++) {
    const c = code(lines[i]);
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

// Adds data items after the WORKING-STORAGE header and statements after the PROCEDURE DIVISION
// header. A statement's own leading spaces indent it within area B.
function insert(lines, { items = [], statements = [] }) {
  const at = sites(lines);
  if (!at) return { skip: 'no working-storage and procedure division to plant in' };
  const data = items.map((s) => AREA_A + s);
  const procedure = statements.map((s) => AREA_B + s);
  if ([...data, ...procedure].some((l) => l.length > 72)) return { skip: 'a planted line would pass column 72' };
  const out = [...lines];
  out.splice(at.proc + 1, 0, ...procedure);
  out.splice(at.ws + 1, 0, ...data);
  return { text: out.join('\n') };
}

const allowList = (field, allowed, then) => [
  `EVALUATE ${field}`,
  ...allowed.map((v) => `   WHEN '${v}'`),
  '      CONTINUE',
  '   WHEN OTHER',
  '      GOBACK',
  'END-EVALUATE',
  ...then,
];

// The program's own first literal CALL after the PROCEDURE DIVISION header, rewritten to call
// through WS-SEED-PGM, with the name it called.
function dynamicCall(src) {
  const lines = src.split(/\r?\n/);
  const at = sites(lines);
  if (!at) return { skip: 'no working-storage and procedure division to plant in' };
  const CALL = /\bCALL\s+(['"])([A-Z0-9$#@-]+)\1/i;
  const k = lines.findIndex((l, i) => i > at.proc && CALL.test(code(l)));
  if (k < 0) return { skip: 'no literal CALL' };
  const target = code(lines[k]).match(CALL)[2];
  const rewritten = code(lines[k]).replace(CALL, 'CALL WS-SEED-PGM').trimEnd();
  if (rewritten.length > 65) return { skip: 'the rewritten CALL would pass column 72' };
  lines[k] = lines[k].slice(0, 7) + rewritten;
  return { lines, target, pic: `PIC X(${Math.max(8, target.length)})` };
}

// A CICS program that tests EIBCALEN in its procedure division and reads the caller's
// communication area. EIBCALEN named where no plant reaches - a declaration, as a translated
// program's DFHEIBLK or an area that OCCURS DEPENDING ON it, or a copybook - may still check the
// length after the plant, so the program is not a host.
function readsCommareaAndTestsLength(src, host) {
  const lines = src.split(/\r?\n/);
  const at = sites(lines);
  if (!at) return 'no working-storage and procedure division to plant in';
  const procedure = lines.slice(at.proc + 1).map(code).join('\n');
  const namesLength = (text) => text.split(/\r?\n/).some((l) => /\bEIBCALEN\b/i.test(code(l)));
  if (!/\bEXEC\s+CICS\b/i.test(procedure)) return 'no EXEC CICS of its own';
  if (!/\bEIBCALEN\b/i.test(procedure)) return 'does not check EIBCALEN';
  if (namesLength(lines.slice(0, at.proc).join('\n'))) return 'names EIBCALEN in a declaration';
  if (host.copybooks.some((p) => namesLength(readSource(p).text))) return 'a copybook it includes names EIBCALEN';
  if (/\bSET\s+ADDRESS\s+OF\s+DFHCOMMAREA\s+TO\b/i.test(procedure)) return 'points DFHCOMMAREA at its own storage';
  const reads = host.parse().programs.some((p) => {
    const area = p.items.find((i) => i.name === 'DFHCOMMAREA' && i.section === 'LINKAGE');
    return area && subtreeRead(area);
  });
  return reads ? null : 'does not read a communication area';
}

const subtreeRead = (x) => x.directRefs > 0 || x.children.some(subtreeRead);

// Every EIBCALEN in the procedure division's code becomes EIBRESP, which is as wide, so no line
// moves past column 72 and only the check is gone.
function withoutLengthCheck(src) {
  const lines = src.split(/\r?\n/);
  const at = sites(lines);
  return lines.map((l, i) => (i > at.proc && code(l) ? l.slice(0, 7) + l.slice(7).replace(/\bEIBCALEN\b/gi, 'EIBRESP ') : l));
}

// Each operator names the rule and set that should report its flaws. `host` says why a program
// cannot take the operator, or nothing; each variant's `plant` returns the new text, or a reason
// this host cannot take that variant, and the host is used only when every variant plants.
export const OPERATORS = {
  // Command-line input handed to an operating-system command.
  'argv-to-os-command': {
    set: 'flow', rule: 'argv-or-env-to-os-command',
    host: () => null,
    variants: {
      'command-from-argv': {
        label: FLAW,
        plant: (src) => insert(src.split(/\r?\n/), {
          items: ['01 WS-SEED-IN PIC X(80).'],
          statements: ['ACCEPT WS-SEED-IN FROM COMMAND-LINE', "CALL 'SYSTEM' USING WS-SEED-IN."],
        }),
      },
      // bench/cases/062: an EVALUATE lets two commands through and ends the run on any other.
      'argv-allowed-by-an-evaluate': {
        label: NEAR_MISS,
        plant: (src) => insert(src.split(/\r?\n/), {
          items: ['01 WS-SEED-IN PIC X(80).'],
          statements: ['ACCEPT WS-SEED-IN FROM COMMAND-LINE',
            ...allowList('WS-SEED-IN', ['date', 'uptime'], ["CALL 'SYSTEM' USING WS-SEED-IN."])],
        }),
      },
      // bench/cases/002: the input is read, and a literal command is what runs.
      'argv-read-literal-run': {
        label: NEAR_MISS,
        plant: (src) => insert(src.split(/\r?\n/), {
          items: ['01 WS-SEED-IN PIC X(80).', "01 WS-SEED-CMD PIC X(80) VALUE 'date'."],
          statements: ['ACCEPT WS-SEED-IN FROM COMMAND-LINE', 'DISPLAY WS-SEED-IN',
            "CALL 'SYSTEM' USING WS-SEED-CMD."],
        }),
      },
    },
  },
  // The program's own first literal CALL, wherever it sits, made to take its target from the
  // command line. The flaw is at a real call site rather than beside the header.
  'argv-to-dynamic-call': {
    set: 'flow', rule: 'argv-or-env-to-dynamic-program-load',
    host: (src) => dynamicCall(src).skip ?? null,
    variants: {
      'call-target-from-argv': {
        label: FLAW,
        plant(src) {
          const { lines, pic } = dynamicCall(src);
          return insert(lines, {
            items: [`01 WS-SEED-PGM ${pic}.`],
            statements: ['ACCEPT WS-SEED-PGM FROM COMMAND-LINE.'],
          });
        },
      },
      // The command line may only name the program the call already made; any other name ends
      // the run before the call.
      'argv-must-name-the-program': {
        label: NEAR_MISS,
        plant(src) {
          const { lines, target, pic } = dynamicCall(src);
          return insert(lines, {
            items: [`01 WS-SEED-PGM ${pic}.`],
            statements: ['ACCEPT WS-SEED-PGM FROM COMMAND-LINE',
              `IF WS-SEED-PGM NOT = '${target}'`, '   GOBACK', 'END-IF.'],
          });
        },
      },
      // The call goes through a field that holds the program's own name; the command line is
      // read into another.
      'argv-read-literal-target': {
        label: NEAR_MISS,
        plant(src) {
          const { lines, target, pic } = dynamicCall(src);
          return insert(lines, {
            items: [`01 WS-SEED-PGM ${pic} VALUE '${target}'.`, '01 WS-SEED-IN PIC X(80).'],
            statements: ['ACCEPT WS-SEED-IN FROM COMMAND-LINE', 'DISPLAY WS-SEED-IN.'],
          });
        },
      },
    },
  },
  // A CICS program that reads its communication area and checks EIBCALEN, made to stop checking.
  // EIBRESP is the same size in the same block, so the program stays valid and only the check is
  // gone. A program that declares the area and never reads it is not a host: the rule is right to
  // stay quiet about it.
  'drop-length-check': {
    set: 'cics', rule: 'cics-commarea-without-length-check',
    host: readsCommareaAndTestsLength,
    variants: {
      'length-check-removed': {
        label: FLAW,
        plant: (src) => ({ text: withoutLengthCheck(src).join('\n') }),
      },
      // EIBCALEN is still named, in a copy nothing tests.
      'length-copied-never-tested': {
        label: FLAW,
        plant: (src) => insert(withoutLengthCheck(src), {
          items: ['01 WS-SEED-LEN PIC S9(4) COMP.'],
          statements: ['MOVE EIBCALEN TO WS-SEED-LEN.'],
        }),
      },
      // The host's own checks are gone as in the flaw, and the program returns on entry unless
      // the whole area was passed, so every read of it lies within what the caller passed. The
      // host's checks are not relied on: they may not have been enough.
      'length-checked-on-entry': {
        label: NEAR_MISS,
        plant: (src) => insert(withoutLengthCheck(src), {
          statements: ['IF EIBCALEN < LENGTH OF DFHCOMMAREA', '   EXEC CICS RETURN END-EXEC', 'END-IF.'],
        }),
      },
    },
  },
};

// The copybooks a program pulls in by COPY or EXEC SQL INCLUDE, followed through nesting.
const COPY = /\b(?:COPY|INCLUDE)\s+['"]?([A-Z0-9$#@_-]+)/gi;
function includes(byName, file) {
  const want = [file];
  const seen = new Set(want);
  for (let i = 0; i < want.length; i++) {
    let text;
    try { text = readSource(want[i]).text; } catch { continue; }
    for (const m of text.matchAll(COPY)) {
      for (const p of byName.get(m[1].toUpperCase()) || []) if (!seen.has(p)) { seen.add(p); want.push(p); }
    }
  }
  return want.slice(1);
}

// The host travels with its copybooks, at their paths in the repository so they resolve as they
// did there. Other programs do not: every planted flaw is inside the one program.
function stage(tree, copybooks, file, dir) {
  mkdirSync(dir, { recursive: true });
  for (const p of copybooks) {
    const to = join(dir, tree.rel(p));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(p, to);
  }
  return join(dir, basename(file));
}

// Everything staged is the host or a copybook it includes, so a finding anywhere in the directory
// is the host's: a communication area declared in a copybook is reported there.
const fires = (set, rule, dir) => SET[set](dir, {}).findings.some((f) => f.rule === rule);

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
  const labels = [];
  try {
    for (const [op, spec] of Object.entries(OPERATORS)) {
      const variants = Object.fromEntries(Object.entries(spec.variants).map(([v, { label }]) => [v, { label, planted: 0, reported: 0 }]));
      const r = (operators[op] = { rule: spec.rule, hosts: [], planted: 0, found: 0, missed: [], nearMisses: 0, falseAlarms: [], variants, skipped: {} });
      const skip = (why) => { r.skipped[why] = (r.skipped[why] || 0) + 1; };
      // A byte-identical copy of a host already used is the same sample twice. The corpus holds 12
      // copies of one AWS sample application, which would otherwise supply most CICS hosts.
      const used = new Set();
      let staged = 0;
      // Round-robin over repositories, so no one repository supplies every host.
      const queues = repos.map((repo) => ({ repo, i: 0 }));
      let progressed = true;
      while (r.hosts.length < per && progressed) {
        progressed = false;
        for (const q of queues) {
          if (r.hosts.length >= per) break;
          const { tree, byName, hosts } = repoOf(q.repo);
          if (q.i >= hosts.length) continue;
          progressed = true;
          const file = hosts[q.i++];
          let src;
          try { src = readSource(file).text; } catch { skip('unreadable'); continue; }
          if (!/PROCEDURE\s+DIVISION/i.test(src)) { skip('not a program'); continue; }
          if (detectFormat(src) !== 'fixed') { skip('not fixed format'); continue; }
          // Plants go into the first program's divisions; a second program in the file would hold
          // code they do not reach, and a call site rewritten there would name a field it cannot see.
          if (src.split(/\r?\n/).filter((l) => /\bPROGRAM-ID\b/i.test(code(l))).length > 1) { skip('holds more than one program'); continue; }
          const digest = createHash('sha1').update(src).digest('hex');
          if (used.has(digest)) { skip('a copy of a host already used'); continue; }
          const copybooks = includes(byName, file);
          const host = { parse: () => tree.parse(file, src), copybooks };
          let planted;
          try {
            const refused = spec.host(src, host);
            if (refused) { skip(refused); continue; }
            planted = Object.entries(spec.variants).map(([v, { label, plant }]) => ({ v, label, ...plant(src, host) }));
          } catch { skip('the host does not parse'); continue; }
          const refused = planted.find((p) => p.skip);
          if (refused) { skip(refused.skip); continue; }
          const dir = join(work, `${op}-${staged++}-${q.repo}`.replace(/[^A-Za-z0-9_.-]/g, '_'));
          const copy = stage(tree, copybooks, file, dir);
          writeFileSync(copy, src, 'utf8');
          // A host that already fires the rule cannot show that a flaw was found or a near-miss passed.
          let already;
          try { already = fires(spec.set, spec.rule, dir) ? 'the rule already fires on the host' : null; } catch { already = 'the host does not scan'; }
          if (already) {
            skip(already);
            if (!opts.keep) rmSync(dir, { recursive: true, force: true });
            continue;
          }
          used.add(digest);
          const at = `${q.repo}/${tree.rel(file)}`;
          r.hosts.push(at);
          for (const p of planted) {
            writeFileSync(copy, p.text, 'utf8');
            let reported = false;
            try { reported = fires(spec.set, spec.rule, dir); } catch { /* a scan that throws reported nothing */ }
            variants[p.v].planted++;
            if (reported) variants[p.v].reported++;
            if (p.label === FLAW) {
              r.planted++;
              if (reported) r.found++;
              else r.missed.push(`${at} (${p.v})`);
            } else {
              r.nearMisses++;
              if (reported) r.falseAlarms.push(`${at} (${p.v})`);
            }
            labels.push({ source: 'planted', rule: spec.rule, set: spec.set, operator: op, variant: p.v, label: p.label, host: at, hostSha1: digest, reported });
          }
          if (!opts.keep) rmSync(dir, { recursive: true, force: true });
        }
      }
      r.seededRecall = r.planted ? Number((r.found / r.planted).toFixed(3)) : null;
      r.seededFalseAlarmRate = r.nearMisses ? Number((r.falseAlarms.length / r.nearMisses).toFixed(3)) : null;
    }
  } finally {
    if (!opts.keep) rmSync(work, { recursive: true, force: true });
  }
  return { root, perOperator: per, skippedRepos: skipRepos, excludedPaths: deny, operators, labels };
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
    process.stdout.write(`${op} (${r.rule}): ${r.hosts.length} hosts in ${repos} repositories\n`);
    for (const [v, s] of Object.entries(r.variants)) {
      process.stdout.write(`    ${v.padEnd(30)} ${s.label.padEnd(9)} ${String(s.reported).padStart(3)} of ${String(s.planted).padStart(3)} reported\n`);
    }
    for (const m of r.missed.slice(0, 5)) process.stdout.write(`    missed ${m}\n`);
    for (const m of r.falseAlarms.slice(0, 5)) process.stdout.write(`    false alarm ${m}\n`);
  }
  process.stdout.write('\nSeeded: measured against planted flaws and near-misses, not against flaws as they occur.\n');
}
