// SPDX-License-Identifier: AGPL-3.0-or-later
// HLASM's OPTABLE option: which operation code table the assembler reads machine instructions from.
// A mnemonic outside the chosen table is no instruction, so a macro of that name is called instead.
import { readFileSync, existsSync } from 'node:fs';

const TABLE = new URL('../../rules/hlasm-optables.json', import.meta.url);
const T = existsSync(TABLE) ? JSON.parse(readFileSync(TABLE, 'utf8')) : { levels: [], synonyms: {}, machines: {}, mnemonics: {} };
const RANK = new Map(T.levels.map((level, i) => [level, i]));

// An OPTABLE or MACHINE suboption as written, to the table's level; null when it names none.
export function optableLevel(name, { machine = false } = {}) {
  const n = String(name || '').trim().toUpperCase();
  if (machine) return T.machines[n] ?? null;
  if (n === 'UNI') return 'UNI';
  return RANK.has(n) ? n : T.synonyms[n] ?? null;
}

// "UNI,DOS-370": UNI, a level, a level and later (X-), or a range (X-Y).
function covers(ranges, level) {
  return ranges.split(',').some((part) => {
    if (part === level) return true;
    if (level === 'UNI') return false;
    const m = /^([^-]+)-([^-]*)$/.exec(part);
    if (!m || !RANK.has(m[1])) return false;
    const at = RANK.get(level);
    return at >= RANK.get(m[1]) && (m[2] === '' || at <= RANK.get(m[2]));
  });
}

// Whether the table at this level (UNI when none is given) holds the mnemonic; one the table does not
// list is taken as held.
const excluded = new Map();
export function inOptable(mnemonic, level) {
  const at = level ?? 'UNI';
  if (!excluded.has(at)) excluded.set(at, new Set(Object.entries(T.mnemonics).filter(([, ranges]) => !ranges.some((r) => covers(r, at))).map(([m]) => m)));
  return !excluded.get(at).has(mnemonic);
}

// OPTABLE or MACHINE in an option string (PARM, *PROCESS), to a level; OVERRIDE(...) says it is forced.
export function optableIn(options) {
  const text = String(options || '').toUpperCase();
  const override = /OVERRIDE\(([^)]*(?:\([^)]*\)[^)]*)*)\)/.exec(text)?.[1] ?? '';
  const read = (s) => {
    const o = /\bOPTABLE\(\s*([A-Z0-9]+)/.exec(s);
    if (o) return optableLevel(o[1]);
    const m = /\bMACHINE\(\s*([A-Z0-9-]+)/.exec(s);
    return m ? optableLevel(m[1], { machine: true }) : null;
  };
  const forced = read(override);
  return forced ? { level: forced, override: true } : read(text) ? { level: read(text), override: false } : null;
}

// The *PROCESS statements that open a source file name its options.
export function processOptions(text) {
  const out = [];
  for (const line of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!/^\*PROCESS\s/i.test(line)) break;
    out.push(line.slice(8, 71).trim());
  }
  return out.join(',');
}
