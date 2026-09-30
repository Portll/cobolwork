// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { extname, relative, sep } from 'node:path';

// One definition of what each kind of file is, used by every rule set. They disagreed: the flow
// and CICS rules skipped .sqb and .pco (embedded SQL, where the SQL rules matter most), and the
// resolver could not find a .copy or .inc copybook that the inventory counted.
// A path in a report is POSIX-shaped on every platform. A report is stored, diffed and compared
// against git output, which uses forward slashes, so a native separator would make one file read
// as two. On a platform whose separator already is '/', this is the identity.
export const relPath = (root, p) => relative(root, p).split(sep).join('/');

export const PROGRAM_EXT = ['.cbl', '.cob', '.cobol', '.sqb', '.pco'];
export const COPY_EXT = ['.cpy', '.copy', '.inc'];
export const JCL_EXT = ['.jcl', '.job', '.proc', '.prc', '.cntl'];
export const BMS_EXT = ['.bms'];

const has = (list) => (p) => list.includes(extname(p).toLowerCase());

// A member of a partitioned data set has no extension. That is not an edge case - it is what a
// real estate looks like, because the mainframe has no such thing as a file extension, and an
// estate exported from a PDS arrives as bare names. Reading by extension alone means opening none
// of it and reporting a clean zero, which is the failure this project exists to refuse.
//
// So a file with no extension is classified by what is in it. Only the first few kilobytes are
// read, only files without an extension are sniffed, and the answer is cached: this runs over
// every file in the tree and must not cost a parse.
const SNIFF_BYTES = 4096;
const sniffed = new Map();

// Names that are certainly not source, so the commonest extensionless files cost nothing.
const NOT_SOURCE = /^(LICEN[CS]E|README|MAKEFILE|DOCKERFILE|CHANGELOG|NOTICE|AUTHORS|CONTRIBUTING|CODEOWNERS|VERSION|COPYING|Jenkinsfile|Procfile|\..*)$/i;

export function sniffKind(path) {
  if (sniffed.has(path)) return sniffed.get(path);
  let kind = null;
  const name = path.split(/[\\/]/).pop();
  if (!NOT_SOURCE.test(name)) {
    try {
      const fd = openSync(path, 'r');
      const buf = Buffer.alloc(SNIFF_BYTES);
      let n;
      try { n = readSync(fd, buf, 0, SNIFF_BYTES, 0); } finally { closeSync(fd); }
      const head = buf.subarray(0, n);
      // An EBCDIC member is decoded before it is read, or every test below sees mojibake.
      const text = looksEbcdic(head) ? decodeEbcdic(head) : head.toString('latin1');
      // A NUL byte means binary. Tested on the bytes rather than with a literal, because a literal
      // NUL in source is exactly the character an editor or a patch is most likely to eat.
      if (head.includes(0)) kind = null;
      else if (/^\s*\/\/\S*\s+(?:JOB|EXEC|PROC|DD)\b/m.test(text)) kind = 'jcl';
      else if (/\bIDENTIFICATION\s+DIVISION|\bPROGRAM-ID\s*\./i.test(text)) kind = 'program';
      // A copybook is a data description with no divisions: level numbers and picture clauses.
      else if (/^[^*\n]{0,10}\s*\d\d\s+[A-Z][A-Z0-9-]*\s+(?:PIC|PICTURE|OCCURS|REDEFINES|USAGE)\b/im.test(text)) kind = 'copybook';
      // A BMS map opens its mapset with DFHMSD in the operation field. Tested last, so nothing that
      // classified before classifies differently.
      else if (/^[^*\s]*[ \t]+DFHMSD(?=\s|$)/im.test(text)) kind = 'bms';
    } catch { kind = null; }
  }
  sniffed.set(path, kind);
  return kind;
}

// Extension first, because it is free and it is right whenever it is present.
const byExtOrContent = (list, kind) => (p) => (extname(p) ? list.includes(extname(p).toLowerCase()) : sniffKind(p) === kind);

export const isProgram = byExtOrContent(PROGRAM_EXT, 'program');
export const isCopybook = byExtOrContent(COPY_EXT, 'copybook');
export const isJcl = byExtOrContent(JCL_EXT, 'jcl');
export const isBms = byExtOrContent(BMS_EXT, 'bms');
// Not BMS, by either route: the sets that read every source file have not chosen to read maps.
export const isSource = (p) => (extname(p)
  ? [...PROGRAM_EXT, ...COPY_EXT, ...JCL_EXT].includes(extname(p).toLowerCase())
  : ![null, 'bms'].includes(sniffKind(p)));

// For a report that wants to say how much of what it read had no extension to go on.
export const sniffedCount = () => {
  let n = 0;
  for (const v of sniffed.values()) if (v) n++;
  return n;
};

