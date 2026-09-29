// Says whether a compiler accepts each candidate word in each role a word can have, beside a control
// word it must refuse there. It observes what the compiler does with a program; it never reads the
// compiler's own word tables, which are its source and carry its licence.
//   node diag/probe-words.mjs <word>... [--cobc <path>] [--std default]
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const COBC = opt('--cobc', 'cobc');
const STD = opt('--std', 'default');
const words = args.filter((a, i) => !a.startsWith('--') && !['--cobc', '--std'].includes(args[i - 1])).map((w) => w.toUpperCase());
if (!words.length) { console.error('usage: node diag/probe-words.mjs <word>... [--cobc <path>] [--std default]'); process.exit(2); }

const CONTROL = 'ZQXNOTAWORD';
const program = (data, body) => [
  '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PROBE.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 W PIC X(64).', '       01 N PIC 9(9).', ...data, '       PROCEDURE DIVISION.', ...body, '           GOBACK.',
].join('\n');
// A data name is the one role the control word passes, so there the question is inverted: a word the
// compiler refuses as a data name is reserved.
const ROLES = [
  ['function', (w) => program([], [`           MOVE FUNCTION ${w} TO W`])],
  ['function', (w) => program([], [`           MOVE FUNCTION ${w}("A" "B") TO W`])],
  ['register', (w) => program([], [`           MOVE ${w} TO N`])],
  ['accept source', (w) => program([], [`           ACCEPT W FROM ${w}`])],
];
const dataName = (w) => program([`       01 ${w} PIC X.`], []);

const dir = mkdtempSync(join(tmpdir(), 'probe-words-'));
const compiles = (src) => {
  const f = join(dir, 'PROBE.cbl');
  writeFileSync(f, src);
  return spawnSync(COBC, ['-fsyntax-only', `-std=${STD}`, '-fformat=fixed', f], { encoding: 'utf8' }).status === 0;
};
try {
  if (!compiles(dataName(CONTROL))) { console.error(`${COBC} refused the control as a data name; the probes cannot be read`); process.exit(3); }
  for (const w of words) {
    const roles = new Set();
    for (const [role, make] of ROLES) if (!compiles(make(CONTROL)) && compiles(make(w))) roles.add(role);
    const reserved = !compiles(dataName(w));
    console.log(`${w.padEnd(30)} ${[...roles].join(', ') || 'no role'}; ${reserved ? 'reserved' : 'usable as a data name'}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
