// SPDX-License-Identifier: AGPL-3.0-or-later
// What a program writes into a log, judged by what the field is called and declared as.
//
// A log is read by people who were never entitled to the record. CWE-532 is the eighth most
// published weakness in the mainframe advisory record this project swept, and the sibling in a
// customer's own COBOL is a DISPLAY of the field the program was trusted with.
//
// This is the half of N-LOG that needs no taint: a field named PASSWORD reaching SYSOUT is a defect
// wherever it appears, which is what `construct` evidence means here. Two things within the one
// program set a write aside: a value the person at the terminal typed, shown back to them, and a
// CGI program's standard output, which is its HTTP response. The other half - input reaching a log
// unescaped so CR/LF can forge a line, and a RESP or SQLCODE reaching a web response - is a pair of
// sinks on the flow engine and lives there.
//
// The whole rule is the matcher, and the matcher is why this file exists rather than a regex. A
// COBOL name is hyphen-delimited, and a token only counts as a whole component. Measured over the
// corpus, a substring match scored six hits of which four were COMPANY-NAME and
// SS-COMPANY-LIABILITY-DATA, both matched on PAN inside COMPANY. A 67% false-positive rate from a
// pattern that read as obviously correct.
import { basename, extname } from 'node:path';
import { inScope, isJcl, isProgram, relPath } from '../sources.mjs';
import { parseJcl } from '../jcl.mjs';
import { compileStepOptions } from '../options.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';


export const LOG_RULES = {
  'log-writes-a-credential': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-532',
    text: 'A program writes a field named as a credential into a log',
    impact: 'A field named as a credential is written to a log, where people the record was never for can read it',
    remedy: 'Do not log credential-shaped fields; mask or omit them before DISPLAY or any journal/log write',
  },
  'log-writes-personal-data': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-532',
    text: 'A program writes a field named as personal data into a log',
    impact: 'A field named as personal data is written to a log, exposing it to everyone who can read the log',
    remedy: 'Do not log personal-data fields; mask, tokenize or omit them before the log write',
  },
  // Not a log: the terminal of the person who typed it, or the response to the request that posted
  // it. Still exposure, so reported, and below the tier a build refuses.
  'display-echoes-a-credential': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-200',
    text: 'A program displays a credential back to the terminal or HTTP request that supplied it',
    impact: 'A credential shown back to whoever supplied it can be read off the screen and its scrollback, or out of a proxy, cache or browser history that keeps the response',
    remedy: 'Acknowledge the credential without repeating it, or mask it before it is displayed',
  },
};

// Words that, standing alone as a component of a name, say what the field holds. Kept narrow on
// purpose: these are the words a maintenance programmer chooses when the field really is one of
// these things, and the rule's error rate is the rate at which they choose them for something else.
const SECRET = new Set(['PASSWORD', 'PASSWORDS', 'PASSWD', 'PASSWRD', 'PSWD', 'PWD', 'SECRET',
  'APIKEY', 'TOKEN', 'CREDENTIAL', 'CREDENTIALS', 'PASSPHRASE', 'PIN']);
// Components that say the field holds something about a credential: a message about it, whether it
// is valid, how long it is or how many there are.
const ABOUT = new Set(['PROMPT', 'MSG', 'MESSAGE', 'ERROR', 'ERR', 'VALID', 'INVALID', 'FLAG', 'SW', 'SWITCH',
  'COUNT', 'CNT', 'CTR', 'LEN', 'LENGTH', 'ATTEMPTS', 'TRIES']);
// Ordinary programming words that are credentials only in authentication: a lexer's token, a language
// model's token count. The log rule asks for a word from QUALIFIER or for where the value came from.
const HOMONYM = new Set(['TOKEN']);
const QUALIFIER = new Set(['AUTH', 'ACCESS', 'BEARER', 'API', 'SESSION', 'REFRESH', 'OAUTH', 'JWT', 'SSO',
  'LOGIN', 'LOGON', 'SIGNON', 'SECURITY']);
