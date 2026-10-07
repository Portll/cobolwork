// SPDX-License-Identifier: AGPL-3.0-or-later
import { detectFormat, expandTabs } from '../parser.mjs';
import { cobolCard } from '../cards.mjs';
import { decodeEbcdic, inScope, isJcl, isSource, looksEbcdic, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { drive, loopOver } from '../kernel/shared-pass.mjs';

// Content a compiler ignores and an editor often hides, but an agent reading the source will see:
// the sequence area, the identification area past column 72, comment lines, and characters that
// change how text reads. A modernisation or review agent is the reader these would target.
//
// Every rule here was tightened against a measured false positive, each named at its test:
// licence text running past column 72 in a file that is not really fixed format; a banner of
// asterisks filling the sequence area; a build note mentioning chmod; a binary file named .cbl.

export const HIDDEN_RULES = {
  'hidden-payload-in-identification-area': {
    sev: 'high', evidence: 'tampering', cwe: 'CWE-1427',
    text: 'Columns 73 to 80, which the compiler ignores, carry a payload rather than a change tag',
    impact: 'Text in the columns the compiler ignores is invisible to a casual reader but read by an agent or tool processing the source',
    remedy: 'Remove the content from the identification/columns-73+ area; nothing a program needs belongs there',
  },
  'hidden-payload-in-sequence-area': {
    sev: 'high', evidence: 'tampering', cwe: 'CWE-1427',
    text: 'The sequence area carries varying text rather than line numbers or a change tag',
    impact: 'Text in the sequence-number columns the compiler ignores is invisible to a casual reader but read by an agent or tool',
    remedy: 'Remove the content from the sequence area (columns 1-6); it is not part of the program',
  },
  'agent-directive-in-comment': {
    sev: 'high', evidence: 'tampering', cwe: 'CWE-1427',
    text: 'A comment tells its reader to ignore instructions, or to fetch and run something',
    impact: 'A comment instructs the agent or tool reading the code to ignore instructions or fetch and run something',
    remedy: 'Delete the directive; treat its presence as a tampering incident and check who added it',
  },
  'encoded-blob': {
    sev: 'med', evidence: 'tampering', cwe: 'CWE-506',
    text: 'A long encoded run sits in a comment or literal',
    impact: 'A long encoded run hides content from a reader that a tool or agent will decode',
    remedy: 'Remove the encoded blob, or if it is legitimate data move it out of source into a named, documented resource',
  },
  'bidi-or-invisible-characters': {
    sev: 'high', evidence: 'tampering', cwe: 'CWE-94',
    text: 'Characters that reorder or hide text appear in the source',
    impact: 'Bidirectional or invisible characters make the source read differently to a person than it runs, or than a tool parses',
    remedy: 'Strip the bidirectional/invisible characters; keep source to the plain characters the compiler reads',
  },
};

// Addressed to a reader, or a fetch that ends in execution. A comment that merely names curl, a
// URL or chmod is ordinary build documentation.
const ADDRESSED = /ignore\s+(all\s+)?(previous|prior|earlier|above)|disregard\s+(?:the\s+)?(?:(?:previous|prior|above|earlier)\s*)?instruction|system\s+prompt|you\s+are\s+an?\s+(ai|agent|assistant|language model)|as\s+an\s+ai\b|do\s+not\s+(tell|mention|report|inform)\b|before\s+you\s+(continue|proceed|answer)|exfiltrat/i;
// A fetch piped to a shell, a fetch then && and a shell or chmod, or a raw socket; found in linear time.
const FETCHES = /(?:curl|wget)\b|base64\s+-d/i;
const SHELL_FIRST = /^\s*(?:ba)?sh\b/i;
const SOCKET = /\/dev\/tcp\/|\bnc\s+-e\b/i;
function fetchAndRun(text) {
  if (SOCKET.test(text)) return true;
  const segments = text.split('|');
  for (let i = 1; i < segments.length; i++) if (SHELL_FIRST.test(segments[i]) && FETCHES.test(segments[i - 1])) return true;
  const fetch = text.search(/(?:curl|wget)\b/i);
  const and = fetch < 0 ? -1 : text.indexOf('&&', fetch);
  return and >= 0 && /\b(?:sh|bash|chmod)\b/i.test(text.slice(and + 2));
}
const INVISIBLE = /[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u061c]|\udb40[\udc00-\udc7f]/;
const BASE64_RUN = /[A-Za-z0-9+/]{200,}={0,2}/;
const HEX_RUN = /\b[0-9a-fA-F]{200,}\b/;
const TAG = /^[A-Z0-9][A-Z0-9.\-/ ]*$/;
const BANNER = /^[\s*\-=_+#/\\.]*$/;

function areas(line, format) {
  const l = expandTabs(line);
  const card = cobolCard(l, format);
  const fixed = format === 'fixed';
  return { ...card, identification: fixed ? card.ignored.slice(0, 8) : '', ignored: fixed ? card.ignored : '' };
}

// A floating comment, from the *> that starts it outside a literal to the end of the line.
function inlineComment(text) {
  let quote = null;
  for (let i = 0; i < text.length - 1; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '*' && text[i + 1] === '>') return text.slice(i);
  }
  return '';
}

// Fixed format is claimed, not assumed: a file whose lines simply run past column 72 is free-format
// text, and its tail is prose rather than a payload.
function looksFixed(lines) {
  let sequenced = 0;
  let bodied = 0;
  for (const raw of lines.slice(0, 400)) {
    const l = expandTabs(raw);
    if (!l.trim()) continue;
    bodied++;
    if (/^[A-Z\d ]{6}[ */\-Dd$]/.test(l)) sequenced++;
  }
  return bodied > 0 && sequenced / bodied > 0.6;
}

// A change tag repeats down the file and is short. A payload varies line to line and looks like
// data: no spaces, no sentence punctuation. Prose fails that test, which is what separates a
// payload from the tail of a long comment in a file that only looks fixed-format.
const DATA_LIKE = /^[A-Za-z0-9+/=_-]{6,8}$/;

function identificationPayload(lines, format) {
  const runs = [];
  let run = [];
  for (let i = 0; i < lines.length; i++) {
    const id = areas(lines[i], format).identification.trim();
    if (id && DATA_LIKE.test(id) && !TAG.test(id) && !BANNER.test(id)) run.push({ line: i + 1, id });
    else { if (run.length >= 4) runs.push(run); run = []; }
  }
  if (run.length >= 4) runs.push(run);
  return runs.filter(r => new Set(r.map(x => x.id)).size >= Math.max(3, r.length * 0.6));
}

// A payload in the sequence area sits on a line the compiler reads as fixed-format code - a valid
// indicator in column 7 - and fills all six columns with data. A floating *> comment, JCL or prose
// pasted into a program, and a file in another language start in column 1 and fail that; so does a
// sequence number with a short letter prefix, in either case.
const SEQUENCE_DATA = /^[A-Za-z0-9+/=_-]{6}$/;
const SEQUENCE_NUMBER = /^[A-Za-z]{0,4}\d{2,6}$/;
const FIXED_INDICATOR = /^[ */\-Dd$]$/;
const NOT_CODE = /^(\*>|\/\/|\/\*)/;
// A directive that makes the rest of the file free format, where columns 1-6 are ordinary text.
const TO_FREE = />>\s*SOURCE\s+(?:FORMAT\s+)?(?:IS\s+)?FREE\b|SOURCEFORMAT\s*(?:\(\s*)?["']?FREE/i;

function sequencePayload(lines, format) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (TO_FREE.test(lines[i])) break;
    const a = areas(lines[i], format);
    const s = a.sequence;
    if (!FIXED_INDICATOR.test(a.indicator) || NOT_CODE.test(s)) continue;
    if (!SEQUENCE_DATA.test(s) || SEQUENCE_NUMBER.test(s) || TAG.test(s)) continue;
    rows.push({ line: i + 1, s });
  }
  return new Set(rows.map(r => r.s)).size >= 4 ? rows : [];
}

const looksBinary = (buf) => {
  const n = Math.min(buf.length, 4096);
  if (!n) return false;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return true;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  return odd / n > 0.05;
};

export function* scanHiddenSteps(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isSource).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, filesBinary: 0, filesEbcdic: 0 };
  // This set reads every source file in the tree as raw bytes, which is the widest reading of the
  // nine, so it is the one most worth walking inside the guard.
  const run = yield loopOver(files, (f) => {
    let buf;
    try { buf = tree.bytes(f); } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    // An EBCDIC member is decoded before any rule reads it; read as bytes it looks binary, and a
    // payload in it would be skipped along with the file.
    const ebcdic = looksEbcdic(buf);
    if (!ebcdic && looksBinary(buf)) { stats.filesBinary++; return buf.length; }
    if (ebcdic) stats.filesEbcdic++;
    stats.filesScanned++;
    const path = relPath(root, f);
    // A byte-order mark at the very start is an encoding marker, not hidden content.
    const text = ebcdic ? decodeEbcdic(buf) : buf.toString('utf8').replace(/^\ufeff/, '');
    const src = ebcdic ? text : buf.toString('latin1');
    const lines = src.split(/\r?\n/);
    const jcl = isJcl(f);
    const detected = detectFormat(src);
    const format = jcl ? 'free' : detected === 'fixed' && !looksFixed(lines) ? 'free' : detected;

    for (const run of identificationPayload(lines, format)) {
      findings.push({ rule: 'hidden-payload-in-identification-area', path, line: run[0].line, detail: `${run.length} consecutive lines carry varying data in columns 73 to 80, which the compiler ignores` });
    }
    // Data planted in columns 1-6 is exactly what makes a file stop looking fixed-format, so this
    // test takes the format as detected and judges each line by its indicator instead.
    const seq = sequencePayload(lines, jcl ? 'free' : detected);
    if (seq.length >= 4) findings.push({ rule: 'hidden-payload-in-sequence-area', path, line: seq[0].line, detail: `${seq.length} lines carry varying text in the sequence area, which the compiler ignores` });

    for (let i = 0; i < lines.length; i++) {
      const a = areas(lines[i], format);
      const isComment = a.indicator === '*' || a.indicator === '/' || /^\s*\*>/.test(a.text) || /^\s*\*/.test(lines[i]) || /^\/\/\*/.test(lines[i]);
      // Text no compiler reads: a whole comment line, or an inline comment and anything past column 72.
      const inline = isComment || jcl ? '' : inlineComment(a.text);
      const unread = isComment ? lines[i] : `${inline} ${a.ignored}`;
      if (ADDRESSED.test(unread) || fetchAndRun(unread)) {
        const where = isComment ? 'a comment' : (ADDRESSED.test(a.ignored) || fetchAndRun(a.ignored)) ? 'text past column 72, which the compiler ignores,' : 'an inline comment';
        findings.push({ rule: 'agent-directive-in-comment', path, line: i + 1, detail: ADDRESSED.test(unread) ? `${where} addresses its reader with an instruction about instructions` : `${where} gives a command that fetches and runs something` });
      }
      if (BASE64_RUN.test(lines[i]) || HEX_RUN.test(lines[i])) {
        findings.push({ rule: 'encoded-blob', path, line: i + 1, detail: 'a run of at least 200 encoded characters' });
      }
    }
    if (INVISIBLE.test(text)) {
      const line = text.split(/\r?\n/).findIndex(l => INVISIBLE.test(l)) + 1;
      findings.push({ rule: 'bidi-or-invisible-characters', path, line: line || 1, detail: 'the source contains characters that reorder or hide text' });
    }
    return buf.length;
  }, { label: 'hidden', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('hidden', { rules: HIDDEN_RULES, findings, stats, run });
}

export const scanHidden = (root, opts = {}) => drive(scanHiddenSteps(root, opts));
