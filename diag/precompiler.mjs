// GnuCOBOL has no CICS or DB2 precompiler, so a CICS program cannot be compiled and therefore
// cannot witness anything. These transformations stand in for the precompilers, and are applied to
// the text BOTH the compiler and the parser see, so neither side gets an advantage:
//   - EXEC SQL INCLUDE becomes the COPY it really is
//   - other embedded blocks are blanked in the data division, CONTINUE in the procedure division
//   - DFHRESP(...) and DFHVALUE(...) become a literal, as the translator emits
//   - the EIB control block the translator injects is declared
// Columns are preserved throughout: a fixed-format program whose columns shift is a different
// program. Names the stand-in supplies, the EIB block and the copybooks below, are excluded from any
// comparison.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { EIB_LAYOUT, SQLCA_FIELDS } from '../lib/words.mjs';
import { parseBms } from '../lib/bms.mjs';
import { isBms } from '../lib/sources.mjs';
import { symbolicMapCopybook } from '../lib/precompile-cics.mjs';

export { symbolicMapCopybook };

export const EIB_FIELDS = EIB_LAYOUT;

// IBM's DFHAID and DFHBMSCA copybooks are IBM's text and are not in a repository that uses them. The
// names are attested in provenance/words.json; each is declared as one character, which is enough for
// the compiler to accept a program that tests EIBAID or sets an attribute byte.
const { dfhaid, dfhbmsca } = JSON.parse(readFileSync(new URL('../provenance/words.json', import.meta.url), 'utf8')).structured;
export const STAND_IN_COPYBOOKS = { DFHAID: dfhaid.value, DFHBMSCA: dfhbmsca.value };

export function writeStandInCopybooks(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [member, names] of Object.entries(STAND_IN_COPYBOOKS)) {
    writeFileSync(join(dir, `${member}.cpy`), names.map((n) => `       01 ${n} PIC X.`).join('\n') + '\n');
  }
  writeFileSync(join(dir, 'SQLCA.cpy'), standInSqlca());
  return dir;
}

// The SQLCA a COPY SQLCA finds on the witness's path before GnuCOBOL's own, which carries FILLERs the
// grade cannot tell from the program's. Every item is a name the parser takes as supplied; the counts
// and codes are numeric so that a program comparing SQLCODE with a number compiles.
function standInSqlca() {
  const fields = new Set(SQLCA_FIELDS);
  const numeric = (n, pic) => (fields.has(n) ? [`          05 ${n} PIC ${pic} COMP-5.`] : []);
  const warn = [...fields].filter((n) => /^SQLWARN[0-9A]$/.test(n)).map((n) => `             10 ${n} PIC X.`);
  const placed = new Set(['SQLCA', 'SQLCAID', 'SQLCABC', 'SQLCODE', 'SQLERRM', 'SQLERRML', 'SQLERRMC', 'SQLERRP', 'SQLERRD', 'SQLWARN', 'SQLSTATE', ...warn.map((l) => l.trim().split(/\s+/)[1])]);
  return [
    '       01 SQLCA.',
    '          05 SQLCAID PIC X(8).',
    ...numeric('SQLCABC', 'S9(9)'),
    ...numeric('SQLCODE', 'S9(9)'),
    '          05 SQLERRM.',
    '             49 SQLERRML PIC S9(4) COMP-5.',
    '             49 SQLERRMC PIC X(70).',
    '          05 SQLERRP PIC X(8).',
    '          05 SQLERRD PIC S9(9) COMP-5 OCCURS 6.',
    '          05 SQLWARN.',
    ...warn,
    '          05 SQLSTATE PIC X(5).',
    ...[...fields].filter((n) => !placed.has(n)).map((n) => `          05 ${n} PIC X(8).`),
    '',
  ].join('\n');
}

// A repository's stand-in symbolic maps, written to dir: the directory to put on the copy path, or
// null when there are none, and the names they declare, which the grade leaves out of comparison.
export function writeRepositoryMaps(repoRoot, dir) {
  const files = [];
  const walk = (d) => {
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { if (e.name === '.git' || e.name.startsWith('._')) continue; const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); }
  };
  walk(repoRoot);
  const bms = files.filter(isBms);
  const members = new Set(files.filter((f) => !bms.includes(f)).map((f) => basename(f, extname(f)).toUpperCase()));
  const names = writeStandInMaps(dir, bms, (n) => members.has(n.toUpperCase()));
  return { dir: names.length ? dir : null, names };
}