const PERSONAL = new Set(['SSN', 'NINO', 'DOB', 'CVV', 'CVC', 'PAN', 'IBAN', 'SALARY', 'TAXID']);
// Components that mean nothing alone and something together. CARD is a card game, NUM is a number;
// CARD-NUM is a card number.
//
// ACCT-NO is deliberately absent, and it is the most expensive thing measured here. Over the corpus
// it matched 83 of the 90 personal-data hits, every one of them a general-ledger account:
// DED-FICA-ACCT-NO, DED-CO-SUI-ACCT-NO, DED-FWT-ACCT-NO. An account number in COBOL is
// overwhelmingly a chart-of-accounts code, not a person's bank account, and including it made the
// rule 92% wrong on the only repository that exercised it.
const PAIRS = [['CARD', 'NUM'], ['CARD', 'NUMBER'],
  ['SOC', 'SEC'], ['SOCIAL', 'SECURITY'], ['BIRTH', 'DATE'], ['BIRTH', 'DT'], ['SORT', 'CODE'], ['TAX', 'ID']];
// A name that says the value has already been made safe. Masking is the fix, so a masked field is
// not the defect, and a rule that reported it would train its reader to ignore it.
const SAFE = new Set(['MASK', 'MASKED', 'HASH', 'HASHED', 'ENCRYPTED', 'REDACTED', 'LAST4', 'SUFFIX', 'TRUNC', 'TRUNCATED']);

export function classify(name) {
  const parts = String(name).toUpperCase().split('-').filter(Boolean);
  if (parts.some((p) => SAFE.has(p))) return null;
  const set = new Set(parts);
  if (parts.some((p) => SECRET.has(p))) return parts.some((p) => ABOUT.has(p)) ? null : 'credential';
  if (parts.some((p) => PERSONAL.has(p))) return 'personal';
  for (const pair of PAIRS) if (pair.every((w) => set.has(w))) return 'personal';
  return null;
}

// Where a value leaves the program for somewhere a person reads later. WRITEQ TS is deliberately
// absent: a temporary-storage queue is working state a program reads back, and calling it a log
// would put the whole pseudo-conversational idiom in scope.
function logSinks(p, where, path) {
  const out = [];
  for (const s of p.statements || []) {
    if (s.verb !== 'DISPLAY') continue;
    const plain = !(s.sources || []).some((tok) => tok.t === 'word' && tok.u === 'UPON');
    const cookie = (s.literals || []).some((l) => /^\s*set-cookie\s*:/i.test(String(l.v)));
    // Everything from UPON onwards names the destination, not the value. The parser hands both
    // back as operands, so a DISPLAY UPON CONSOLE offers CONSOLE as though it were a field, and a
    // mnemonic named after one of the words below would be judged instead of what was displayed.
    for (const tok of s.sources || []) {
      if (tok.t === 'word' && tok.u === 'UPON') break;
      if (tok.t === 'word') out.push({ kind: 'DISPLAY', name: tok.u, tok, plain, cookie, ...where(tok, path) });
    }
  }
  for (const e of p.execs || []) {
    if (e.kind !== 'CICS') continue;
    const w = e.toks.filter((t) => t.t === 'word').map((t) => t.u);
    const isTd = w[0] === 'WRITEQ' && w[1] === 'TD';
    const isJournal = w[0] === 'WRITE' && w.includes('JOURNALNAME');
    // The console, read by whoever is watching the region. A credential on it is as exposed as one
    // in SYSOUT, and it outlives the screen in the system log.
    const isOperator = w[0] === 'WRITE' && w[1] === 'OPERATOR';
    if (!isTd && !isJournal && !isOperator) continue;
    // FROM names the area written, TEXT names the console message; that name is what this reads.
    const opt = isOperator ? 'TEXT' : 'FROM';
    const i = e.toks.findIndex((t) => t.t === 'word' && t.u === opt);
    const arg = i >= 0 ? e.toks.slice(i + 1).find((t) => t.t === 'word') : null;
    const kind = isTd ? 'WRITEQ TD' : isOperator ? 'WRITE OPERATOR' : 'WRITE JOURNALNAME';
    if (arg) out.push({ kind, name: arg.u, ...where(e, path) });
  }
  return out;
}

