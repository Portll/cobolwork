// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { readSource } from './sources.mjs';
import { optionTokens } from './options.mjs';
import {
  RESERVED_WORDS, SPECIAL_REGISTERS, SYSTEM_NAMES, INTRINSIC_FUNCTIONS,
  CONTEXT_SENSITIVE_WORDS, DIRECTIVE_WORDS, EXCEPTION_CONDITIONS,
  EIB_FIELDS, DIB_FIELDS, SQLCA_FIELDS,
} from './words.mjs';
import { CICS_COMMANDS, CICS_EVERY_COMMAND } from './cics-commands.mjs';
import { cicsCommand } from './precompile-cics.mjs';
import { BINARY_SIZE, literalBytes, computeSizes, layoutReport } from './layout.mjs';
import { join, dirname, basename, resolve, isAbsolute, sep, delimiter } from 'node:path';

const FIXED_INDICATORS = new Set([' ', '*', '/', '-', 'D', 'd', '$']);
const COMMENT_ENTRY = /^\s*(AUTHOR|INSTALLATION|DATE-WRITTEN|DATE-COMPILED|SECURITY|REMARKS)\s*\./i;
const COPY_EXTS = ['', '.CPY', '.CBL', '.COB', '.cpy', '.cbl', '.cob', '.copy', '.COPY', '.inc', '.INC'];
// Caps on one parse's COPY expansion: nested COPYs double per level, and the corpus maximum is 86 inclusions.
const MAX_INCLUSIONS = 2000;
const MAX_COPY_TOKENS = 2000000;
// Caps on what REPLACING and REPLACE may add per parse; nested REPLACING doubles text at every level.
const MAX_REPLACED_GROWTH = 500000;
const MAX_REPLACED_CHARS = 16000000;
// Bounded: a mainframe member name is at most eight characters, and the loose prefix form counted
// an absent ATTRIBUTES.cpy as a system copybook, which made an incomplete tree read as covered.
const SYSTEM_COPY = /^(?:(?:DFH|DSN|CEE|IGZ|EZA|BPX|CSQ|CMQ|DLI)[A-Z0-9$#@]{0,5}|SQLCA|SQLDA|ATTRIB)$/i;
const EXEC_KINDS = new Set(['SQL', 'CICS', 'DLI', 'SQLIMS', 'ADO', 'HTML', 'ORACLE', 'TP', 'IDMS', 'XML']);

export const VERBS = new Set(`ACCEPT ADD ALLOCATE ALTER CALL CANCEL CLOSE COMMIT COMPUTE CONTINUE DELETE DISABLE DISPLAY DIVIDE
ENABLE ENTRY EVALUATE EXHIBIT EXIT FREE GENERATE GO GOBACK IF INITIALIZE INITIALISE INITIATE INSPECT INVOKE JSON MERGE MOVE MULTIPLY
OPEN PERFORM PURGE RAISE READ READY RECEIVE RELEASE RESET RESUME RETURN REWRITE ROLLBACK SEARCH SEND SET SORT START STOP
STRING SUBTRACT SUPPRESS TERMINATE TRANSFORM UNLOCK UNSTRING VALIDATE WRITE XML`.split(/\s+/));
export const NOT_LABELS = new Set(['EXIT', 'GOBACK', 'CONTINUE', 'DECLARATIVES', 'STOP', 'ELSE', 'NEXT', 'END']);
const STATEMENT_BREAKS = new Set(['ELSE', 'WHEN', 'THEN']);
export const SCOPE_TERMINATORS = new Set(`END-ACCEPT END-ADD END-CALL END-CHAIN END-COMPUTE END-DELETE END-DISPLAY END-DIVIDE
END-EVALUATE END-EXEC END-IF END-JSON END-MULTIPLY END-OF-PAGE END-PERFORM END-READ END-RECEIVE END-RETURN END-REWRITE
END-SEARCH END-SEND END-START END-STRING END-SUBTRACT END-UNSTRING END-WRITE END-XML END-INVOKE END-SET`.split(/\s+/));
const USAGE_WORDS = new Set(`BINARY BINARY-CHAR BINARY-SHORT BINARY-LONG BINARY-DOUBLE BINARY-C-LONG COMP COMPUTATIONAL
COMP-1 COMP-2 COMP-3 COMP-4 COMP-5 COMP-6 COMP-X COMP-N COMPUTATIONAL-1 COMPUTATIONAL-2 COMPUTATIONAL-3 COMPUTATIONAL-4
COMPUTATIONAL-5 COMPUTATIONAL-6 COMPUTATIONAL-X COMPUTATIONAL-N DISPLAY FLOAT-SHORT FLOAT-LONG FLOAT-DECIMAL-16
FLOAT-DECIMAL-34 INDEX NATIONAL PACKED-DECIMAL POINTER PROGRAM-POINTER FUNCTION-POINTER SIGNED-SHORT SIGNED-INT
SIGNED-LONG UNSIGNED-SHORT UNSIGNED-INT UNSIGNED-LONG BINARY-INT BINARY-LONG-LONG PROCEDURE-POINTER`.split(/\s+/));
const DATA_CLAUSE_WORDS = new Set([...USAGE_WORDS, 'PIC', 'PICTURE', 'USAGE', 'OCCURS', 'REDEFINES', 'VALUE', 'VALUES',
  'SIGN', 'LEADING', 'TRAILING', 'SYNC', 'SYNCHRONIZED', 'JUST', 'JUSTIFIED', 'BLANK', 'EXTERNAL', 'GLOBAL', 'BASED',
  'RENAMES', 'TYPEDEF', 'LIKE', 'CONSTANT', 'IS', 'FILLER']);
// The clauses of a report group description, so an entry that opens with one is a FILLER.
const REPORT_CLAUSE_WORDS = new Set(`TYPE LINE LINES COLUMN COLUMNS COL COLS SOURCE SUM VALUE VALUES GROUP INDICATE NEXT PRESENT
ABSENT JUST JUSTIFIED BLANK RESET UPON OCCURS VARYING SIGN USAGE PIC PICTURE`.split(/\s+/));
const SCREEN_CLAUSE_WORDS = new Set(`LINE COL COLUMN BLANK BELL BEEP BLINK HIGHLIGHT LOWLIGHT REVERSE-VIDEO REVERSE UNDERLINE
FOREGROUND-COLOR BACKGROUND-COLOR FOREGROUND-COLOUR BACKGROUND-COLOUR FROM TO USING AUTO AUTO-SKIP SECURE NO-ECHO REQUIRED
FULL PROMPT ERASE EOL EOS NUMBER PLUS MINUS SIZE LEFTLINE OVERLINE GRID UPPER LOWER SCROLL TIME-OUT CONTROL`.split(/\s+/));

export function expandTabs(line, width = 8) {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(width - (out.length % width)) : ch;
  return out;
}

export function detectFormat(src) {
  let nonblank = 0, badIndicator = 0, fixedMarkers = 0, starCol1Bad = 0, codeCol2to7 = 0, seqDigits = 0;
  for (const raw of src.split(/\r?\n/, 600)) {
    const l = expandTabs(raw);
    if (!l.trim()) continue;
    nonblank++;
    if (/^\*(?!>)/.test(l) && l.length >= 7 && !FIXED_INDICATORS.has(l[6])) starCol1Bad++;
    if (/^ {1,6}[^\s*]/.test(l)) codeCol2to7++;
    if (/^\d{6}/.test(l)) seqDigits++;
    if (/^(IDENTIFICATION|ID|PROCEDURE|DATA|ENVIRONMENT)\s+DIVISION/i.test(l) || /^(WORKING-STORAGE|LINKAGE|FILE|LOCAL-STORAGE)\s+SECTION/i.test(l)) return 'free';
    if (l.length >= 7 && !FIXED_INDICATORS.has(l[6])) badIndicator++;
    if (/^\d{6}/.test(l) || /^.{6}[*\/]/.test(l)) fixedMarkers++;
  }
  if (!nonblank) return 'fixed';
  if (starCol1Bad > 0 && codeCol2to7 > 0 && seqDigits === 0) return 'terminal';
  if (badIndicator / nonblank > 0.1 && badIndicator > fixedMarkers) return 'free';
  return seqDigits === 0 && codePastColumn72(src) ? 'free' : 'fixed';
}

// Code a fixed-form reading would cut off at column 72, in a program written for -free: a literal
// still open there that the next line does not continue, a token running across the boundary, or a
// line past 80 whose code does not end its sentence by 72. An inline comment, a comment entry and a
// lone tag of up to eight characters are what fixed-form programs keep there. Of the 54,487 programs
// cobc compiled in a 3,184-repository corpus, 54,154 are then read in a format cobc accepts.
function codePastColumn72(src) {
  const lines = src.split(/\r?\n/, 2001);
  for (let i = 0; i < Math.min(lines.length, 2000); i++) {
    const l = expandTabs(lines[i]).replace(/\s+$/, '');
    if (l.length <= 72 || l[6] === '*' || l[6] === '/' || /^\s*\*>/.test(l) || COMMENT_ENTRY.test(l.slice(7))) continue;
    const { quote, comment } = stateAtColumn72(l);
    if (comment) continue;
    if (quote && expandTabs(lines[i + 1] || '')[6] !== '-') return true;
    const tag = /^\S{1,8}$/.test(l.slice(72).trim());
    if (/\S/.test(l[71]) && /\S/.test(l[72]) && !tag) return true;
    const code = l.slice(7, 72).trim();
    if (l.length > 80 && !tag && code && !code.endsWith('.')) return true;
  }
  return false;
}

function stateAtColumn72(l) {
  let quote = null;
  for (let i = 7; i < 72 && i < l.length; i++) {
    const c = l[i];
    if (quote) { if (c === quote) { if (l[i + 1] === quote) i++; else quote = null; } }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '*' && l[i + 1] === '>') return { quote: null, comment: true };
  }
  return { quote, comment: false };
}

function scanQuotes(text, open) {
  let q = open;
  let closedLast = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === q) { if (text[i + 1] === q) i++; else { if (i === text.length - 1) closedLast = q; q = null; } }
    } else if (c === '"' || c === "'") q = c;
    else if (c === '*' && text[i + 1] === '>') return { text: text.slice(0, i), open: null };
  }
  return { text, open: q, closedLast };
}

const PREDEFINED = new Map([['P64', 'SET']]);