// Symbolic maps for the mapsets a repository's BMS defines and none of its files already supplies.
export function writeStandInMaps(dir, bmsFiles, haveMember) {
  mkdirSync(dir, { recursive: true });
  const names = [];
  for (const f of bmsFiles) {
    let parsed;
    try { parsed = parseBms(readFileSync(f, 'latin1')); } catch { continue; }
    for (const ms of parsed.mapsets) {
      if (!ms.name || haveMember(ms.name)) continue;
      const cb = symbolicMapCopybook(ms);
      if (!cb) continue;
      writeFileSync(join(dir, `${ms.name.toUpperCase()}.cpy`), cb.text);
      names.push(...cb.names);
    }
  }
  return names;
}

// The SQLCA the stand-in's COPY SQLCA finds is GnuCOBOL's, standing in for the one Db2's precompiler
// supplies, and the parser takes its fields as supplied rather than declared.
export const STUB_NAME = new RegExp(`^(DFHEIBLK|EIB[A-Z0-9]+|${[...Object.values(STAND_IN_COPYBOOKS).flat(), ...SQLCA_FIELDS].join('|')})$`);

const blankKeepLines = (x) => x.replace(/[^\n]/g, ' ');

export function maskExec(src) {
  return src
    .replace(/EXEC\s+(SQL|CICS|DLI)\b[\s\S]*?END-EXEC/gi, m => 'CONTINUE' + blankKeepLines(m.slice(8)))
    .replace(/^(.{0,7})(CBL|PROCESS)\s.*$/gim, (_, pre) => blankKeepLines(pre));
}

export function prepareForWitness(src, format) {
  const pad = format === 'terminal' ? ' ' : format === 'free' ? '    ' : '       ';
  const procAt = src.search(/PROCEDURE\s+DIVISION/i);
  let head = procAt >= 0 ? src.slice(0, procAt) : src;
  let body = procAt >= 0 ? src.slice(procAt) : '';
  const fix = (text, inProcedure) => text.replace(/EXEC\s+(SQL|CICS|DLI)\b[\s\S]*?END-EXEC/gi, (x) => {
    const inc = /^EXEC\s+SQL\s+INCLUDE\s+([A-Za-z0-9_-]+)\s+END-EXEC$/i.exec(x);
    if (inc && x.length >= `COPY ${inc[1]}.`.length) return `COPY ${inc[1]}.` + blankKeepLines(x.slice(`COPY ${inc[1]}.`.length));
    return inProcedure ? 'CONTINUE' + blankKeepLines(x.slice(8)) : blankKeepLines(x);
  });
  // The rewritten INCLUDE leaves the statement's own period behind; blank the second one.
  head = fix(head, false).replace(/(COPY [A-Za-z0-9_-]+\.\s*)\./g, '$1 ').replace(/^(.{0,7})(CBL|PROCESS)\s.*$/gim, (_, pre) => blankKeepLines(pre));
  body = fix(body, true).replace(/DFH(RESP|VALUE)\s*\(\s*[A-Za-z0-9-]+\s*\)/gi, (x) => '0' + ' '.repeat(x.length - 1));
  // A program lib/precompile.mjs has translated copies the EIB already.
  const translated = /\bCALL\s+'CW-(?:SQL|CICS)-/.test(body) && /\bCOPY\s+DFHEIBLK\b/i.test(head);
  if (/EXEC\s+CICS|\bEIB[A-Z0-9]+/i.test(src) && !translated) {
    const stub = [`${pad}01 DFHEIBLK.`, ...EIB_FIELDS.map(([n, p]) => `${pad}   05 ${n} PIC ${p}.`)].join('\n');
    if (/LINKAGE\s+SECTION\s*\./i.test(head)) head = head.replace(/(LINKAGE\s+SECTION\s*\.[^\n]*\n)/i, `$1${stub}\n`);
    else if (procAt >= 0) head = head.replace(/([^\n]*)$/, `${pad}LINKAGE SECTION.\n${stub}\n$1`);
  }
  return head + body;
}