const words = (s) => (s.sources || []).filter((t) => t.t === 'word').map((t) => t.u);
const FIGURATIVE = new Set(['TO', 'ALL', 'SPACE', 'SPACES', 'ZERO', 'ZEROS', 'ZEROES', 'LOW-VALUE', 'LOW-VALUES',
  'HIGH-VALUE', 'HIGH-VALUES', 'QUOTE', 'QUOTES', 'NULL', 'NULLS']);
const CREDENTIAL_TEXT = /pass|pwd|\bpin\b|token|secret|api.?key|cred/i;
const CICS_CREDENTIAL = new Set(['PASSWORD', 'NEWPASSWORD', 'PASSPHRASE', 'NEWPASSPHRASE', 'PASSTICKET']);

const rootOf = (it) => { let r = it; while (r.parent) r = r.parent; return r; };
const inTable = (it) => { for (let x = it; x; x = x.parent) if ((x.occurs || 1) > 1 || x.dependingOn) return true; return false; };
function baseOf(p, root) {
  const seen = new Set();
  let r = root;
  while (r.redefines && !seen.has(r)) {
    seen.add(r);
    const t = p.items.find((x) => !x.parent && x.name === r.redefines && x.section === r.section);
    if (!t) break;
    r = t;
  }
  return r;
}
// Whether two items share bytes: the same record or a redefinition of it, at offsets that meet.
function overlaps(p, a, b) {
  if (a === b) return true;
  if (baseOf(p, rootOf(a)) !== baseOf(p, rootOf(b))) return false;
  if (inTable(a) || inTable(b) || a.offset == null || b.offset == null) return true;
  return a.offset < b.offset + (b.size || 0) && b.offset < a.offset + (a.size || 0);
}

// Every statement that can put a value into the item's bytes, with the statement before it.
function storesInto(p, item) {
  const hits = (tok) => { const t = p.resolved.get(tok); return !!t && t.level !== 88 && !!t.section && overlaps(p, t, item); };
  const st = p.statements || [];
  const out = [];
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    const byReference = s.verb === 'CALL' && (s.sources || []).some(hits);
    if (byReference || (s.targets || []).some(hits)) out.push({ s, prev: st[i - 1] });
  }
  return out;
}
const sharing = (p, item) => p.items.filter((x) => x.level !== 88 && overlaps(p, x, item));
const namesOf = (items) => new Set(items.filter((x) => x.name !== 'FILLER').map((x) => x.name));

const prompted = (prev) => prev && prev.verb === 'DISPLAY' && (prev.literals || []).length > 0;
const fromTerminal = (s, prev) => s.verb === 'ACCEPT' && !words(s).includes('FROM')
  && (words(s).includes('SECURE') || words(s).includes('NO-ECHO') || prompted(prev));
const blank = (v) => (v.t === 'lit' ? String(v.v).trim() === ''
  : v.t === 'word' && (FIGURATIVE.has(v.u) || v.u === 'IS' || /^[+-]?[0.]+$/.test(v.u)));
const inPlace = (s) => s.verb === 'INSPECT' || s.verb === 'INITIALIZE'
  || (s.verb === 'MOVE' && [...(s.sources || []), ...(s.literals || [])].every(blank));

// Whether everything the item can hold was typed at this program's terminal, so a plain DISPLAY of
// it shows the person at the terminal what they typed.
function typedHere(p, item) {
  if (!['WORKING-STORAGE', 'LOCAL-STORAGE'].includes(item.section)) return false;
  const shared = sharing(p, item);
  if (shared.some((x) => (x.values || []).some((v) => !blank(v)))) return false;
  const names = namesOf(shared);
  if ((p.execs || []).some((e) => e.toks.some((t) => t.t === 'word' && names.has(t.u)))) return false;
  const stores = storesInto(p, item);
  return stores.some(({ s, prev }) => fromTerminal(s, prev))
    && stores.every(({ s, prev }) => fromTerminal(s, prev) || inPlace(s));
}