function defineDirective(directive, defines) {
  const body = directive.replace(/\*>.*$/, '').replace(/^>>\s*DEFINE\s+/i, '').trim();
  const m = body.match(/^(?:CONSTANT\s+)?([A-Za-z0-9_-]+)\s+(?:AS\s+)?(.*?)\s*(OVERRIDE)?\s*$/i);
  if (!m) return;
  const name = m[1].toUpperCase();
  const raw = m[2].trim();
  if (/^(OFF|PARAMETER)$/i.test(raw)) { if (/^OFF$/i.test(raw)) defines.delete(name); return; }
  const value = raw.replace(/^(['"])(.*)\1$/, '$2');
  if (m[3] || !defines.has(name)) defines.set(name, value);
}

// $SET and >>SET: the source format it names, and with CONSTANT a name the source may use as a value.
function setDirective(text, defines) {
  const c = /\bCONSTANT\s+([A-Za-z0-9_-]+)\s+(?:(["'])(.*?)\2|(\S+))/i.exec(text);
  if (c && defines) defines.set(c[1].toUpperCase(), c[3] !== undefined ? c[3] : c[4]);
  const m = text.match(/SOURCEFORMAT\s*\(?\s*["']?(FREE|FIXED|VARIABLE)/i);
  return m ? m[1].toLowerCase() : null;
}

function evaluateCondition(text, defines) {
  const t = text.replace(/\*>.*$/, '').trim();
  const known = (n) => (defines && defines.has(n)) || PREDEFINED.has(n);
  const valueOf = (n) => (defines && defines.has(n) ? defines.get(n) : PREDEFINED.get(n));
  let m = t.match(/^([A-Za-z0-9_-]+)\s+(?:IS\s+)?(NOT\s+)?(DEFINED|SET)$/i);
  if (m) { const r = known(m[1].toUpperCase()); return m[2] ? !r : r; }
  m = t.match(/^([A-Za-z0-9_-]+)\s*(<=|>=|<>|=|<|>)\s*(['"]?)([^'"]*)\3$/);
  if (m) {
    const name = m[1].toUpperCase();
    if (!known(name)) return null;
    const left = valueOf(name);
    const right = m[4];
    const numeric = /^-?\d+(\.\d+)?$/.test(left) && /^-?\d+(\.\d+)?$/.test(right);
    const [x, y] = numeric ? [Number(left), Number(right)] : [String(left), String(right)];
    switch (m[2]) { case '<': return x < y; case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y; case '=': return x === y; default: return x !== y; }
  }
  return null;
}

export function normalize(src, format, defines, std) {
  // Micro Focus reads a free-form line with * or / in column 1 as a comment, as cobc -std=mf does.
  const columnOneComments = std === 'mf' || std === 'mf-strict';
  const phys = src.split(/\r?\n/);
  const entries = [];
  const diags = [];
  let fmt = format;
  let last = null;
  let seenCode = false;
  const condStack = [];
  let openLiteralLines = 0;
  const options = [];
  let identification = false;
  let commentEntry = false;
  for (let i = 0; i < phys.length; i++) {
    const line = i + 1;
    const l = expandTabs(phys[i].replace(/\x1a/g, ''));
    const entry = { line, text: '', fmt };
    entries.push(entry);
    const trimmed = l.trim();
    if (!trimmed) continue;
    // A directive may follow a sequence area in fixed or variable format ("GC0712 >>IF ...").
    const afterSequence = fmt !== 'free' && fmt !== 'terminal' && l.length > 7 ? l.slice(6).trim() : '';
    const directive = trimmed.startsWith('>>') ? trimmed : afterSequence.startsWith('>>') ? afterSequence : null;
    if (directive) {
      const skipping = condStack.some(f => f.state !== 'taking');
      const m = directive.match(/^>>\s*SOURCE\s+(?:FORMAT\s+)?(?:IS\s+)?(FREE|FIXED|VARIABLE|TERMINAL)/i);
      if (m) { if (!skipping) fmt = m[1].toLowerCase(); }
      else if (/^>>\s*DEFINE\b/i.test(directive)) {
        if (!skipping && defines) defineDirective(directive, defines);
      }
      else if (/^>>\s*IF\b/i.test(directive)) {
        if (skipping) condStack.push({ state: 'done' });
        else {
          const v = evaluateCondition(directive.replace(/^>>\s*IF\s+/i, ''), defines);
          // Unknown conditions keep the first branch: a compiler keeps exactly one, and the first
          // is the configuration the source was written for more often than not.
          condStack.push({ state: v === false ? 'waiting' : 'taking' });
        }
      }
      else if (/^>>\s*ELIF\b|^>>\s*ELSE\s+IF\b/i.test(directive)) {
        const f = condStack[condStack.length - 1];
        if (f) {
          if (f.state === 'taking' || f.state === 'done') f.state = 'done';
          else {
            const v = evaluateCondition(directive.replace(/^>>\s*(?:ELIF|ELSE\s+IF)\s+/i, ''), defines);
            f.state = v === false ? 'waiting' : 'taking';
          }
        }
      }
      else if (/^>>\s*ELSE\b/i.test(directive)) {
        const f = condStack[condStack.length - 1];
        if (f) f.state = f.state === 'waiting' ? 'taking' : 'done';
      }
      else if (/^>>\s*END-IF\b/i.test(directive)) condStack.pop();
      else if (/^>>\s*SET\b/i.test(directive) && !skipping) fmt = setDirective(directive, defines) || fmt;
      continue;
    }
    entry.fmt = fmt;
    // Micro Focus directives: $IF, $ELSE and $END select source as >>IF does, and $SET sets the
    // source format or, with CONSTANT, a name the source may use as a value.
    const dollar = trimmed.startsWith('$') ? trimmed : fmt !== 'free' && fmt !== 'terminal' && l[6] === '$' ? l.slice(6).trim() : null;
    if (dollar) {
      const skipping = condStack.some(f => f.state !== 'taking');
      if (/^\$\s*IF\b/i.test(dollar)) {
        if (skipping) condStack.push({ state: 'done' });
        else condStack.push({ state: evaluateCondition(dollar.replace(/^\$\s*IF\s+/i, ''), defines) === false ? 'waiting' : 'taking' });
      } else if (/^\$\s*ELSE\b/i.test(dollar)) {
        const f = condStack[condStack.length - 1];
        if (f) f.state = f.state === 'waiting' ? 'taking' : 'done';
      } else if (/^\$\s*END\b/i.test(dollar)) condStack.pop();
      else if (!skipping && /^\$\s*SET\b/i.test(dollar)) fmt = setDirective(dollar, defines) || fmt;
      continue;
    }
    if (condStack.some(f => f.state !== 'taking')) continue;
    // Compiler options the source sets for itself. The card is not code, but what it says about how
    // the program is compiled is kept: SSRANGE decides whether a bad subscript overwrites or abends.
    if (!seenCode && (/^(CBL|PROCESS)\b/i.test(trimmed) || /^(CBL|PROCESS)\b/i.test(l.slice(7).trim()))) {
      const card = /^(CBL|PROCESS)\b/i.test(trimmed) ? trimmed : l.slice(7).trim();
      options.push(...optionTokens(card.replace(/^(CBL|PROCESS)\b/i, '')));
      continue;
    }
    let indicator = ' ';
    let text;
    let width;
    if (fmt === 'free') {
      text = l;
      width = l.length;
    } else if (fmt === 'terminal') {
      indicator = l[0];
      const isIndicator = indicator === ' ' || indicator === '*' || indicator === '/' || (indicator === '-' && l[1] === ' ') || ((indicator === 'D' || indicator === 'd') && l[1] === ' ');
      if (!isIndicator) { indicator = ' '; text = l.slice(0, 320); } else text = l.slice(1, 320);
      width = 319;
    } else {
      if (l.length < 7) continue;
      indicator = l[6];
      width = fmt === 'variable' ? 243 : 65;
      text = l.slice(7, 7 + width);
      if (!FIXED_INDICATORS.has(indicator)) { diags.push({ kind: 'invalid-indicator', line }); indicator = ' '; }
    }
    if (indicator === '*' || indicator === '/' || indicator === 'D' || indicator === 'd') continue;
    if (fmt === 'free' && (/^\s*\*>/.test(text) || (columnOneComments && /^[*/]/.test(text)))) continue;
    // AUTHOR, INSTALLATION, DATE-WRITTEN, DATE-COMPILED, SECURITY and REMARKS take a comment-entry:
    // any text, a COPY or an apostrophe included. It runs to the end of the header's line, and in
    // fixed form on through every line with Area A blank, as GnuCOBOL reads it.
    if (commentEntry) {
      if (!text.slice(0, 4).trim()) continue;
      commentEntry = false;
    }
    if (/^\s*(IDENTIFICATION|ID)\s+DIVISION\b/i.test(text)) identification = true;
    else if (/^\s*(ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION\b/i.test(text)) identification = false;
    const entryHeader = identification && COMMENT_ENTRY.exec(text);
    if (entryHeader) {
      text = entryHeader[0].padEnd(text.length, ' ');
      commentEntry = fmt !== 'free';
    }
    // Free format carries an unterminated literal onto the next line, with or without a leading
    // hyphen. Bounded, so a literal that is unterminated by mistake cannot swallow the file.
    if (fmt === 'free' && last && last.open && openLiteralLines < 5) {
      let t = text.replace(/^\s*-\s*/, '');
      if (/^\s*-/.test(text) && (t[0] === '"' || t[0] === "'")) t = t.slice(1);
      const cont = scanQuotes(t, last.open);
      last.entry.text += cont.text;
      last.open = cont.open;
      openLiteralLines = cont.open ? openLiteralLines + 1 : 0;
      continue;
    }
    if (indicator === '-' && last) {
      // A literal that closes in the last column, continued by a line opening with its quote, was
      // not closed: the two quotes are one quote written across the break.
      const lead = text.replace(/^\s+/, '');
      if (!last.open && last.closedLast && last.full && lead[0] === last.closedLast) {
        const s = scanQuotes(last.closedLast + lead.slice(1), last.closedLast);
        last.entry.text += s.text.slice(1);
        last.open = s.open;
        last.closedLast = s.closedLast;
        continue;
      }
      if (last.open) {
        let t = text.replace(/^\s+/, '');
        if (t[0] === '"' || t[0] === "'") t = t.slice(1);
        const s = scanQuotes(t, last.open);
        last.entry.text = last.entry.text.padEnd(last.width, ' ') + s.text;
        last.open = s.open;
        last.closedLast = s.closedLast;
      } else {
        const s = scanQuotes(text.replace(/^\s+/, ''), null);
        last.entry.text = last.entry.text.trimEnd() + s.text;
        last.open = s.open;
        last.closedLast = s.closedLast;
      }
      last.full = text.length === width;
      continue;
    }
    const s = scanQuotes(text, null);
    entry.text = s.text;
    if (s.text.trim()) { seenCode = true; last = { entry, open: s.open, width, closedLast: s.closedLast, full: text.length === width }; openLiteralLines = s.open ? 1 : 0; }
  }
  return { entries, diags, finalFormat: fmt, options };
}

function tok(t, v, line, file, extra) { return { t, v, u: t === 'word' ? v.toUpperCase() : v, line, file, ...extra }; }

// A floating-point literal's exponent: 1.5E3, 2.5E-2, +1.0E+05. Only after a mantissa with a
// decimal point, since 1E3 is a word a program may declare.
function exponentAt(s, j) {
  const m = /^[Ee][+-]?\d{1,3}(?![A-Za-z0-9_$#@-])/.exec(s.slice(j, j + 6));
  return m ? m[0].length : 0;
}

export function tokenize(norm, file) {
  const out = [];
  const diags = [];
  let exec = null;
  const emit = (tk) => {
    if (exec) {
      if (tk.t === 'word' && tk.u === 'END-EXEC') { out.push(exec); exec = null; return; }
      exec.toks.push(tk);
      return;
    }
    if (tk.t === 'word' && EXEC_KINDS.has(tk.u)) {
      const prev = out[out.length - 1];
      if (prev && prev.t === 'word' && (prev.u === 'EXEC' || prev.u === 'EXECUTE')) {
        out.pop();
        exec = tok('exec', tk.u, prev.line, file, { kind: tk.u, toks: [] });
        return;
      }
    }
    out.push(tk);
  };
  let picPending = false;
  for (const { line, text: s } of norm.entries) {
    let i = 0;
    const n = s.length;
    while (i < n) {
      const c = s[i];
      if (c === ' ' || c === '\t' || c === '\f' || c === '\r') { i++; continue; }
      if (exec && exec.kind === 'SQL' && c === '-' && s[i + 1] === '-') break;
      if (picPending) {
        let j = i;
        while (j < n && s[j] !== ' ') j++;
        let pic = s.slice(i, j);
        if (pic.toUpperCase() === 'IS') { emit(tok('word', pic, line, file)); i = j; continue; }
        let trailingPeriod = false;
        if (/[.,;]$/.test(pic) && pic.length > 1) { trailingPeriod = pic.endsWith('.'); pic = pic.slice(0, -1); }
        emit(tok('pic', pic, line, file));
        if (trailingPeriod) emit(tok('period', '.', line, file));
        picPending = false;
        i = j;
        continue;
      }
      // A separator comma or semicolon, with or without the space the standard asks for after it:
      // C(I,J) and USING A,B compile, and a comma inside a number was read with the number above.
      if (c === ',' || c === ';') { i++; continue; }
      if (c === '=' && s[i + 1] === '=') { emit(tok('pseudo', '==', line, file)); i += 2; continue; }
      const prefixed = /^(?:NX|NC|BX|[XxNnZzGgBbUuHh]|nx|nc|bx)(?=["'])/.exec(s.slice(i, i + 3));
      if (c === '"' || c === "'" || prefixed) {
        const start = prefixed ? i + prefixed[0].length : i;
        const q = s[start];
        let j = start + 1, v = '';
        let closed = false;
        while (j < n) {
          if (s[j] === q) { if (s[j + 1] === q) { v += q; j += 2; continue; } closed = true; j++; break; }
          v += s[j++];
        }
        if (!closed) diags.push({ kind: 'unterminated-literal', line, file });
        emit(tok('lit', v, line, file, { prefix: prefixed ? prefixed[0].toUpperCase() : '' }));
        i = j;
        continue;
      }
      if (c === '.') {
        if (i + 1 >= n || s[i + 1] === ' ') { emit(tok('period', '.', line, file)); i++; continue; }
        if (/[0-9]/.test(s[i + 1] || '')) {
          let j = i + 1; while (j < n && /[0-9]/.test(s[j])) j++;
          j += exponentAt(s, j);
          emit(tok('num', s.slice(i, j), line, file)); i = j; continue;
        }
        // Not a separator: a separator period is followed by a space or the end of the line.
        emit(tok('period', '.', line, file, { joined: /[A-Za-z0-9_$#@-]/.test(s[i + 1]) })); i++; continue;
      }
      if (/[A-Za-z0-9_$#@\u0080-\u00ff]/.test(c)) {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_\-$#@\u0080-\u00ff]/.test(s[j])) j++;
        let v = s.slice(i, j);
        if (/^\d+$/.test(v) && (s[j] === '.' || s[j] === ',') && /[0-9]/.test(s[j + 1] || '')) {
          let k = j + 1; while (k < n && /[0-9]/.test(s[k])) k++;
          k += exponentAt(s, k);
          v = s.slice(i, k); j = k;
          emit(tok('num', v, line, file));
        } else {
          emit(tok('word', v, line, file, i < 4 ? { areaA: true } : undefined));
          const u = v.toUpperCase();
          if ((u === 'PIC' || u === 'PICTURE') && !exec) picPending = true;
        }
        i = j;
        continue;
      }
      const two = s.slice(i, i + 2);
      if (two === '**' || two === '>=' || two === '<=' || two === '<>') { emit(tok('op', two, line, file)); i += 2; continue; }
      if ('()'.includes(c)) { emit(tok('sep', c, line, file)); i++; continue; }
      if (':+-*/=<>&'.includes(c)) { emit(tok('op', c, line, file)); i++; continue; }
      diags.push({ kind: 'unexpected-char', line, file });
      i++;
    }
  }
  if (exec) { diags.push({ kind: 'unterminated-exec', line: exec.line, file }); out.push(exec); }
  for (const tk of out) { const e = norm.entries[tk.line - 1]; if (e) tk.fmt = e.fmt; }
  return { tokens: out, diags };
}

// Every rule set walks the tree through here. A directory it may not read is recorded, not treated
// as empty: only ENOENT means absent. Symlinks are followed while they stay inside the tree, so a
// symlinked copy library is read; one pointing outside is counted and never followed, because a
// scan reads the tree it was given and nothing else.
export function buildFileIndex(root) {
  const index = new Map();
  const dirs = new Set();
  const unreadableDirs = [];
  const symlinks = { followed: 0, outside: 0, broken: 0 };
  let top;
  try { top = realpathSync(root); } catch (e) { if (e.code === 'ENOENT') return { index, copyDirs: [], unreadableDirs, symlinks }; throw e; }
  const inside = (p) => p === top || p.startsWith(top + sep);
  const visited = new Set();
  const addFile = (p, name, d) => { index.set(p.toLowerCase(), p); if (/\.(cpy|copy|inc|cbl|cob)$/i.test(name)) dirs.add(d); };
  // Each real directory is walked once, however many links lead to it, or its programs count twice.
  const walk = (d, real) => {
    if (visited.has(real)) return;
    visited.add(real);
    let es;
    try { es = readdirSync(d, { withFileTypes: true }); } catch (e) {
      if (e.code === 'ENOENT') return;
      if (e.code === 'EACCES' || e.code === 'EPERM') { unreadableDirs.push(d); return; }
      throw e;
    }
    for (const e of es.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (e.name === '.git' || e.name.startsWith('._')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, join(real, e.name));
      else if (e.isFile()) addFile(p, e.name, d);
      else if (e.isSymbolicLink()) {
        let target;
        let st;
        try { target = realpathSync(p); st = statSync(target); } catch { symlinks.broken++; continue; }
        if (!inside(target)) { symlinks.outside++; continue; }
        symlinks.followed++;
        if (st.isDirectory()) walk(p, target);
        else if (st.isFile()) addFile(p, e.name, d);
      }
    }
  };
  walk(root, top);
  index.root = root;
  return { index, copyDirs: [...dirs].sort(), unreadableDirs, symlinks };
}

function readOperand(tokens, j) {
  const t = tokens[j];
  if (!t) return [null, j];
  if (t.t === 'pseudo') {
    const toks = [];
    let k = j + 1;
    while (k < tokens.length && tokens[k].t !== 'pseudo') toks.push(tokens[k++]);
    return [{ pseudo: true, toks }, k + 1];
  }
  if (t.t === 'lit' || t.t === 'num' || t.t === 'pic') return [{ pseudo: false, toks: [t] }, j + 1];
  if (t.t !== 'word') return [null, j];
  // An identifier operand keeps its qualifiers and subscripts: VAR BY IN-A IN INPUT-REC.
  const toks = [t];
  let k = j + 1;
  while (tokens[k] && tokens[k].t === 'word' && (tokens[k].u === 'IN' || tokens[k].u === 'OF') && tokens[k + 1] && tokens[k + 1].t === 'word') toks.push(tokens[k++], tokens[k++]);
  if (tokens[k] && tokens[k].t === 'sep' && tokens[k].v === '(') {
    let depth = 0, e = k;
    for (; e < tokens.length && tokens[e].t !== 'period' && tokens[e].t !== 'pseudo'; e++) {
      if (tokens[e].t === 'sep') depth += tokens[e].v === '(' ? 1 : -1;
      if (depth === 0) break;
    }
    if (depth === 0 && e < tokens.length) { toks.push(...tokens.slice(k, e + 1)); k = e + 1; }
  }
  return [{ pseudo: false, toks }, k];
}

function sameToken(a, b) {
  if (a.t === 'word' || b.t === 'word') return a.t === b.t && a.u === b.u;
  return a.t === b.t && a.v === b.v;
}

function readReplacingPairs(tokens, j) {
  const pairs = [];
  while (j < tokens.length && tokens[j].t !== 'period') {
    let mode = null;
    if (tokens[j].t === 'word' && (tokens[j].u === 'LEADING' || tokens[j].u === 'TRAILING')) { mode = tokens[j].u; j++; }
    if (tokens[j] && tokens[j].t === 'word' && tokens[j].u === 'ALSO') { j++; continue; }
    const [from, j2] = readOperand(tokens, j);
    if (!from || !tokens[j2] || tokens[j2].u !== 'BY') break;
    const [to, j3] = readOperand(tokens, j2 + 1);
    if (!to) break;
    pairs.push({ mode, from, to });
    j = j3;
  }
  return [pairs, j];
}

// A COPY's REPLACING reaches the text of the copybooks nested in it, except what their own REPLACING
// produced: cobc names `05 PFX-ID` AA-TWO-ID under COPY LEAF REPLACING LEADING ==PFX== BY ==AA-TWO==
// inside a COPY REPLACING LEADING ==AA== BY ==XX==. A REPLACE statement still sees that text.
function applyReplacing(tokens, pairs, maxGrowth = Infinity, byCopy = false) {
  if (!pairs.length) return tokens;
  let grown = 0;
  const out = [];
  for (let i = 0; i < tokens.length;) {
    if (byCopy && tokens[i].copyReplaced) { out.push(tokens[i++]); continue; }
    let hit = false;
    for (const p of pairs) {
      if (p.mode || p.partial) continue;
      const f = p.from.toks;
      if (!f.length || i + f.length > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < f.length; k++) if (!sameToken(tokens[i + k], f[k]) || (byCopy && tokens[i + k].copyReplaced)) { ok = false; break; }
      if (ok) {
        grown += p.to.toks.length - f.length;
        if (grown > maxGrowth) return null;
        for (const r of p.to.toks) out.push({ ...r, line: tokens[i].line, file: tokens[i].file, ...(byCopy ? { copyReplaced: true } : {}) });
        i += f.length;
        hit = true;
        break;
      }
    }
    if (hit) continue;
    const was = tokens[i];
    let tk = was;
    if (tk.t === 'pic') {
      // Parentheses delimit text words, so a pattern word inside X(NAME) is replaced like any other.
      for (const p of pairs) {
        if (p.mode || p.partial || p.from.toks.length !== 1 || p.to.toks.length > 1) continue;
        const pat = p.from.toks[0].v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rep = p.to.toks[0] ? p.to.toks[0].v : '';
        const v = tk.v.replace(new RegExp(`\\(${pat}\\)`, 'gi'), `(${rep})`);
        if (v !== tk.v) tk = { ...tk, v, u: v };
      }
    }
    if (tk.t === 'word') {
      for (const p of pairs) {
        if (!p.mode || !p.from.toks[0]) continue;
        const pat = p.from.toks[0].u;
        const rep = p.to.toks[0] ? p.to.toks[0].v : '';
        if (p.mode === 'LEADING' && tk.u.startsWith(pat)) { const v = rep + tk.v.slice(pat.length); tk = { ...tk, v, u: v.toUpperCase() }; break; }
        if (p.mode === 'TRAILING' && tk.u.endsWith(pat)) { const v = tk.v.slice(0, tk.v.length - pat.length) + rep; tk = { ...tk, v, u: v.toUpperCase() }; break; }
      }
    }
    out.push(byCopy && tk !== was ? { ...tk, copyReplaced: true } : tk);
    i++;
  }
  return out;
}

// A COPY resolves inside the tree through the index, which IS the tree, or in a declared library
// outside it (the system copybooks, COBCPY, COBOLWORK_COPYPATH), which may be read from disk. A
// name that is absolute, or that climbs out of the directory it was joined to, never reaches the
// filesystem: `COPY "/etc/hosts"` resolved before this, and a scan reads the tree it was given.
export function copyRefusal(name, ctx = {}) {
  if (isAbsolute(name)) return ctx.allowAbsoluteCopy ? null : 'refused-absolute';
  // A relative name may climb to a sibling directory (`../copybooks/X.cpy` is ordinary); what it may
  // not do is leave the tree. Without an index there is no tree to leave.
  const root = ctx.fileIndex && ctx.fileIndex.root;
  if (!root || !ctx.mainDir) return null;
  const p = resolve(ctx.mainDir, name);
  const top = resolve(root);
  return p === top || p.startsWith(top + sep) ? null : 'refused-outside';
}

// Files in the tree by lower-case file name, built once per index. A COPY of a plain name looks its
// candidates up here and takes the one in the highest-priority directory, instead of trying every
// directory in turn — which is what made callers cap the include list at 120 directories and
// report the copybooks beyond it as missing.
const byNameCache = new WeakMap();
function filesByName(index) {
  let m = byNameCache.get(index);
  if (!m) {
    m = new Map();
    for (const p of index.values()) { const k = basename(p).toLowerCase(); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
    byNameCache.set(index, m);
  }
  return m;
}

// A build's copy library holds copybooks, not programs, so a COPY prefers a file that is not itself a
// program: IBM's Bank of Z keeps the program INQACCCU.cbl beside BNK1CCA.cbl and the copybook of the
// same name in cics/copy, and cobc run from the source's directory pastes the program in. Only a
// name a program could carry is read to find out. A COPY with nothing else to take still takes the
// program, as cobc does - that is how a nested program is copied in - so a program cobc compiles
// resolves as it did.
const PROGRAM_EXT = /\.(cbl|cob)$|^[^.]*$/i;
const DIVISION_WORDS = new Set(['IDENTIFICATION', 'ID', 'ENVIRONMENT', 'DATA', 'PROCEDURE']);
function isProgramFile(p, ctx) {
  if (!PROGRAM_EXT.test(basename(p))) return false;
  const seen = (ctx.programFiles ||= new Map());
  if (!seen.has(p)) {
    let text = '';
    try { text = readSource(p).text; } catch { /* an unreadable candidate is not known to be a program */ }
    seen.set(p, /^[^*\n]{0,6}\s*PROGRAM-ID\s*\./im.test(text));
  }
  return seen.get(p);
}

function resolveInTree(name, ctx) {
  const byName = filesByName(ctx.fileIndex);
  if (!ctx.dirRank) {
    ctx.dirRank = new Map();
    [ctx.mainDir, ...ctx.includeDirs].forEach((d, i) => { const k = resolve(d).toLowerCase(); if (!ctx.dirRank.has(k)) ctx.dirRank.set(k, i); });
  }
  const hits = [];
  COPY_EXTS.forEach((ext, e) => {
    for (const p of byName.get((name + ext).toLowerCase()) || []) {
      const d = ctx.dirRank.get(dirname(p).toLowerCase());
      if (d !== undefined) hits.push({ p, rank: d * COPY_EXTS.length + e });
    }
  });
  // In a data division nothing can be a program: a tree that holds the program and not the copybook
  // of its name (IBM's CICS Bank Sample, flattened into one directory) is missing the copybook.
  const inData = ctx.division === 'DATA';
  if (!inData && hits.length < 2) return hits.length ? hits[0].p : null;
  hits.sort((a, b) => a.rank - b.rank);
  const copybook = hits.find((h) => !isProgramFile(h.p, ctx));
  if (copybook) return copybook.p;
  return inData || !hits.length ? null : hits[0].p;
}

function resolveCopy(name, lib, ctx) {
  if (copyRefusal(name, ctx)) return null;
  if (ctx.fileIndex && !lib && !/[\\/]/.test(name)) {
    const hit = resolveInTree(name, ctx);
    if (hit) return hit;
    return resolveDeclared(name, lib, ctx);
  }
  return resolveByDirs(name, lib, ctx, true);
}

function resolveDeclared(name, lib, ctx) {
  return resolveByDirs(name, lib, ctx, false);
}

// The extensions under which some file in the index carries this name's last segment. A tree
// candidate hits only a path the index holds, so any other extension cannot hit in any directory.
// null when the segment is one join and resolve would rewrite.
function indexedExts(name, index) {
  const byName = filesByName(index);
  const out = new Set();
  for (const ext of COPY_EXTS) {
    const leaf = basename(name + ext);
    if (!leaf || leaf === '.' || leaf === '..') return null;
    if (byName.has(leaf.toLowerCase())) out.add(ext);
  }
  return out;
}

function resolveByDirs(name, lib, ctx, withTree) {
  // Read at call time, so a caller that sets the variable after importing this module is honoured.
  const envDirs = (process.env.COBOLWORK_COPYPATH || process.env.COBCPY || '').split(delimiter).filter(Boolean);
  const treeExts = withTree && ctx.fileIndex && !isAbsolute(name) ? indexedExts(name, ctx.fileIndex) : null;
  const candidates = [];
  if (isAbsolute(name)) candidates.push({ base: name, dir: null, declared: true });
  else {
    const lists = [[[...ctx.systemDirs, ...envDirs], true]];
    if (withTree && (!treeExts || treeExts.size)) lists.unshift([[ctx.mainDir, ...ctx.includeDirs], false]);
    for (const [list, declared] of lists) {
      for (const d of list) for (const b of (lib ? [join(d, lib, name), join(d, name)] : [join(d, name)])) candidates.push({ base: b, dir: resolve(d), declared });
    }
  }
  const home = ctx.mainDir && resolve(ctx.mainDir);
  const inData = ctx.division === 'DATA';
  let program = null;
  for (const c of candidates) for (const ext of COPY_EXTS) {
    if (treeExts && !c.declared && !treeExts.has(ext)) continue;
    const p = resolve(c.base + ext);
    // Inside the tree the index is the confinement: only a file it holds can be a hit. A declared
    // library outside the tree is confined to itself.
    if (c.declared && c.dir && p !== c.dir && !p.startsWith(c.dir + sep)) continue;
    let hit = null;
    if (ctx.cache.has(p)) hit = ctx.cache.get(p);
    else {
      if (ctx.fileIndex && !c.declared) hit = ctx.fileIndex.get(p.toLowerCase()) || null;
      else {
        try { if (statSync(p).isFile()) hit = p; } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e; }
      }
      ctx.cache.set(p, hit);
    }
    if (!hit) continue;
    if (!c.declared && (c.dir === home || inData) && isProgramFile(hit, ctx)) { if (!inData) program ||= hit; continue; }
    return hit;
  }
  return program;
}

function expand(tokens, ctx, stack, format) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    // Where a COPY sits decides what it may take (resolveInTree); copybooks it brings in inherit it.
    if (tk.t === 'word' && tokens[i + 1] && tokens[i + 1].u === 'DIVISION' && DIVISION_WORDS.has(tk.u)) ctx.division = tk.u === 'ID' ? 'IDENTIFICATION' : tk.u;
    if (tk.t === 'exec' && tk.kind === 'SQL') {
      out.push(tk);
      const w = tk.toks;
      if (w[0] && w[0].u === 'INCLUDE' && w[1]) {
        const name = w[1].v;
        if (/^(SQLCA|SQLDA)$/i.test(name)) { ctx.copies.push({ name, via: 'sql-include', status: 'system', file: tk.file, line: tk.line }); continue; }
        for (const t of includeCopy(name, null, [], tk, 'sql-include', ctx, stack, format)) out.push(t);
      }
      continue;
    }
    // `INCLUDE member.` opening a sentence is a COPY to cobc, which pastes the member in.
    if (tk.t === 'word' && tk.u === 'INCLUDE' && (i === 0 || tokens[i - 1].t === 'period')
      && tokens[i + 1] && (tokens[i + 1].t === 'word' || tokens[i + 1].t === 'lit') && tokens[i + 2] && tokens[i + 2].t === 'period') {
      for (const t of includeCopy(tokens[i + 1].v, null, [], tk, 'include', ctx, stack, format)) out.push(t);
      i += 2;
      continue;
    }
    if (tk.t !== 'word' || tk.u !== 'COPY') { out.push(tk); continue; }
    let j = i + 1;
    const nameTok = tokens[j];
    if (!nameTok || (nameTok.t !== 'word' && nameTok.t !== 'lit')) { out.push(tk); continue; }
    j++;
    // `COPY CSS00100.cpy.` and `COPY WS.WS.` name the members CSS00100.cpy and WS.WS: a period with
    // text straight after it is part of the name, and only the one followed by a space ends the
    // statement. Without this the tail is left in the stream and reads as a paragraph named CPY.
    let name = nameTok.v;
    while (nameTok.t === 'word' && tokens[j] && tokens[j].t === 'period' && tokens[j].joined
      && tokens[j + 1] && tokens[j + 1].t === 'word' && tokens[j + 1].line === tokens[j].line) {
      name = `${name}.${tokens[j + 1].v}`;
      j += 2;
    }
    let lib = null;
    if (tokens[j] && tokens[j].t === 'word' && (tokens[j].u === 'OF' || tokens[j].u === 'IN') && tokens[j + 1]) { lib = tokens[j + 1].v; j += 2; }
    if (tokens[j] && tokens[j].u === 'SUPPRESS') { j++; if (tokens[j] && tokens[j].u === 'PRINTING') j++; }
    let pairs = [];
    if (tokens[j] && tokens[j].u === 'REPLACING') [pairs, j] = readReplacingPairs(tokens, j + 1);
    if (tokens[j] && tokens[j].t === 'period') j++;
    else ctx.diags.push({ kind: 'copy-without-period', file: tk.file, line: tk.line });
    i = j - 1;
    for (const t of includeCopy(name, lib, pairs, tk, 'copy', ctx, stack, format)) out.push(t);
  }
  return out;
}

function includeCopy(name, lib, pairs, at, via, ctx, stack, inheritedFormat) {
  const path = resolveCopy(name, lib, ctx);
  const refused = copyRefusal(name, ctx);
  const record = { name, lib, via, file: at.file, line: at.line, status: path ? 'resolved' : refused || (SYSTEM_COPY.test(name) ? 'system' : 'missing'), path };
  ctx.copies.push(record);
  if (!path) return [];
  if (stack.includes(path) || stack.length > 40) { record.status = 'recursive'; return []; }
  if (++ctx.inclusions > MAX_INCLUSIONS || ctx.copyTokens > MAX_COPY_TOKENS) { record.status = 'expansion-limit'; return []; }
  const src = readSource(path).text;
  // A copybook is read in the format in force where the COPY statement sits, which a >>SOURCE
  // directive earlier in the including file may have changed from the file's starting format.
  const fmt = detectFormat(src) === 'terminal' && ctx.copyFormat === 'auto' ? 'terminal' : (at.fmt || (ctx.copyFormat !== 'auto' ? ctx.copyFormat : (inheritedFormat || ctx.mainFormat)));
  const norm = normalize(src, fmt, ctx.defines, ctx.std);
  // A tag written against other text - :TAG:-FIELD, FS-(), 'X'-CLE - is replaced in the text, as the
  // compiler does, so the text around it joins the replacement into one word. A literal is taken as a
  // tag only where it touches a word; elsewhere it is replaced token for token like any operand.
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const partial = [];
  for (const p of pairs) {
    const f = p.from.toks;
    if (p.mode || !f.length) continue;
    const pat = f.map(t => t.v).join('');
    if (p.from.pseudo && /^[:(][A-Za-z0-9_-]*[:)]$/.test(pat)) { partial.push([p, new RegExp(escape(pat), 'gi')]); continue; }
    if (p.from.pseudo || f.length !== 1 || f[0].t !== 'lit') continue;
    const lit = `(['"])${escape(f[0].v)}\\1`;
    const touching = new RegExp(`${lit}(?=[A-Za-z0-9-])|(?<=[A-Za-z0-9-])${lit}`);
    if (norm.entries.some(e => touching.test(e.text))) partial.push([p, new RegExp(lit, 'g')]);
  }
  if (partial.length) {
    for (const e of norm.entries) {
      for (const [p, re] of partial) {
        const rep = p.to.toks.map(t => (t.t === 'lit' ? `'${t.v}'` : t.v)).join(' ');
        let hits = 0;
        const text = e.text.replace(re, () => { hits++; return rep; });
        ctx.replacedChars += Math.max(0, hits * (rep.length - p.from.toks.map(t => t.v).join('').length));
        if (ctx.replacedChars > MAX_REPLACED_CHARS) { record.status = 'expansion-limit'; return []; }
        e.text = text;
      }
    }
    for (const [p] of partial) p.partial = true;
  }
  const { tokens, diags } = tokenize(norm, path);
  ctx.copyTokens += tokens.length;
  ctx.diags.push(...diags, ...norm.diags.map(d => ({ ...d, file: path })));
  const expanded = expand(tokens, ctx, [...stack, path], norm.finalFormat);
  const out = applyReplacing(expanded, pairs, MAX_REPLACED_GROWTH - ctx.replacedGrowth, true);
  if (!out) { record.status = 'expansion-limit'; return []; }
  ctx.replacedGrowth += out.length - expanded.length;
  return out;
}

// A REPLACE governs the source up to the next one, which replaces it unless ALSO; OFF ends it; output is not rescanned.
function applyReplaceStatements(tokens, ctx) {
  let active = [];
  const out = [];
  let from = 0;
  const flush = (to) => {
    if (from >= to) return;
    const text = tokens.slice(from, to);
    let done = applyReplacing(text, active, MAX_REPLACED_GROWTH - ctx.replacedGrowth);
    if (!done) {
      ctx.copies.push({ name: 'REPLACE', lib: null, via: 'replace', file: text[0].file, line: text[0].line, status: 'expansion-limit', path: null });
      done = text;
    } else ctx.replacedGrowth += done.length - text.length;
    for (const t of done) out.push(t);
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const next = tokens[i + 1];
    if (tk.t === 'word' && tk.u === 'REPLACE' && next && (next.t === 'pseudo' || next.u === 'OFF' || next.u === 'ALSO' || next.u === 'LEADING' || next.u === 'TRAILING')) {
      flush(i);
      if (next.u === 'OFF') { active = []; i += tokens[i + 2] && tokens[i + 2].t === 'period' ? 2 : 1; from = i + 1; continue; }
      const [pairs, j] = readReplacingPairs(tokens, next.u === 'ALSO' ? i + 2 : i + 1);
      active = next.u === 'ALSO' ? [...active, ...pairs] : pairs;
      i = tokens[j] && tokens[j].t === 'period' ? j : j - 1;
      from = i + 1;
    }
  }
  flush(tokens.length);
  return out;
}

function stripDirecting(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'word' && /^(EJECT|SKIP1|SKIP2|SKIP3)$/.test(tk.u)) { if (tokens[i + 1] && tokens[i + 1].t === 'period') i++; continue; }
    if (tk.t === 'word' && tk.u === 'TITLE' && tokens[i + 1] && tokens[i + 1].t === 'lit') { i++; if (tokens[i + 1] && tokens[i + 1].t === 'period') i++; continue; }
    out.push(tk);
  }
  return out;
}

function parseDataEntry(toks, section, file) {
  const levelTok = toks[0];
  const level = Number(levelTok.v);
  const item = { level, name: 'FILLER', section, line: levelTok.line, file: levelTok.file, picture: null, usage: null, occurs: 1,
    redefines: null, signSeparate: false, sync: false, values: [], children: [], parent: null, refsInData: [] };
  const report = section === 'REPORT';
  let j = 1;
  if (toks[j] && toks[j].t === 'word' && !DATA_CLAUSE_WORDS.has(toks[j].u) && !(section === 'SCREEN' && SCREEN_CLAUSE_WORDS.has(toks[j].u))
    && !(report && REPORT_CLAUSE_WORDS.has(toks[j].u))) { item.name = toks[j].u; j++; }
  else if (toks[j] && toks[j].u === 'FILLER') j++;
  while (j < toks.length) {
    const t = toks[j];
    const u = t.u;
    if (report && (u === 'LINE' || u === 'LINES')) {
      item.rwLine = true;
      j++;
      while (toks[j] && ['NUMBER', 'NUMBERS', 'IS', 'ARE', 'ON', 'NEXT', 'PAGE', 'PLUS', '+'].includes(toks[j].u)) j++;
      if (toks[j] && /^\d+$/.test(toks[j].v)) j++;
      continue;
    }
    if (report && (u === 'COLUMN' || u === 'COLUMNS' || u === 'COL' || u === 'COLS')) {
      j++;
      let plus = false;
      while (toks[j] && ['NUMBER', 'NUMBERS', 'IS', 'ARE', 'LEFT', 'RIGHT', 'CENTER', 'CENTRE', 'PLUS', '+'].includes(toks[j].u)) { if (toks[j].u === 'PLUS' || toks[j].u === '+') plus = true; j++; }
      if (toks[j] && /^\d+$/.test(toks[j].v)) { item.rwColumn = plus ? { plus: Number(toks[j].v) } : { at: Number(toks[j].v) }; j++; }
      continue;
    }
    // What a report line prints, and the condition that decides whether it prints, come from these;
    // they are references like any other.
    if (report && (u === 'SOURCE' || u === 'SUM' || u === 'UPON' || u === 'RESET' || ((u === 'PRESENT' || u === 'ABSENT') && toks[j + 1]?.u === 'WHEN'))) {
      j += u === 'PRESENT' || u === 'ABSENT' ? 2 : 1;
      while (toks[j] && (toks[j].t !== 'word' || !(REPORT_CLAUSE_WORDS.has(toks[j].u) || DATA_CLAUSE_WORDS.has(toks[j].u)))) {
        if (toks[j].t === 'word' && !['IS', 'ARE', 'ON'].includes(toks[j].u) && /[A-Z]/.test(toks[j].u)) item.refsInData.push(toks[j]);
        j++;
      }
      continue;
    }
    if (u === 'PIC' || u === 'PICTURE') { j++; if (toks[j] && toks[j].u === 'IS') j++; if (toks[j]) item.picture = toks[j].v; j++; continue; }
    if (u === 'USAGE') { j++; if (toks[j] && toks[j].u === 'IS') j++; if (toks[j]) { item.usage = toks[j].u; j++; } continue; }
    if (USAGE_WORDS.has(u)) { item.usage = u; j++; continue; }
    // OCCURS DYNAMIC [CAPACITY IN name] [FROM n] [TO m]: sized at its most, none without TO; the
    // capacity name is declared by the clause.
    if (u === 'OCCURS' && toks[j + 1] && toks[j + 1].u === 'DYNAMIC') {
      j += 2;
      item.occurs = 0;
      for (;;) {
        const w = toks[j] && toks[j].u;
        if (w === 'CAPACITY') { j++; if (toks[j] && toks[j].u === 'IN') j++; if (toks[j] && toks[j].t === 'word') item.capacityName = toks[j++].u; continue; }
        if (w === 'FROM' || w === 'TO') { j++; if (toks[j] && /^\d+$/.test(toks[j].v)) { if (w === 'TO') item.occurs = Number(toks[j].v); j++; } continue; }
        if (w === 'INITIALIZED') { j++; continue; }
        break;
      }
      continue;
    }
    if (u === 'OCCURS') {
      j++;
      item.occursDeclared = true;
      const readCount = () => {
        const t2 = toks[j];
        if (!t2) return null;
        j++;
        if (/^\d+$/.test(t2.v)) return { n: Number(t2.v) };
        if (t2.t === 'word') return { name: t2.u };
        return null;
      };
      const first = readCount();
      let last = first;
      if (toks[j] && toks[j].u === 'TO') { j++; last = readCount() || first; }
      if (last && last.n != null) item.occurs = last.n;
      else if (last && last.name) item.occursName = last.name;
      continue;
    }
    // dependingOn marks the table as variable: its size above is its largest, not what it holds.
    if (u === 'DEPENDING') { j++; if (toks[j] && toks[j].u === 'ON') j++; if (toks[j] && toks[j].t === 'word') { item.refsInData.push(toks[j]); item.dependingOn = toks[j].u; } j++; continue; }
    if (u === 'KEY') { j++; if (toks[j] && toks[j].u === 'IS') j++; while (toks[j] && toks[j].t === 'word' && !DATA_CLAUSE_WORDS.has(toks[j].u) && !['INDEXED', 'ASCENDING', 'DESCENDING'].includes(toks[j].u)) item.refsInData.push(toks[j++]); continue; }
    if (u === 'INDEXED') { j++; if (toks[j] && toks[j].u === 'BY') j++; item.indexNames = []; while (toks[j] && toks[j].t === 'word' && !DATA_CLAUSE_WORDS.has(toks[j].u) && !['ASCENDING', 'DESCENDING'].includes(toks[j].u)) item.indexNames.push(toks[j++].u); continue; }
    if (u === 'REDEFINES') { item.redefines = toks[j + 1] ? toks[j + 1].u : null; j += 2; continue; }
    if (u === 'RENAMES') {
      j++;
      item.renames = [];
      let wantName = true;
      while (toks[j] && toks[j].t === 'word') {
        const w = toks[j].u;
        item.refsInData.push(toks[j]);
        if (w === 'THRU' || w === 'THROUGH') { wantName = true; j++; continue; }
        if (w === 'OF' || w === 'IN') {
          if (toks[j + 1] && item.renames.length) { item.refsInData.push(toks[j + 1]); item.renames[item.renames.length - 1].quals.push(toks[j + 1].u); }
          j += 2;
          continue;
        }
        if (wantName) { item.renames.push({ name: w, quals: [] }); wantName = false; }
        j++;
      }
      continue;
    }
    if (u === 'TYPEDEF') { item.typedef = true; j++; if (toks[j] && toks[j].u === 'STRONG') j++; continue; }
    if (u === 'TYPE' && !report) {
      j++;
      if (toks[j] && toks[j].u === 'TO') j++;
      if (toks[j] && toks[j].t === 'word') { item.typeName = toks[j].u; item.refsInData.push(toks[j]); }
      j++;
      continue;
    }
    if (u === 'EXTERNAL') { item.external = true; j++; continue; }
    if (u === 'SEPARATE') { item.signSeparate = true; j++; continue; }
    if (u === 'SIGN' || u === 'LEADING' || u === 'TRAILING') { item.signExplicit = true; j++; continue; }
    if (u === 'SYNC' || u === 'SYNCHRONIZED') { item.sync = true; j++; continue; }
    if (u === 'CONSTANT') { item.constant = true; j++; if (toks[j] && toks[j].u === 'AS') j++; while (toks[j] && (toks[j].t === 'num' || toks[j].t === 'lit' || (toks[j].t === 'word' && /^\d+$/.test(toks[j].v)))) item.values.push(toks[j++]); continue; }
    if (u === 'VALUE' || u === 'VALUES') {
      j++;
      while (toks[j] && (toks[j].t !== 'word' || !(DATA_CLAUSE_WORDS.has(toks[j].u) || (report && REPORT_CLAUSE_WORDS.has(toks[j].u))) || toks[j].u === 'IS')) { item.values.push(toks[j]); j++; }
      continue;
    }
    if (section === 'SCREEN' && (u === 'FROM' || u === 'TO' || u === 'USING')) { if (toks[j + 1] && toks[j + 1].t === 'word') { item.refsInData.push(toks[j + 1]); if (!item.screenRef) item.screenRef = toks[j + 1].u; } j += 2; continue; }
    j++;
  }
  return item;
}

// WITH DEBUGGING MODE declares DEBUG-ITEM, laid out as the debug module lays it out, with the
// thirty-character DEBUG-CONTENTS the compiler gives it.
function debugItem(at) {
  const entry = (level, name, picture, sign) => ({ level, name, section: 'WORKING-STORAGE', line: at.line, file: at.file, picture, usage: null,
    occurs: 1, redefines: null, signSeparate: !!sign, signExplicit: !!sign, sync: false, values: [], children: [], parent: null, refsInData: [], implicit: true });
  const root = entry(1, 'DEBUG-ITEM', null);
  for (const [name, picture, sign] of [['DEBUG-LINE', 'X(6)'], ['FILLER', 'X'], ['DEBUG-NAME', 'X(30)'], ['FILLER', 'X'],
    ['DEBUG-SUB-1', 'S9(4)', true], ['FILLER', 'X'], ['DEBUG-SUB-2', 'S9(4)', true], ['FILLER', 'X'], ['DEBUG-SUB-3', 'S9(4)', true],
    ['FILLER', 'X'], ['DEBUG-CONTENTS', 'X(30)']]) {
    const c = entry(3, name, picture, sign);
    c.parent = root;
    root.children.push(c);
  }
  return [root, ...root.children];
}

// TYPE gives an item the picture, usage and subordinate items of the TYPEDEF it names. The listing
// prints the typed item alone; what it holds is implied, reachable by qualification (RE OF WS-Z),
// so the copies are returned as items marked typeClone.
function applyTypes(items) {
  const typedefs = new Map(items.filter(i => i.typedef).map(i => [i.name, i]));
  const added = [];
  if (!typedefs.size) return added;
  const clone = (x, parent, at) => {
    const c = { ...x, parent, section: at.section, line: at.line, file: at.file, children: [], refsInData: [], typedef: false, typeClone: true };
    c.children = x.children.map(k => clone(k, c, at));
    added.push(c);
    return c;
  };
  // A TYPEDEF may itself be declared with TYPE, so a type is applied once its own type has been.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const it of items) {
      if (!it.typeName || it.typeApplied) continue;
      const td = typedefs.get(it.typeName);
      if (!td || td === it || (td.typeName && !td.typeApplied)) continue;
      it.typeApplied = true;
      changed = true;
      if (!it.picture) it.picture = td.picture;
      if (!it.usage) it.usage = td.usage;
      if (td.signSeparate) it.signSeparate = true;
      if (!it.children.length) it.children = td.children.map(k => clone(k, it, it));
    }
    if (!changed) break;
  }
  return added;
}

const ENV_PARAGRAPHS = new Set(['CONFIGURATION', 'SOURCE-COMPUTER', 'OBJECT-COMPUTER', 'SPECIAL-NAMES', 'REPOSITORY', 'INPUT-OUTPUT', 'FILE-CONTROL', 'I-O-CONTROL']);

const SECTION_NAMES = { 'WORKING-STORAGE': 'WORKING-STORAGE', 'LOCAL-STORAGE': 'LOCAL-STORAGE', LINKAGE: 'LINKAGE', FILE: 'FILE', SCREEN: 'SCREEN', REPORT: 'REPORT', COMMUNICATION: 'COMMUNICATION' };

function sentences(tokens, from, to) {
  const out = [];
  let cur = [];
  for (let i = from; i < to; i++) {
    const t = tokens[i];
    if (t.t === 'period') { if (cur.length) out.push(cur); cur = []; continue; }
    cur.push(t);
  }
  if (cur.length) out.push(cur);
  return out;
}

function findDivision(tokens, from, to, name) {
  for (let i = from; i < to - 1; i++) if (tokens[i].t === 'word' && tokens[i].u === name && tokens[i + 1].t === 'word' && tokens[i + 1].u === 'DIVISION') return i;
  return -1;
}

function parseProgram(tokens, from, to, scheme, defines, hostVariables = true) {
  const prog = { id: null, line: tokens[from] ? tokens[from].line : 0, items: [], files: [], labels: [], calls: [], execs: [], refs: [], accepts: [], diags: [], statements: [], resolved: new Map() };
  for (let i = from; i < to - 1; i++) {
    if (tokens[i].t === 'word' && (tokens[i].u === 'PROGRAM-ID' || tokens[i].u === 'FUNCTION-ID')) {
      let j = i + 1;
      if (tokens[j] && tokens[j].t === 'period') j++;
      if (tokens[j]) prog.id = tokens[j].v.toUpperCase();
      break;
    }
  }
  const dataAt = findDivision(tokens, from, to, 'DATA');
  let procAt = findDivision(tokens, from, to, 'PROCEDURE');
  // A program without an ENVIRONMENT DIVISION header can still open with its paragraphs.
  let envAt = findDivision(tokens, from, to, 'ENVIRONMENT');
  if (envAt < 0) {
    const stop = [dataAt, procAt, to].filter(x => x >= 0).reduce((a, b) => Math.min(a, b));
    for (let i = from; i < stop; i++) if (tokens[i].t === 'word' && ENV_PARAGRAPHS.has(tokens[i].u) && tokens[i + 1] && (tokens[i + 1].t === 'period' || tokens[i + 1].u === 'SECTION')) { envAt = i; break; }
  }
  const procEnd = to;
  let wsAt = -1;
  if (dataAt < 0) {
    for (let i = from; i < to - 1; i++) if (tokens[i].t === 'word' && SECTION_NAMES[tokens[i].u] && tokens[i + 1].u === 'SECTION') { wsAt = i; break; }
  }
  const dataStart = dataAt >= 0 ? dataAt : wsAt;
  const dataEnd = procAt >= 0 ? procAt : to;
  const envEnd = dataStart >= 0 ? dataStart : dataEnd;

  if (envAt >= 0) {
    for (const s of sentences(tokens, envAt, envEnd)) {
      const dbg = s.findIndex((t, k) => t.u === 'DEBUGGING' && s[k + 1] && s[k + 1].u === 'MODE');
      if (dbg >= 0) prog.debuggingMode = s[dbg];
      const k = s.findIndex(t => t.u === 'SELECT');
      if (k >= 0 && s[k + 1]) {
        let n = k + 1;
        if (s[n].u === 'OPTIONAL') n++;
        const f = { name: s[n] ? s[n].u : null, line: s[k].line, file: s[k].file, assign: null, envRefs: [] };
        const a = s.findIndex(t => t.u === 'ASSIGN');
        if (a >= 0) {
          let m = a + 1;
          while (s[m] && (s[m].u === 'TO' || s[m].u === 'USING' || s[m].u === 'DYNAMIC' || s[m].u === 'EXTERNAL')) m++;
          if (s[m]) f.assign = { t: s[m].t, v: s[m].t === 'word' ? s[m].u : s[m].v };
        }
        for (let m = n + 1; m < s.length; m++) if (s[m].t === 'word') f.envRefs.push(s[m]);
        prog.files.push(f);
      } else {
        for (const t of s) if (t.t === 'word') prog.refs.push({ tok: t, zone: 'env' });
      }
    }
  }

  const roots = [];
  if (dataStart >= 0) {
    let section = null;
    let stack = [];
    let currentFd = null;
    let currentRd = null;
    const dataSentences = sentences(tokens, dataStart, dataEnd);
    for (let s of dataSentences) {
      // What an EXEC SQL INCLUDE brings in follows it in the same sentence, up to its own first period.
      while (s.length && s[0].t === 'exec') { prog.execs.push(s[0]); s = s.slice(1); }
      if (!s.length) continue;
      const first = s[0];
      if (first.u === 'DATA' && s[1] && s[1].u === 'DIVISION') { if (s.length > 2 && s[2].u === 'SECTION') {} continue; }
      if (first.t === 'word' && SECTION_NAMES[first.u] && s[1] && s[1].u === 'SECTION') { section = SECTION_NAMES[first.u]; stack = []; currentFd = null; currentRd = null; continue; }
      // A report description and a communication description open their own sections and are not
      // files. An FD or SD needs no FILE SECTION header before it: the compiler reads one without.
      if (first.t === 'word' && (first.u === 'RD' || first.u === 'CD') && s[1]) {
        section = first.u === 'RD' ? 'REPORT' : 'COMMUNICATION';
        currentFd = null;
        currentRd = first.u === 'RD' ? { name: s[1].u, line: first.line, file: first.file, groups: [] } : null;
        if (currentRd) (prog.reports ||= []).push(currentRd);
        else (prog.cds ||= []).push(s[1].u);
        stack = [];
        continue;
      }
      if (first.t === 'word' && (first.u === 'FD' || first.u === 'SD') && s[1]) {
        section = 'FILE';
        currentRd = null;
        currentFd = { kind: first.u, name: s[1].u, line: first.line, file: first.file, records: [], fdTok: s[1], declaredMax: 0, varying: false };
        const recAt = s.findIndex(x => x.t === 'word' && x.u === 'RECORD');
        if (recAt >= 0) for (let m = recAt + 1; m < s.length && !['LABEL', 'BLOCK', 'DATA', 'VALUE', 'RECORDING', 'CODE-SET', 'LINAGE', 'REPORT', 'REPORTS', 'DEPENDING'].includes(s[m].u); m++) {
          if (s[m].u === 'VARYING') currentFd.varying = true;
          if (/^\d+$/.test(s[m].v)) currentFd.declaredMax = Math.max(currentFd.declaredMax, Number(s[m].v));
        }
        const repAt = s.findIndex(x => x.t === 'word' && (x.u === 'REPORT' || x.u === 'REPORTS'));
        if (repAt >= 0) {
          currentFd.reports = [];
          for (let m = repAt + 1; m < s.length && s[m].t === 'word' && !['LABEL', 'BLOCK', 'DATA', 'VALUE', 'RECORD', 'RECORDING', 'CODE-SET', 'LINAGE'].includes(s[m].u); m++) {
            if (s[m].u !== 'IS' && s[m].u !== 'ARE') currentFd.reports.push(s[m].u);
          }
        }
        for (let m = 2; m < s.length; m++) if (s[m].t === 'word' && s[m - 1] && ['ON', 'DEPENDING', 'IS'].includes(s[m - 1].u)) prog.refs.push({ tok: s[m], zone: 'data' });
        prog.fds = prog.fds || [];
        prog.fds.push(currentFd);
        stack = [];
        continue;
      }
      if ((first.t === 'word' || first.t === 'num') && /^\d{1,2}$/.test(first.v)) {
        const item = parseDataEntry(s, section, first.file);
        if (item.level === 88 || item.level === 66) {
          const parent = item.level === 88 ? stack[stack.length - 1] : null;
          if (parent) { parent.children.push(item); item.parent = parent; }
          else if (item.level === 66 && roots.length) { roots[roots.length - 1].children.push(item); item.parent = roots[roots.length - 1]; }
          prog.items.push(item);
          // RENAMES and VALUE THRU operands are references like any other.
          for (const r of item.refsInData) prog.refs.push({ tok: r, zone: 'data' });
          continue;
        }
        if (item.level === 78) { prog.items.push(item); continue; }
        if (item.level === 1 || item.level === 77) {
          stack = [item];
          roots.push(item);
          if (currentFd && section === 'FILE') { currentFd.records.push(item); item.fd = currentFd; }
          if (currentRd && section === 'REPORT') { currentRd.groups.push(item); item.rd = currentRd; }
        } else {
          while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
          const parent = stack[stack.length - 1];
          if (parent) { parent.children.push(item); item.parent = parent; } else roots.push(item);
          stack.push(item);
        }
        prog.items.push(item);
        for (const r of item.refsInData) prog.refs.push({ tok: r, zone: 'data' });
        continue;
      }
      prog.diags.push({ kind: 'unrecognised-data-sentence', line: first.line, file: first.file });
    }
    prog.items.push(...applyTypes(prog.items));
    if (prog.debuggingMode) { const d = debugItem(prog.debuggingMode); roots.unshift(d[0]); prog.items.unshift(...d); }
    const constants = new Map();
    constants.textBytes = new Map();
    constants.text = new Map();
    for (const [k, v] of defines || []) { if (/^-?\d+$/.test(v)) constants.set(k, Number(v)); else constants.textBytes.set(k, v.length); }
    for (const it of prog.items) {
      if (it.level !== 78 && !it.constant) continue;
      const textLit = it.values.find(v => v.t === 'lit');
      if (textLit && !constants.textBytes.has(it.name)) constants.textBytes.set(it.name, literalBytes(textLit));
      if (textLit && !constants.text.has(it.name)) constants.text.set(it.name, textLit.v);
      const lit = it.values.find(v => v.t === 'num' || (v.t === 'word' && /^\d+$/.test(v.v)));
      if (lit) constants.set(it.name, Number(lit.v));
    }
    for (const it of prog.items) if (it.occursName) it.occurs = constants.get(it.occursName) ?? 1;
    prog.renamesPending = prog.items.filter(it => it.level === 66 && it.renames && it.renames.length);
    prog.constants = constants;
    for (const it of prog.items) if (it.screenRef) it.screenRefItem = prog.items.find(x => x.name === it.screenRef && x.section !== 'SCREEN') || null;
    // REDEFINES names a SIBLING: another item at the same level under the same parent, or another
    // 01 in the same section when there is no parent. Resolving it by name across the whole program
    // reached the first item of that name anywhere, which crossed records in both directions;
    // resolving it only within a group missed 01 REDEFINES 01, which is how a message buffer and
    // the record laid over it are usually written.
    for (const it of prog.items) {
      if (!it.redefines) continue;
      const siblings = it.parent ? it.parent.children : roots.filter(x => x.section === it.section);
      const before = siblings.slice(0, Math.max(0, siblings.indexOf(it)));
      it.redefinesItem = [...before].reverse().find(x => x.name === it.redefines)
        || siblings.find(x => x !== it && x.name === it.redefines) || null;
    }
    computeSizes(roots, scheme, constants);
    const subtreeCache = new Map();
    const subtree = (record) => {
      if (subtreeCache.has(record)) return subtreeCache.get(record);
      const all = [];
      (function walk(x) { for (const c of x.children) { if (c.level === 88 || c.level === 66 || c.level === 78) continue; all.push(c); walk(c); } })(record);
      subtreeCache.set(record, all);
      return all;
    };
    // RENAMES spans storage from the start of the first item to the end of the last, and either
    // end may be a group, so the span comes from offsets rather than a list of leaves.
    for (const it of prog.renamesPending || []) {
      const record = it.parent;
      if (!record) continue;
      const all = subtree(record);
      const match = (spec) => {
        const cands = all.filter(x => x.name === spec.name);
        if (cands.length < 2 || !spec.quals.length) return cands[0];
        return cands.find(c => {
          const anc = [];
          for (let q = c.parent; q; q = q.parent) anc.push(q.name);
          let pos = 0;
          for (const q of spec.quals) { const k = anc.indexOf(q, pos); if (k < 0) return false; pos = k + 1; }
          return true;
        }) || cands[0];
      };
      const a = match(it.renames[0]);
      const b = it.renames[1] ? match(it.renames[1]) : a;
      if (!a || !b) continue;
      const from = Math.min(a.offset, b.offset);
      const to = Math.max(a.offset + a.contributes, b.offset + b.contributes);
      it.size = to - from;
      it.contributes = 0;
      // The items the alias covers, so a value reaching one of them is known to reach the alias.
      it.renamesSpan = all.filter(x => x.offset >= from && x.offset + x.contributes <= to && x !== it);
    }
    for (const rd of prog.reports || []) layoutReport(rd);
    // A file is as large as the longer of its declared length and its record description; the
    // compiler warns when a record exceeds the declared maximum but still uses the record. A report
    // file's record is as wide as the widest line of the reports written to it.
    for (const fd of prog.fds || []) {
      const reports = (fd.reports || []).map(n => (prog.reports || []).find(r => r.name === n)).filter(Boolean);
      fd.size = Math.max(fd.declaredMax || 0, 0, ...fd.records.map(r => r.size || 0), ...reports.map(r => r.width || 0));
    }
  }

  if (procAt >= 0) parseProcedure(tokens, procAt, procEnd, prog, hostVariables);
  else prog.diags.push({ kind: 'no-procedure-division' });
  resolveReferences(prog);
  return prog;
}

export function segmentEnd(tokens, i, to) {
  let depth = 0;
  for (let k = i + 1; k < to; k++) {
    const t = tokens[k];
    if (t.t === 'sep') { depth += t.v === '(' ? 1 : -1; continue; }
    if (depth > 0) continue;
    if (t.t === 'period' || t.t === 'exec') return k;
    if (t.t === 'word' && (VERBS.has(t.u) || SCOPE_TERMINATORS.has(t.u) || STATEMENT_BREAKS.has(t.u))) {
      const prev = tokens[k - 1];
      if (prev && prev.t === 'word' && ((prev.u === 'EXIT' && t.u === 'PERFORM') || prev.u === 'USAGE' || prev.u === 'UPON')) continue;
      if (t.u === 'EXIT' && prev && prev.t === 'word' && prev.u === 'UNTIL') continue;
      if (t.u === 'DISPLAY' && prev && prev.u === 'IS') continue;
      return k;
    }
  }
  return to;
}

function parseProcedure(tokens, procAt, to, prog, hostVariables) {
  let i = procAt + 2;
  const headerRefs = [];
  while (i < to && tokens[i].t !== 'period') { if (tokens[i].t === 'word') headerRefs.push(tokens[i]); i++; }
  const receiving = new Map();
  let inUsing = false;
  let paramMode = 'REFERENCE';
  prog.paramTokens = [];
  for (let k = 0; k < headerRefs.length; k++) {
    const t = headerRefs[k];
    // WITH C LINKAGE, WITH PASCAL LINKAGE: a calling convention, not data.
    if (t.u === 'WITH' && headerRefs[k + 2] && headerRefs[k + 2].u === 'LINKAGE') { k += 2; continue; }
    if (t.u === 'USING' || t.u === 'CHAINING') { inUsing = true; continue; }
    if (t.u === 'RETURNING') { inUsing = false; continue; }
    if (inUsing && ['REFERENCE', 'VALUE', 'CONTENT'].includes(t.u)) { paramMode = t.u; continue; }
    if (inUsing && !['BY', 'OPTIONAL'].includes(t.u)) { receiving.set(t, 'PROCEDURE-USING'); prog.paramTokens.push({ tok: t, mode: paramMode }); }
    prog.refs.push({ tok: t, zone: 'proc' });
  }
  i++;
  // Where the statements begin, so a reader of control flow can walk the same tokens in order.
  prog.proc = { tokens, from: i, to };
  let sentenceStart = true;
  let currentVerb = null;
  let openMode = null;
  for (; i < to; i++) {
    const t = tokens[i];
    if (t.t === 'period') { sentenceStart = true; continue; }
    if (sentenceStart && t.t === 'word') {
      const next = tokens[i + 1];
      if (next && next.t === 'word' && next.u === 'SECTION' && !NOT_LABELS.has(t.u)) {
        prog.labels.push({ kind: 'S', name: t.u, line: t.line, file: t.file, at: i });
        i++;
        if (tokens[i + 1] && tokens[i + 1].t !== 'period') i++;
        continue;
      }
      if (next && next.t === 'period' && !NOT_LABELS.has(t.u) && !VERBS.has(t.u) && !SCOPE_TERMINATORS.has(t.u)) {
        prog.labels.push({ kind: 'P', name: t.u, line: t.line, file: t.file, at: i });
        continue;
      }
      if (t.u === 'END' && next && next.u === 'DECLARATIVES') { i++; continue; }
    }
    // What an INCLUDE brings in follows it, and may open with a paragraph header.
    if (t.t === 'exec' && t.kind === 'SQL' && t.toks[0]?.u === 'INCLUDE') { prog.execs.push(t); continue; }
    sentenceStart = false;
    if (t.t === 'exec') {
      prog.execs.push(t);
      if (t.kind === 'SQL' && hostVariables) hostVariableRefs(t, prog.refs, receiving);
      if (t.kind === 'CICS' && hostVariables) cicsArgumentRefs(t, prog.refs, receiving);
      continue;
    }
    if (t.t !== 'word') continue;
    // WHEN is not a verb, so its condition is kept as a statement of its own for whatever reads
    // conditions. It moves no data, and the tokens around it are read as they are anywhere else.
    if (t.u === 'WHEN' && currentVerb) {
      const cond = tokens.slice(i + 1, segmentEnd(tokens, i, to));
      prog.statements.push({ verb: 'WHEN', line: t.line, file: t.file, at: i, targets: [], sources: identifierTokens(cond, 0, cond.length),
        literals: cond.filter((x) => x.t === 'lit' || x.t === 'num'), ops: cond.filter((x) => x.t === 'op').map((x) => x.v) });
    }
    if (!VERBS.has(t.u)) {
      t.verb = currentVerb;
      if (currentVerb === 'OPEN') { if (['INPUT', 'OUTPUT', 'EXTEND', 'I-O'].includes(t.u)) openMode = t.u; else t.openMode = openMode; }
      prog.refs.push({ tok: t, zone: 'proc' });
      continue;
    }
    const prev = tokens[i - 1];
    if (prev && prev.t === 'word' && prev.u === 'EXIT' && t.u === 'PERFORM') continue;
    if (t.u === 'EXIT' && prev && prev.t === 'word' && prev.u === 'UNTIL') continue;
    currentVerb = t.u;
    openMode = null;
    const end = segmentEnd(tokens, i, to);
    const seg = tokens.slice(i + 1, end);
    // Collect this statement's targets in their own map: snapshotting the program-wide map per
    // statement is quadratic, and one generated file has tens of thousands of statements.
    const stmtReceiving = new Map();
    markReceiving(t.u, seg, stmtReceiving);
    const targets = [...stmtReceiving.keys()];
    for (const [k, v] of stmtReceiving) receiving.set(k, v);
    const targetSet = new Set(targets);
    const stmt = { verb: t.u, line: t.line, file: t.file, at: i, end, targets, sources: identifierTokens(seg, 0, seg.length).filter(x => !targetSet.has(x)), literals: seg.filter(x => x.t === 'lit' || x.t === 'num') };
    // A condition's operators, which say whether it bounds a value or only compares it for equality.
    if (t.u === 'IF' || t.u === 'EVALUATE') stmt.ops = seg.filter(x => x.t === 'op').map(x => x.v);
    const indexes = indexTokens(seg);
    if (indexes.length) stmt.indexes = indexes;
    const fns = seg.filter((x, k) => x.t === 'word' && k > 0 && seg[k - 1].t === 'word' && seg[k - 1].u === 'FUNCTION').map((x) => x.u);
    if (fns.length) stmt.fns = fns;
    // INSPECT ... TALLYING writes a count, not the bytes it inspected.
    if (t.u === 'INSPECT' && seg.some((x) => x.t === 'word' && x.u === 'TALLYING') && !seg.some((x) => x.t === 'word' && (x.u === 'REPLACING' || x.u === 'CONVERTING'))) stmt.counts = true;
    // A PERFORM's UNTIL test is a condition, not data moved into the VARYING variable.
    // SEARCH moves nothing out of the table it searches: its index counts, and each WHEN is a
    // condition kept as a statement of its own.
    if (t.u === 'SEARCH') stmt.sources = [];
    if (t.u === 'MOVE' && seg[0] && seg[0].t === 'word' && (seg[0].u === 'CORRESPONDING' || seg[0].u === 'CORR')) stmt.corresponding = true;
    if (t.u === 'PERFORM') {
      const cond = untilTokens(seg);
      if (cond.size) stmt.sources = stmt.sources.filter((x) => !cond.has(x));
      const loops = loopsOf(seg);
      if (loops.length) stmt.loops = loops;
    }
    prog.statements.push(stmt);
    if (t.u === 'CALL') {
      const target = seg[0] && seg[0].t === 'word' && seg[1] && seg[1].t === 'lit' ? seg[1] : seg[0];
      if (target) {
        const usingAt = seg.findIndex(x => x.t === 'word' && x.u === 'USING');
        const args = [];
        if (usingAt >= 0) {
          let mode = 'REFERENCE';
          let depth = 0;
          for (let k = usingAt + 1; k < seg.length; k++) {
            const x = seg[k];
            if (x.t === 'sep') { depth += x.v === '(' ? 1 : -1; continue; }
            if (depth > 0) continue;
            if (x.t === 'word' && (x.u === 'BY' || x.u === 'OPTIONAL')) continue;
            if (x.t === 'word' && ['REFERENCE', 'CONTENT', 'VALUE'].includes(x.u)) { mode = x.u; continue; }
            if (x.t === 'word' && ['RETURNING', 'GIVING', 'ON', 'NOT', 'EXCEPTION', 'OVERFLOW'].includes(x.u)) break;
            // `X OF Y` is ONE argument, X. Taking the qualifier as an argument of its own put the
            // sink on the whole record — so any field of it looked tainted — and shifted every
            // later argument by one, which broke the mapping onto the callee's parameters.
            if (x.t === 'word' && (x.u === 'OF' || x.u === 'IN')) { k++; continue; }
            // LENGTH OF X and ADDRESS OF X are arguments in their own right: a placeholder keeps
            // the positions of the arguments after them.
            if (x.t === 'word' && (x.u === 'LENGTH' || x.u === 'ADDRESS') && seg[k + 1] && seg[k + 1].u === 'OF') { args.push({ word: null, of: x.u, mode }); k += 2; continue; }
            if (x.t === 'lit' || x.t === 'num') { args.push({ lit: x.v, mode }); continue; }
            if (x.t === 'word') args.push({ word: x.u, mode, tok: x });
          }
        }
        // A CALL naming a level-78 constant is a call to the program that constant spells, and the
        // compiler records it as a literal. Read as an identifier it loses the callee — so the
        // cross-program edge disappears — and it manufactures a dynamic-program-load finding out of
        // a name fixed at compile time. Measured on the 500-repository corpus: 3,092 of 3,180 call
        // disagreements were this one shape.
        const constText = target.t === 'word' && prog.constants && prog.constants.text
          ? prog.constants.text.get(target.u) : undefined;
        const resolved = target.t === 'lit' ? target.v : constText;
        prog.calls.push({
          // A literal program name is padded to its field; the compiler drops the trailing spaces.
          kind: resolved === undefined ? 'I' : 'L',
          name: resolved === undefined ? target.u : String(resolved).trimEnd(),
          ...(constText !== undefined ? { viaConstant: target.u } : {}),
          line: t.line, file: t.file, targetTok: target, using: args, stmtIndex: prog.statements.length - 1,
        });
      }
    }
    if (t.u === 'ENTRY') {
      const usingAt = seg.findIndex(x => x.t === 'word' && x.u === 'USING');
      if (usingAt >= 0) for (const x of seg.slice(usingAt + 1)) if (x.t === 'word' && !['BY', 'REFERENCE', 'VALUE', 'CONTENT', 'OPTIONAL'].includes(x.u)) receiving.set(x, 'ENTRY-USING');
    }
    if (t.u === 'ACCEPT') {
      const fromAt = seg.findIndex(x => x.t === 'word' && x.u === 'FROM');
      // The token, not just the name: ACCEPT F-DATA OF REC-B names one of two same-named fields.
      prog.accepts.push({ target: seg[0] ? seg[0].u : null, targetTok: seg[0] || null, from: fromAt >= 0 && seg[fromAt + 1] ? seg[fromAt + 1].u : null, line: t.line, file: t.file });
    }
  }
  prog.receivingTokens = receiving;
}

// Identifiers a statement reads. Parentheses usually hold a subscript, whose value is not the data
// being moved — but the arguments of an intrinsic function are: `MOVE FUNCTION TRIM(WS-IN) TO X`
// carries WS-IN into X, and skipping everything in parentheses lost that whole class of flows.
function identifierTokens(seg, from, to) {
  const out = [];
  const inFunction = [];
  for (let k = from; k < to; k++) {
    const t = seg[k];
    if (t.t === 'sep') {
      if (t.v === '(') {
        const opener = seg[k - 1];
        const before = seg[k - 2];
        inFunction.push(!!(opener && opener.t === 'word' && before && before.t === 'word' && before.u === 'FUNCTION') || (inFunction.length > 0 && inFunction[inFunction.length - 1]));
      } else inFunction.pop();
      continue;
    }
    if (t.t !== 'word') continue;
    if (inFunction.length && !inFunction[inFunction.length - 1]) continue;
    const prev = seg[k - 1];
    if (prev && prev.t === 'word' && (prev.u === 'OF' || prev.u === 'IN')) continue;
    // The function's own name is not data.
    if (prev && prev.t === 'word' && prev.u === 'FUNCTION') continue;
    out.push(t);
  }
  return out;
}

// The constant an index name is shifted by where it stands alone as `NAME + n` or `NAME - n`; 0 for a
// bare name and for any longer expression, which is judged as the bare name.
function offsetOf(seg, j, open, close, colonAt) {
  const isNum = (t) => t && (t.t === 'word' || t.t === 'num') && /^\d+$/.test(t.v);
  const op = seg[j + 1];
  if (!op || op.t !== 'op' || (op.v !== '+' && op.v !== '-') || !isNum(seg[j + 2]) || j + 2 >= close) return 0;
  const prev = seg[j - 1];
  const starts = j - 1 === open || (j - 1 === colonAt) || (prev.t === 'word' && !['OF', 'IN', 'FUNCTION'].includes(prev.u));
  const after = seg[j + 3];
  const ends = j + 3 === close || j + 3 === colonAt || (after && after.t === 'word' && !['OF', 'IN'].includes(after.u));
  if (!starts || !ends) return 0;
  return op.v === '-' ? -Number(seg[j + 2].v) : Number(seg[j + 2].v);
}

// What a statement indexes with. identifierTokens leaves subscripts out, because a subscript is not
// the data a statement moves; a rule about where a statement reads or writes needs exactly them.
// For each parenthesised group after a data name - reached back over OF and IN, so ELEM OF TAB (I)
// indexes ELEM - every name inside it, marked as a subscript, or as the offset or the length of a
// reference modification. A second group straight after the first, X(I)(1:3), indexes the same
// name. A function's arguments are not an index. A name that turns out not to be data - IF (A > B)
// - is left for the caller, which resolves names and drops what does not resolve.
function indexTokens(seg) {
  const out = [];
  let lastHost = null, lastClose = -1;
  for (let k = 1; k < seg.length; k++) {
    const open = seg[k];
    if (open.t !== 'sep' || open.v !== '(') continue;
    let host = null;
    if (seg[k - 1].t === 'sep' && seg[k - 1].v === ')' && lastClose === k - 1) host = lastHost;
    else if (seg[k - 1].t === 'word') {
      let h = k - 1;
      while (h >= 2 && seg[h - 1].t === 'word' && (seg[h - 1].u === 'OF' || seg[h - 1].u === 'IN') && seg[h - 2].t === 'word') h -= 2;
      if (!(seg[h - 1] && seg[h - 1].t === 'word' && seg[h - 1].u === 'FUNCTION')) host = seg[h];
    }
    let depth = 0, close = k, colonAt = -1;
    for (let j = k; j < seg.length; j++) {
      const t = seg[j];
      if (t.t === 'sep') { depth += t.v === '(' ? 1 : -1; if (depth === 0) { close = j; break; } continue; }
      if (depth === 1 && t.t === 'op' && t.v === ':' && colonAt < 0) colonAt = j;
    }
    if (host) {
      for (let j = k + 1; j < close; j++) {
        const t = seg[j];
        // A number is tokenized as a word, and no name is all digits.
        if (t.t !== 'word' || /^\d+$/.test(t.v)) continue;
        const prev = seg[j - 1];
        if (prev && prev.t === 'word' && (prev.u === 'OF' || prev.u === 'IN' || prev.u === 'FUNCTION')) continue;
        out.push({ host, tok: t, kind: colonAt < 0 ? 'subscript' : j < colonAt ? 'refmod-offset' : 'refmod-length', offset: offsetOf(seg, j, k, close, colonAt) });
      }
    }
    lastHost = host;
    lastClose = close;
    k = close;
  }
  return out;
}

// The tokens of a PERFORM's UNTIL conditions, each running to the next AFTER or VARYING.
function untilTokens(seg) {
  const out = new Set();
  let depth = 0, inUntil = false;
  for (const x of seg) {
    if (x.t === 'sep') { depth += x.v === '(' ? 1 : -1; if (inUntil) out.add(x); continue; }
    if (depth === 0 && x.t === 'word') {
      if (x.u === 'UNTIL') { inUntil = true; continue; }
      if (x.u === 'AFTER' || x.u === 'VARYING') inUntil = false;
    }
    if (inUntil) out.add(x);
  }
  return out;
}

// Each counter a PERFORM varies, with the condition that stops it: VARYING I ... UNTIL c, and every
// AFTER J ... UNTIL c after it. A bare PERFORM UNTIL has a condition and no counter.
function loopsOf(seg) {
  const out = [];
  let depth = 0, cur = null, inUntil = false, into = null;
  for (let k = 0; k < seg.length; k++) {
    const x = seg[k];
    if (x.t === 'sep') { depth += x.v === '(' ? 1 : -1; if (inUntil && cur) cur.until.push(x); else if (into) into.push(x); continue; }
    if (depth === 0 && x.t === 'word' && (x.u === 'VARYING' || (x.u === 'AFTER' && !(k && seg[k - 1].u === 'TEST')))) {
      cur = { counter: seg[k + 1] && seg[k + 1].t === 'word' ? seg[k + 1] : null, from: [], by: null, until: [] };
      out.push(cur);
      inUntil = false;
      into = null;
      continue;
    }
    if (depth === 0 && !inUntil && cur && x.t === 'word' && (x.u === 'FROM' || x.u === 'BY')) {
      into = x.u === 'FROM' ? cur.from : (cur.by = []);
      continue;
    }
    if (depth === 0 && x.t === 'word' && x.u === 'UNTIL') {
      if (!cur) { cur = { counter: null, from: [], by: null, until: [] }; out.push(cur); }
      inUntil = true;
      into = null;
      continue;
    }
    if (inUntil && cur) cur.until.push(x);
    else if (into && k > 0) into.push(x);
  }
  return out.filter((l) => l.until.length);
}

function markReceiving(verb, seg, set) {
  const at = (w, start = 0) => { let depth = 0; for (let k = start; k < seg.length; k++) { const t = seg[k]; if (t.t === 'sep') { depth += t.v === '(' ? 1 : -1; continue; } if (depth === 0 && t.t === 'word' && w.includes(t.u)) return k; } return -1; };
  const stopAt = (start, words) => { const k = at(words, start); return k < 0 ? seg.length : k; };
  // A keyword with nothing after it (`ACCEPT.`, `WITH POINTER.`) names no target.
  const mark = (from, to) => { for (const t of identifierTokens(seg, from, Math.min(to, seg.length))) set.set(t, verb); };
  const tail = ['ON', 'NOT', 'SIZE', 'ERROR', 'OVERFLOW', 'EXCEPTION', 'INVALID', 'AT', 'END', 'ROUNDED', 'WITH', 'DELIMITER', 'COUNT', 'TALLYING', 'POINTER', 'REMAINDER', 'CORRESPONDING', 'CORR'];
  switch (verb) {
    case 'MOVE': { const k = at(['TO']); if (k >= 0) mark(k + 1, stopAt(k + 1, tail)); break; }
    case 'ADD': case 'SUBTRACT': { const g = at(['GIVING']); const k = g >= 0 ? g : at([verb === 'ADD' ? 'TO' : 'FROM']); if (k >= 0) mark(k + 1, stopAt(k + 1, tail)); break; }
    case 'MULTIPLY': { const g = at(['GIVING']); const k = g >= 0 ? g : at(['BY']); if (k >= 0) mark(k + 1, stopAt(k + 1, tail)); break; }
    case 'DIVIDE': { const g = at(['GIVING']); const k = g >= 0 ? g : at(['INTO']); if (k >= 0) mark(k + 1, stopAt(k + 1, tail)); const r = at(['REMAINDER']); if (r >= 0) mark(r + 1, stopAt(r + 1, tail)); break; }
    case 'COMPUTE': { const k = seg.findIndex(t => (t.t === 'op' && t.v === '=') || (t.t === 'word' && t.u === 'EQUAL')); if (k >= 0) mark(0, k); break; }
    case 'ACCEPT': { mark(0, 1); break; }
    case 'SET': { const k = stopAt(0, ['TO', 'UP', 'DOWN']); mark(0, k); break; }
    case 'INITIALISE': case 'INITIALIZE': { mark(0, stopAt(0, ['REPLACING', 'WITH', 'ALL', 'TO', 'THEN', 'DEFAULT', 'FILLER', 'ALPHANUMERIC', 'NUMERIC', 'VALUE'])); break; }
    case 'STRING': { const k = at(['INTO']); if (k >= 0) mark(k + 1, stopAt(k + 1, tail)); const p = at(['POINTER']); if (p >= 0) mark(p + 1, p + 2); break; }
    case 'UNSTRING': { const k = at(['INTO']); if (k >= 0) mark(k + 1, stopAt(k + 1, ['DELIMITER', 'COUNT', 'WITH', 'TALLYING', 'ON', 'NOT', 'POINTER'])); for (const w of ['POINTER']) { const p = at([w]); if (p >= 0) mark(p + 1, p + 2); } break; }
    case 'INSPECT': { if (at(['REPLACING', 'CONVERTING']) >= 0) mark(0, 1); const tl = at(['TALLYING']); if (tl >= 0) mark(tl + 1, tl + 2); break; }
    case 'READ': case 'RETURN': { const k = at(['INTO']); if (k >= 0) mark(k + 1, k + 2); break; }
    case 'WRITE': case 'REWRITE': case 'RELEASE': { if (at(['FROM']) >= 0) mark(0, 1); break; }
    case 'CALL': { const k = at(['RETURNING', 'GIVING']); if (k >= 0) mark(k + 1, k + 2); break; }
    case 'PERFORM': { for (let k = 0; k < seg.length; k++) if (seg[k].t === 'word' && (seg[k].u === 'VARYING' || (seg[k].u === 'AFTER' && !(k && seg[k - 1].u === 'TEST')))) mark(k + 1, k + 2); break; }
    case 'SEARCH': { const v = at(['VARYING']); if (v >= 0) mark(v + 1, v + 2); break; }
    default: break;
  }
}

// The pairs a CORRESPONDING phrase matches: subordinate items of one name under the same names, one
// of each pair elementary. FILLER, levels 66 and 88, and an item that REDEFINES, OCCURS or is an
// index take no part, nor does anything under one.
function correspondingPairs(from, to) {
  const takesPart = (x) => x.name !== 'FILLER' && x.level !== 66 && x.level !== 88 && !x.redefines && !x.occursDeclared && x.usage !== 'INDEX';
  const elementary = (x) => !x.children.some((c) => c.level !== 88);
  const pairs = [];
  const walk = (a, b) => {
    for (const cb of b.children) {
      if (!takesPart(cb)) continue;
      const ca = a.children.find((x) => takesPart(x) && x.name === cb.name);
      if (!ca) continue;
      if (elementary(ca) || elementary(cb)) pairs.push([ca, cb]);
      else walk(ca, cb);
    }
  };
  if (from.children) walk(from, to);
  return pairs;
}

function resolveReferences(prog) {
  const byName = new Map();
  const add = (name, target) => { if (!byName.has(name)) byName.set(name, []); byName.get(name).push(target); };
  for (const it of prog.items) if (it.name !== 'FILLER') add(it.name, it);
  for (const fd of prog.fds || []) add(fd.name, fd);
  const ancestors = (x) => { const a = []; let p = x.parent || x.fd; while (p) { a.push(p.name); p = p.parent || p.fd; } return a; };
  for (const it of prog.items) { it.directRefs = 0; it.receiving = false; it.receivingVia = new Set(); it.refVerbs = new Set(); }
  for (const fd of prog.fds || []) { fd.directRefs = 1; fd.receiving = false; }
  const receiving = prog.receivingTokens || new Map();
  const toks = prog.refs;
  const qualifiersOf = (i) => {
    const q = [];
    for (let k = i + 1; k + 1 < toks.length; k += 2) {
      const ofTok = toks[k].tok, qTok = toks[k + 1].tok;
      if (!(ofTok.u === 'OF' || ofTok.u === 'IN') || qTok.line !== ofTok.line && false) break;
      q.push(qTok.u);
    }
    return q;
  };
  for (let i = 0; i < toks.length; i++) {
    const { tok, zone } = toks[i];
    if (tok.u === 'OF' || tok.u === 'IN') continue;
    const prev = toks[i - 1];
    // What ADDRESS OF and LENGTH OF name is their operand, not a qualifier.
    if (prev && (prev.tok.u === 'OF' || prev.tok.u === 'IN') && !(prev.tok.u === 'OF' && ['ADDRESS', 'LENGTH'].includes(toks[i - 2]?.tok.u))) continue;
    if (prev && prev.tok.u === 'FUNCTION') continue;
    const cands = byName.get(tok.u);
    if (!cands) continue;
    const quals = qualifiersOf(i);
    let pick = cands;
    if (quals.length) pick = cands.filter(c => { const a = ancestors(c); let pos = 0; for (const q of quals) { const k = a.indexOf(q, pos); if (k < 0) return false; pos = k + 1; } return true; });
    if (!pick.length) pick = cands;
    const target = pick[0];
    target.directRefs++;
    prog.resolved.set(tok, target);
    if (target.kind && tok.verb === 'OPEN' && ['OUTPUT', 'EXTEND', 'I-O'].includes(tok.openMode)) target.receiving = true;
    if (receiving.has(tok)) { target.receiving = true; if (target.receivingVia) target.receivingVia.add(receiving.get(tok)); }
    if (target.refVerbs && tok.verb) target.refVerbs.add(tok.verb);
    // A qualifier is a reference only where the name needs it, being declared more than once, as
    // cobc counts it: U OF J with U unique leaves J referenced by its child alone.
    let cursor = target;
    for (const q of cands.length > 1 ? quals : []) {
      let p = cursor.parent || cursor.fd;
      while (p && p.name !== q) p = p.parent || p.fd;
      if (p) { p.directRefs++; cursor = p; }
    }
    void zone;
  }
  // MOVE CORRESPONDING writes each receiving item it pairs, and each is a reference of its own; the
  // sending items are read through their group.
  for (const st of prog.statements) {
    if (!st.corresponding) continue;
    const from = st.sources.map((x) => prog.resolved.get(x)).find(Boolean);
    for (const tok of from ? st.targets : []) {
      const to = prog.resolved.get(tok);
      if (!to || !to.children) continue;
      for (const [, item] of correspondingPairs(from, to)) {
        item.directRefs++;
        item.receiving = true;
        item.receivingVia.add('MOVE');
        item.refVerbs.add('MOVE');
      }
    }
  }
  for (const f of prog.files) {
    const fd = (prog.fds || []).find(x => x.name === f.name);
    // A file status field is written by the statements that write the file, so it receives
    // exactly when its file does.
    if (fd && fd.receiving) {
      for (let k = 0; k < f.envRefs.length; k++) {
        if (f.envRefs[k].u !== 'STATUS') continue;
        const target = f.envRefs.slice(k + 1).find(x => !['IS', 'ARE'].includes(x.u));
        const cand = target && byName.get(target.u);
        if (cand && cand[0] && cand[0].receivingVia) { cand[0].receiving = true; cand[0].receivingVia.add('FILE-STATUS'); }
      }
    }
    if (fd) { fd.select = f; fd.directRefs += 0; }
    for (const r of f.envRefs) { const c = byName.get(r.u); if (c && c[0] && !(prog.fds || []).includes(c[0])) c[0].directRefs++; }
    if (fd) fd.directRefs += 0;
  }
  const hasRefDesc = (x) => x.children.some(c => c.directRefs > 0 || hasRefDesc(c));
  for (const it of prog.items) {
    let refParent = false;
    // cobc carries a group's reference down to its items but not through an unnamed FILLER group.
    if (it.level !== 88) for (let p = it.parent; p && p.name !== 'FILLER'; p = p.parent) if (p.directRefs > 0) { refParent = true; break; }
    it.refState = it.directRefs > 0 ? 'refs' : refParent ? 'parent' : hasRefDesc(it) ? 'child' : 'none';
  }
}

// Everything the ENVIRONMENT DIVISION holds counts as declared: SPECIAL-NAMES declares mnemonic,
// alphabet, class, symbolic-character and switch-status names, REPOSITORY functions and classes,
// and Micro Focus declares an ASSIGN operand no item declares as PIC X(255).
function declaredNames(prog) {
  const names = new Set();
  for (const it of prog.items) { names.add(it.name); for (const n of it.indexNames || []) names.add(n); if (it.capacityName) names.add(it.capacityName); }
  for (const fd of prog.fds || []) names.add(fd.name);
  for (const rd of prog.reports || []) names.add(rd.name);
  for (const cd of prog.cds || []) names.add(cd);
  for (const f of prog.files) { if (f.name) names.add(f.name); for (const t of f.envRefs) names.add(t.u); }
  for (const l of prog.labels) names.add(l.name);
  for (const r of prog.refs) if (r.zone === 'env') names.add(r.tok.u);
  return names;
}

// Skipped as resolveReferences skips a qualifier and a function's name; the condition inside
// DFHRESP() or DFHVALUE() is the translator's to resolve.
const NOT_A_NAME_AFTER = new Set(['OF', 'IN', 'FUNCTION', 'DFHRESP', 'DFHVALUE']);

// FD clauses are left out: a word after IS there is as often a recording mode as a name.
// An EXEC SQL block's host variables are references to the program's data: :A.B names B qualified
// by A, and the variables of a SELECT or FETCH INTO list, up to FROM, are written. An INSERT's INTO
// names a table. The block keeps them, each by the token that resolves to its item.
function hostVariableRefs(exec, refs, receiving) {
  const toks = exec.toks;
  const into = ['SELECT', 'FETCH'].includes(toks[0]?.u) ? toks.findIndex((x) => x.t === 'word' && x.u === 'INTO') : -1;
  const fromAt = into < 0 ? -1 : toks.findIndex((x, k) => k > into && x.t === 'word' && x.u === 'FROM');
  const intoEnd = fromAt < 0 ? toks.length : fromAt;
  exec.hostVariables = [];
  for (let k = 0; k + 1 < toks.length; k++) {
    if (!(toks[k].t === 'op' && toks[k].v === ':' && toks[k + 1].t === 'word')) continue;
    const path = [toks[k + 1]];
    for (let j = k + 2; j + 1 < toks.length && toks[j].t === 'period' && toks[j].joined && toks[j + 1].t === 'word'; j += 2) path.push(toks[j + 1]);
    const name = path[path.length - 1];
    name.verb = 'EXEC SQL';
    refs.push({ tok: name, zone: 'sql' });
    for (let q = path.length - 2; q >= 0; q--) refs.push({ tok: { t: 'word', u: 'OF', line: name.line, file: name.file }, zone: 'sql' }, { tok: path[q], zone: 'sql' });
    const written = into >= 0 && k > into && k < intoEnd;
    if (written) receiving.set(name, 'EXEC SQL');
    exec.hostVariables.push({ tok: name, written });
  }
}

// An EXEC CICS command's option arguments are references to the program's data, written where the
// option receives by IBM's direction for that command (lib/cics-commands.mjs); a literal, LENGTH OF,
// FUNCTION or DFHRESP(...) is only sent. RECEIVE MAP without INTO writes the map's input record and
// SEND MAP without FROM reads its output one, as the translator names them.
function cicsArgumentRefs(exec, refs, receiving) {
  const toks = exec.toks;
  const options = [];
  for (let k = 0; k < toks.length; k++) {
    if (toks[k].t !== 'word') continue;
    if (!(toks[k + 1] && toks[k + 1].t === 'sep' && toks[k + 1].v === '(')) { options.push({ word: toks[k].u }); continue; }
    let depth = 0;
    let e = k + 1;
    for (; e < toks.length; e++) if (toks[e].t === 'sep' && (depth += toks[e].v === '(' ? 1 : -1) === 0) break;
    options.push({ word: toks[k].u, args: toks.slice(k + 2, e) });
    k = e;
  }
  const name = cicsCommand(options);
  const command = name && CICS_COMMANDS[name];
  for (const o of options.slice(1)) {
    if (!o.args || !o.args.length) continue;
    const direction = command ? (command.options[o.word] || CICS_EVERY_COMMAND[o.word] || command.anyOption) : null;
    const first = o.args[0];
    if (direction === 'label' || first.t !== 'word' || /^DFH(RESP|VALUE)$/.test(first.u) || first.u === 'FUNCTION') continue;
    const computed = first.u === 'LENGTH' && o.args[1] && o.args[1].u === 'OF';
    for (const x of o.args) if (x.t === 'word') { x.verb = 'EXEC CICS'; refs.push({ tok: x, zone: 'cics' }); }
    if (!computed && (direction === 'receives' || direction === 'both')) receiving.set(first, 'EXEC CICS');
  }
  const given = new Set(options.map((o) => o.word));
  for (const [option, d] of Object.entries(command?.defaults || {})) {
    const map = options.find((o) => o.word === d.name)?.args;
    if (!map || map.length !== 1 || map[0].t !== 'lit' || given.has(option) || d.unless.some((w) => given.has(w))) continue;
    const tok = { t: 'word', v: `${map[0].v}${d.suffix}`, u: `${map[0].v}${d.suffix}`.toUpperCase(), line: exec.line, file: exec.file, verb: 'EXEC CICS' };
    refs.push({ tok, zone: 'cics' });
    if (command.options[option] === 'receives') receiving.set(tok, 'EXEC CICS');
  }
}

function unresolvedReferences(prog, declared, defines, sql) {
  const fromItems = new Set(prog.items.flatMap((it) => it.refsInData));
  const out = [];
  for (let i = 0; i < prog.refs.length; i++) {
    const { tok, zone } = prog.refs[i];
    if (zone === 'env' || zone === 'sql' || zone === 'cics' || (zone === 'data' && !fromItems.has(tok)) || prog.resolved.has(tok)) continue;
    const u = tok.u;
    const prev = prog.refs[i - 1];
    // A word without a letter is a number or a paragraph number, or bytes an encoding left behind.
    if (u === 'OF' || u === 'IN' || (prev && NOT_A_NAME_AFTER.has(prev.tok.u)) || !/[A-Z]/.test(u)) continue;
    if (declared.has(u) || defines.has(u) || PREDEFINED.has(u)) continue;
    if (RESERVED_WORDS.has(u) || SPECIAL_REGISTERS.has(u) || SYSTEM_NAMES.has(u) || INTRINSIC_FUNCTIONS.has(u)) continue;
    // A context-sensitive word, a compiler-directive word and an exception-condition name are not
    // reserved, so a program may use one as its own data name. This check cannot tell which construct
    // it is in, so it credits all three: naming a word the program never declared is the claim being
    // made here, and these are words the program did not have to declare.
    if (CONTEXT_SENSITIVE_WORDS.has(u) || DIRECTIVE_WORDS.has(u) || EXCEPTION_CONDITIONS.has(u)) continue;
    if (u.startsWith('DFH') || EIB_FIELDS.has(u) || DIB_FIELDS.has(u) || (sql && SQLCA_FIELDS.has(u))) continue;
    out.push({ name: u, file: tok.file, line: tok.line });
  }
  return out;
}

// A >>DEFINE inside a copybook can decide a >>IF in the file that copies it, but copybooks are only
// expanded after the file is normalized. Read the defines from every copybook the file names first.
function collectCopybookDefines(src, format, ctx, depth) {
  if (depth > 8) return;
  const seen = ctx.defineScan || (ctx.defineScan = new Set());
  let current = format;
  for (const raw of src.split(/\r?\n/)) {
    const l = expandTabs(raw);
    const sw = /(?:^|\s)>>\s*SOURCE\s+(?:FORMAT\s+)?(?:IS\s+)?(FREE|FIXED|VARIABLE|TERMINAL)/i.exec(l);
    if (sw) { current = sw[1].toLowerCase(); continue; }
    if (current !== 'free' && current !== 'terminal' && l.length > 6 && '*/'.includes(l[6])) continue;
    const code = l.replace(/\*>.*$/, '');
    const m = /(?:^|[\s.])COPY\s+("[^"]+"|'[^']+'|[A-Za-z0-9_-]+)/i.exec(code);
    if (!m) continue;
    const name = m[1].replace(/^["']|["']$/g, '');
    const path = resolveCopy(name, null, ctx);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const text = readSource(path).text;
    const fmt = detectFormat(text) === 'terminal' && ctx.copyFormat === 'auto' ? 'terminal' : current;
    normalize(text, fmt, ctx.defines, ctx.std);
    collectCopybookDefines(text, fmt, ctx, depth + 1);
  }
}

// A paragraph or section header in Area A of the procedure division ends the sentence before it,
// period or not ("optional period used"): in variable form under any dialect, and in fixed form under
// these, as cobc reads each. The period is supplied, so every reader of the tokens sees the sentence end.
const OPTIONAL_PERIOD = new Set(['ibm', 'ibm-strict', 'mvs', 'mvs-strict', 'rm', 'rm-strict', 'bs2000', 'gcos', 'realia']);
function supplyHeaderPeriods(tokens, fixedToo) {
  const out = [];
  let inProcedure = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t.t === 'word' && next && next.u === 'DIVISION') inProcedure = t.u === 'PROCEDURE';
    const header = inProcedure && t.t === 'word' && t.areaA && (t.fmt === 'variable' || (fixedToo && t.fmt === 'fixed')) && next
      && (next.t === 'period' || (next.t === 'word' && next.u === 'SECTION'))
      && !VERBS.has(t.u) && !NOT_LABELS.has(t.u) && !SCOPE_TERMINATORS.has(t.u);
    if (header && out.length && out[out.length - 1].t !== 'period') out.push(tok('period', '.', t.line, t.file, { implied: true, fmt: t.fmt }));
    out.push(t);
  }
  return out;
}

export function parseSource(src, file, opts = {}) {
  const format = opts.format && opts.format !== 'auto' ? opts.format : detectFormat(src);
  const scheme = BINARY_SIZE[opts.std || 'default'] || BINARY_SIZE.default;
  const ctx = { mainDir: opts.mainDir || dirname(file), includeDirs: opts.includeDirs || [], systemDirs: opts.systemDirs || [],
    fileIndex: opts.fileIndex || null, allowAbsoluteCopy: !!opts.allowAbsoluteCopy, cache: new Map(), copies: [], diags: [], copyFormat: opts.copyFormat || format, defines: new Map(), std: opts.std,
    inclusions: 0, copyTokens: 0, replacedGrowth: 0, replacedChars: 0 };
  collectCopybookDefines(src, format, ctx, 0);
  const norm = normalize(src, format, ctx.defines, opts.std);
  ctx.mainFormat = norm.finalFormat;
  const { tokens: raw, diags } = tokenize(norm, file);
  ctx.diags.push(...norm.diags.map(d => ({ ...d, file })), ...diags);
  const expanded = stripDirecting(applyReplaceStatements(expand(raw, ctx, [resolve(file)], norm.finalFormat), ctx));
  const tokens = supplyHeaderPeriods(expanded, OPTIONAL_PERIOD.has(opts.std));
  const starts = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t.t === 'word' && (t.u === 'IDENTIFICATION' || t.u === 'ID') && tokens[i + 1].u === 'DIVISION') starts.push(i);
    else if (t.t === 'word' && (t.u === 'PROGRAM-ID' || t.u === 'FUNCTION-ID') && !(starts.length && i - starts[starts.length - 1] <= 3)) {
      const prevStart = starts[starts.length - 1];
      const hasProc = prevStart !== undefined && tokens.slice(prevStart, i).some((x, k, arr) => x.u === 'PROCEDURE' && arr[k + 1] && arr[k + 1].u === 'DIVISION');
      if (prevStart === undefined || hasProc) starts.push(i);
    }
  }
  // Micro Focus lets a program open at its environment or data division with no header at all, and
  // the compiler reads it as one program named for its file. A copybook has no procedure division.
  let unnamed = null;
  if (!starts.length && tokens.some((t, i) => t.u === 'PROCEDURE' && tokens[i + 1] && tokens[i + 1].u === 'DIVISION')) {
    starts.push(0);
    unnamed = basename(file).replace(/\.[^.]*$/, '').toUpperCase();
  }
  const programs = [];
  for (let k = 0; k < starts.length; k++) {
    let end = k + 1 < starts.length ? starts[k + 1] : tokens.length;
    for (let i = starts[k]; i < end - 1; i++) if (tokens[i].u === 'END' && (tokens[i + 1].u === 'PROGRAM' || tokens[i + 1].u === 'FUNCTION')) { end = i; break; }
    const prog = parseProgram(tokens, starts[k], end, scheme, ctx.defines, opts.hostVariables !== false);
    if (!prog.id && unnamed) prog.id = unnamed;
    programs.push(prog);
  }
  // A nested program sees what its container declares GLOBAL, and the parse does not record which
  // those are, so a name any program in the source declares counts for all of them.
  const declared = new Set(programs.flatMap((p) => [...declaredNames(p)]));
  const sqlca = ctx.copies.some((c) => /^SQLCA$/i.test(c.name));
  for (const p of programs) p.unresolvedRefs = unresolvedReferences(p, declared, ctx.defines, sqlca || p.execs.some((e) => e.kind === 'SQL'));
  return { file, format, finalFormat: norm.finalFormat, options: norm.options, programs, copies: ctx.copies, diags: ctx.diags, tokenCount: tokens.length };
}

export function parseFile(file, opts = {}) {
  return parseSource(readSource(file).text, file, opts);
}