// `opts.only` is about rule sets; this is about files. A rule set given an allow list reads the
// files on it and no others.
//
// `deny` is the other direction, and it exists for measurement rather than for scanning. A corpus
// run over public COBOL is dominated by files that are not code anybody runs: a repository holding
// the NIST conformance suite fires SET ADDRESS OF thousands of times because exercising every
// construct exhaustively is what those files are for. Counting them tells you about conformance
// suites, not about COBOL. Substrings are matched against the POSIX-shaped path, so 'tests/' and
// '/fixtures/' read the way someone would write them.
//
// It is off unless asked for. A scan of a real estate should read the test code too - test JCL
// carries real credentials as often as anything else does.
export const inScope = (opts = {}) => {
  const allow = opts.allow ? (p) => opts.allow.has(p) : () => true;
  if (!opts.deny || !opts.deny.length) return allow;
  const deny = opts.deny.map((d) => d.replace(/\\/g, '/').toLowerCase());
  return (p) => {
    if (!allow(p)) return false;
    const norm = String(p).replace(/\\/g, '/').toLowerCase();
    return !deny.some((d) => norm.includes(d));
  };
};

// IBM code page 037, the printable range. Positions outside it decode to U+FFFD so an unknown byte
// is visible as unknown rather than guessed at. 037 and 1047 differ only in brackets, caret and
// not-sign, none of which COBOL needs; both bracket positions are mapped so either reads.
const E2A = (() => {
  const t = new Array(256).fill('�');
  const set = (at, chars) => { for (let i = 0; i < chars.length; i++) t[at + i] = chars[i]; };
  t[0x05] = '\t'; t[0x0D] = '\r'; t[0x15] = '\n'; t[0x25] = '\n'; t[0x40] = ' ';
  set(0x4A, '¢.<(+|&'); set(0x5A, '!$*);¬-/');
  set(0x6A, '¦,%_>?'); set(0x79, '`:#@\'="');
  set(0x81, 'abcdefghi'); set(0x91, 'jklmnopqr'); set(0xA1, '~stuvwxyz');
  set(0xC0, '{ABCDEFGHI'); set(0xD0, '}JKLMNOPQR'); set(0xE0, '\\'); set(0xE2, 'STUVWXYZ');
  set(0xF0, '0123456789');
  t[0xAD] = '['; t[0xBA] = '['; t[0xBD] = ']'; t[0xBB] = ']'; t[0x5F] = '¬'; t[0xB0] = '^';
  return t;
})();

// A printable character's EBCDIC position, for ordering. Brackets, caret and not-sign move between
// 037, 1047 and 1140, so they have no one position and give null, as does anything off the table.
const A2E = (() => {
  const at = new Map();
  E2A.forEach((ch, b) => { if (b >= 0x40 && ch !== '�') at.set(ch, at.has(ch) ? null : b); });
  for (const ch of '[]^¬') at.set(ch, null);
  return at;
})();
export const ebcdicByte = (ch) => A2E.get(ch) ?? null;

const ASCII_ALNUM = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A) || (b >= 0x61 && b <= 0x7A);
const EBCDIC_ALNUM = (b) => (b >= 0x81 && b <= 0xA9) || (b >= 0xC1 && b <= 0xE9) || (b >= 0xF0 && b <= 0xF9);

// EBCDIC source has a space at 0x40 and letters above 0x80; ASCII has almost none of either. A NUL
// byte means binary, which is neither.
export function looksEbcdic(buf) {
  const n = Math.min(buf.length, 8192);
  if (n < 16) return false;
  let eb = 0; let as = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b === 0x40 || EBCDIC_ALNUM(b)) eb++;
    if (b === 0x20 || ASCII_ALNUM(b)) as++;
  }
  return eb / n > 0.6 && as / n < 0.25;
}

export function decodeEbcdic(buf) {
  let hasNewline = false;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0x15 || buf[i] === 0x25) { hasNewline = true; break; }
  const chars = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) chars[i] = E2A[buf[i]];
  const text = chars.join('');
  // A member copied off the mainframe in binary keeps its fixed 80-byte records and no line ends.
  if (!hasNewline && buf.length % 80 === 0) return text.match(/[\s\S]{80}/g).join('\n');
  return text;
}

// Every rule set reads source through here, so an EBCDIC member is decoded once, the same way,
// and reported as EBCDIC instead of silently parsing as noise.
export const readSource = (path) => decodeSource(readFileSync(path));

// The same decoding for bytes that did not come from a file: a blob read out of a git revision.
export function decodeSource(buf) {
  if (looksEbcdic(buf)) return { text: decodeEbcdic(buf), encoding: 'ebcdic' };
  return { text: buf.toString('latin1'), encoding: 'latin1' };
}