// Where a value came from that only a credential comes from: a credential-named environment variable,
// a masked or credential-prompted terminal entry, a CICS command that takes a credential, or a file
// named as holding credentials.
function sourcedAsCredential(p, item) {
  for (const { s, prev } of storesInto(p, item)) {
    if (s.verb !== 'ACCEPT') continue;
    const w = words(s);
    if (w.includes('ENVIRONMENT') && (s.literals || []).some((l) => CREDENTIAL_TEXT.test(l.v))) return true;
    if (w.includes('ENVIRONMENT-VALUE') && prev && (prev.literals || []).some((l) => CREDENTIAL_TEXT.test(l.v))) return true;
    if (!w.includes('FROM') && (w.includes('SECURE') || w.includes('NO-ECHO'))) return true;
    if (!w.includes('FROM') && prompted(prev) && prev.literals.some((l) => CREDENTIAL_TEXT.test(l.v))) return true;
  }
  const names = namesOf(sharing(p, item));
  for (const e of p.execs || []) {
    if (e.kind !== 'CICS') continue;
    const t = e.toks;
    const verb = (t.find((x) => x.t === 'word') || {}).u;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i].t !== 'word' || (t[i + 1].v ?? t[i + 1].u) !== '(') continue;
      const takes = CICS_CREDENTIAL.has(t[i].u) || (t[i].u === 'TOKEN' && (verb === 'SIGNON' || verb === 'VERIFY'));
      if (takes && names.has(t[i + 2].u)) return true;
    }
  }
  const fd = rootOf(item).fd;
  if (item.section === 'FILE' && fd) {
    const f = (p.files || []).find((x) => x.name === fd.name);
    const assigned = f && f.assign ? String(f.assign.v ?? f.assign.u ?? '') : '';
    if (CREDENTIAL_TEXT.test(fd.name) || CREDENTIAL_TEXT.test(assigned)) return true;
  }
  return false;
}

const expand = (pic) => String(pic).toUpperCase().replace(/(.)\((\d+)\)/g, (_, c, n) => c.repeat(Math.min(Number(n), 256)));
const NUMERIC_USAGE = /^(COMP(UTATIONAL)?-[12]|FLOAT|INDEX|POINTER|PROGRAM-POINTER|PROCEDURE-POINTER)/;
// Digits a numeric field holds, or null for text or a group.
function digitsOf(item) {
  if (item.picture) {
    const pic = expand(item.picture);
    return /[XANGU]/.test(pic) ? null : (pic.match(/[9Z*]/g) || []).length;
  }
  return item.usage && NUMERIC_USAGE.test(String(item.usage).toUpperCase()) ? 0 : null;
}

// Whether a field whose name says credential holds one. A numeric field holds a count, a length or a
// computed answer; the one numeric credential is a PIN, which has at least four digits.
function holdsCredential(p, item, name) {
  const parts = String(name).toUpperCase().split('-').filter(Boolean);
  if (item) {
    const digits = digitsOf(item);
    if (digits !== null && !(parts.includes('PIN') && digits >= 4)) return false;
  }
  const onlyHomonyms = parts.every((x) => !SECRET.has(x) || HOMONYM.has(x));
  if (onlyHomonyms && !parts.some((x) => QUALIFIER.has(x)) && !(item && sourcedAsCredential(p, item))) return false;
  return true;
}

function itemFor(p, w) {
  if (w.tok) return p.resolved.get(w.tok) || null;
  const named = p.items.filter((x) => x.name === w.name && x.level !== 88);
  return named.length === 1 ? named[0] : null;
}

// A program that writes a Content-Type header on standard output is a CGI program: its plain DISPLAY
// is the HTTP response, and its standard input and request variables are the request.
const isCgi = (p) => (p.statements || []).some((s) => s.verb === 'DISPLAY'
  && (s.literals || []).some((l) => /^\s*content-type\s*:/i.test(String(l.v))));
