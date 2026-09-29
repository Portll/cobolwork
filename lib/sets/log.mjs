// SPDX-License-Identifier: AGPL-3.0-or-later
// What a program writes into a log, judged by what the field is called.
//
// A log is read by people who were never entitled to the record. CWE-532 is the eighth most
// published weakness in the mainframe advisory record this project swept, and the sibling in a
// customer's own COBOL is a DISPLAY of the field the program was trusted with.
//
// This is the half of N-LOG that needs no taint: a field named PASSWORD reaching SYSOUT is a defect
// wherever it appears and whatever reached it, which is what `construct` evidence means here. The
// other half - input reaching a log unescaped so CR/LF can forge a line, and a RESP or SQLCODE
// reaching a web response - is a pair of sinks on the flow engine and lives there.
//
// The whole rule is the matcher, and the matcher is why this file exists rather than a regex. A
// COBOL name is hyphen-delimited, and a token only counts as a whole component. Measured over the
// corpus, a substring match scored six hits of which four were COMPANY-NAME and
// SS-COMPANY-LIABILITY-DATA, both matched on PAN inside COMPANY. A 67% false-positive rate from a
// pattern that read as obviously correct.
import { inScope, isProgram, relPath } from '../sources.mjs';
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
};

// Words that, standing alone as a component of a name, say what the field holds. Kept narrow on
// purpose: these are the words a maintenance programmer chooses when the field really is one of
// these things, and the rule's error rate is the rate at which they choose them for something else.
const SECRET = new Set(['PASSWORD', 'PASSWORDS', 'PASSWD', 'PASSWRD', 'PSWD', 'PWD', 'SECRET',
  'APIKEY', 'TOKEN', 'CREDENTIAL', 'CREDENTIALS', 'PASSPHRASE', 'PIN']);
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
  if (parts.some((p) => SECRET.has(p))) return 'credential';
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
    // Everything from UPON onwards names the destination, not the value. The parser hands both
    // back as operands, so a DISPLAY UPON CONSOLE offers CONSOLE as though it were a field, and a
    // mnemonic named after one of the words below would be judged instead of what was displayed.
    for (const tok of s.sources || []) {
      if (tok.t === 'word' && tok.u === 'UPON') break;
      if (tok.t === 'word') out.push({ kind: 'DISPLAY', name: tok.u, ...where(tok, path) });
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

export function scanLog(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isProgram).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0, logWrites: 0, sensitiveWrites: 0 };
  const where = (x, path) => ({ path: x.file ? relPath(root, x.file) : path, line: x.line || 1 });

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
        // One finding per field per program: the fix is the same edit wherever it is repeated.
        const key = `${p.id}:${w.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        stats.sensitiveWrites++;
        findings.push({
          rule: kind === 'credential' ? 'log-writes-a-credential' : 'log-writes-personal-data',
          path: w.path, line: w.line, program: p.id,
          detail: `${p.id} writes ${w.name} with ${w.kind}, and its name says it holds ${kind === 'credential' ? 'a credential' : 'personal data'}`,
        });
      }
    }
    r = null;
    return src.length;
  }, { label: 'log', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('log', { rules: LOG_RULES, findings, stats, run });
}