const REQUEST_NAME = /^(QUERY_STRING|PATH_INFO|REQUEST_[A-Z_]+|CONTENT_[A-Z_]+|HTTP_[A-Z0-9_]+|POST|GET)$/i;
const literalsOf = (s) => (s.literals || []).map((l) => String(l.v).trim());

// Whether a CALL reads the request: a request variable or method is named in the call, or moved
// into one of the areas it is passed.
function callReadsRequest(p, call) {
  if (literalsOf(call).slice(1).some((v) => REQUEST_NAME.test(v))) return true;
  const args = (call.sources || []).map((t) => p.resolved.get(t)).filter((x) => x && x.section && x.level !== 88);
  return (p.statements || []).some((s) => s.verb === 'MOVE' && literalsOf(s).some((v) => REQUEST_NAME.test(v))
    && (s.targets || []).some((t) => { const to = p.resolved.get(t); return to && args.some((a) => overlaps(p, a, to)); }));
}

// Whether the item's value came from the HTTP request, traced back through the moves that fill it.
// Anything that could have put a stored value there instead - a file, a database, another
// environment variable, a routine not reading the request - leaves the answer no.
function fromRequest(p, item) {
  const seen = new Set();
  const queue = [item];
  let request = false;
  while (queue.length) {
    const it = queue.shift();
    if (seen.has(it)) continue;
    if (seen.size >= 64 || it.section === 'FILE' || it.section === 'LINKAGE') return false;
    seen.add(it);
    const names = namesOf(sharing(p, it));
    if ((p.execs || []).some((e) => e.toks.some((t) => t.t === 'word' && names.has(t.u)))) return false;
    for (const { s, prev } of storesInto(p, it)) {
      const w = words(s);
      if (s.verb === 'ACCEPT') {
        const named = w.includes('ENVIRONMENT') ? literalsOf(s)[0]
          : w.includes('ENVIRONMENT-VALUE') && prev && prev.verb === 'DISPLAY' ? literalsOf(prev)[0] : null;
        if (!w.includes('FROM') || (named && REQUEST_NAME.test(named))) { request = true; continue; }
        return false;
      }
      if (s.verb === 'CALL') { if (callReadsRequest(p, s)) { request = true; continue; } return false; }
      if (!['MOVE', 'STRING', 'UNSTRING', 'INSPECT', 'INITIALIZE'].includes(s.verb)) return false;
      for (const t of s.sources || []) {
        const from = p.resolved.get(t);
        if (from && from.section && from.level !== 88) queue.push(from);
      }
    }
  }
  return request;
}

// The programs a job in the repository runs, by the name a step gives, and the members it compiles,
// which are z/OS batch programs whatever their ACCEPT reads. `unsure` when a job or a procedure
// could run a program nothing here names: a file that would not parse, or a symbolic PGM= no
// caller fills.
function batchPrograms(tree) {
  const runs = new Set();
  let unsure = false;
  const parsed = [];
  for (const f of tree.list().filter(isJcl)) {
    try { parsed.push(parseJcl(tree.text(f).text, f)); } catch { unsure = true; }
  }
  const symbolsOf = new Map();
  for (const j of parsed) for (const proc of j.procs || []) {
    for (const s of proc.steps) if (!s.pgm && s.pgmSymbol) symbolsOf.set(String(proc.name).toUpperCase(), [...(symbolsOf.get(String(proc.name).toUpperCase()) || []), s.pgmSymbol]);
  }
  const filled = new Set();
  for (const j of parsed) for (const s of j.steps || []) {
    if (s.pgm) runs.add(s.pgm.toUpperCase());
    else if (s.pgmSymbol && !s.inProc) unsure = true;
    for (const sym of symbolsOf.get(String(s.proc || '').toUpperCase()) || []) {
      const v = s.keywords && s.keywords.get(sym);
      if (v) { runs.add(String(v).replace(/^'|'$/g, '').toUpperCase()); filled.add(sym); }
    }
    if (/^IKJEFT(01|1A|1B)$/i.test(s.pgm || '')) {
      for (const dd of s.dds || []) for (const l of dd.inStream || []) {
        const m = /\bRUN\s+PROGRAM\s*\(\s*([A-Z0-9$#@]{1,8})\s*\)/i.exec(l.text);
        if (m) runs.add(m[1].toUpperCase());
      }
    }
  }
  for (const syms of symbolsOf.values()) if (syms.some((sym) => !filled.has(sym))) unsure = true;
  try { for (const c of compileStepOptions(parsed)) runs.add(c.member); } catch { unsure = true; }
  return { runs, unsure };
}

const memberOf = (file) => basename(String(file || ''), extname(String(file || ''))).toUpperCase();
const runByJob = (batch, p, file) => batch.unsure
  || [String(p.id || '').toUpperCase(), memberOf(file)].some((n) => n && (batch.runs.has(n) || batch.runs.has(n.slice(0, 8))));

export function scanLog(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isProgram).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0, logWrites: 0, sensitiveWrites: 0 };
  const where = (x, path) => ({ path: x.file ? relPath(root, x.file) : path, line: x.line || 1 });
  let batch = null;

  // How a plain DISPLAY of a credential is reported: at the high tier as a log write, at the low
  // tier as a credential shown back to whoever supplied it, or not at all where a CGI program issues
  // a session token in a Set-Cookie header. Every other DISPLAY is a log write.
  const judge = (p, w, item, f) => {
    if (!w.plain || !item) return { rule: 'log-writes-a-credential' };
    const parts = String(w.name).toUpperCase().split('-');
    if (isCgi(p)) {
      if (w.cookie && parts.every((x) => !SECRET.has(x) || HOMONYM.has(x))) return null;
      if (fromRequest(p, item)) {
        return { rule: 'display-echoes-a-credential', detail: `${p.id} puts ${w.name}, which the request posted, into its HTTP response: not a log, but proxies, caches and browser history keep what a response carries` };
      }
      return { rule: 'log-writes-a-credential' };
    }
    if (!typedHere(p, item)) return { rule: 'log-writes-a-credential' };
    batch ||= batchPrograms(tree);
    if (runByJob(batch, p, f)) return { rule: 'log-writes-a-credential' };
    return { rule: 'display-echoes-a-credential', detail: `${p.id} shows ${w.name} on the terminal to the person who typed it: not a log, but the screen and its scrollback keep it` };
  };

  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    // Every EXEC CICS WRITE form, not the two this set started with. WRITE OPERATOR was added as a
    // sink and this line was not, so a program whose only sink was the console was skipped before
    // filesScanned counted it, and the set reported nosrc: a clean result over source nobody read.
    if (!/\bDISPLAY\b/i.test(src) && !/EXEC\s+CICS\s+WRITE/i.test(src)) return src.length;
    let r;
    try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    const path = relPath(root, f);

    for (const p of r.programs) {
      const seen = new Set();
      for (const w of logSinks(p, where, path)) {
        stats.logWrites++;
        const kind = classify(w.name);
        if (!kind) continue;
        const item = itemFor(p, w);
        if (kind === 'credential' && !holdsCredential(p, item, w.name)) continue;
        const verdict = kind === 'credential' ? judge(p, w, item, f) : { rule: 'log-writes-personal-data' };
        if (!verdict) continue;
        // One finding per field per program and rule: the fix is the same edit wherever it is repeated.
        const key = `${verdict.rule}:${p.id}:${w.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stats.sensitiveWrites++;
        findings.push({
          rule: verdict.rule,
          path: w.path, line: w.line, program: p.id,
          detail: verdict.detail || `${p.id} writes ${w.name} with ${w.kind}, and its name says it holds ${kind === 'credential' ? 'a credential' : 'personal data'}`,
        });
      }
    }
    r = null;
    return src.length;
  }, { label: 'log', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('log', { rules: LOG_RULES, findings, stats, run });
}
