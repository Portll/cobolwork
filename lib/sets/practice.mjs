// SPDX-License-Identifier: AGPL-3.0-or-later
// Best practices a repository misses: not security findings, so this set is outside the scan
// registry and runs for `cobolwork advise` alone. Each rule carries `class` beside the rule-set
// contract's keys, and its `how` is the practice's remedy.
//
// dead-code: paragraphs no run reaches (lib/practice-reach.mjs) and statements after an
// unconditional STOP RUN or GOBACK. unused-data: WORKING-STORAGE and LOCAL-STORAGE records the
// program declares and never names. options: the run-time checks the policy requires that no option
// level turns on, and programs compiled on defaults nobody declared. obsolete: the elements IBM's
// Language Reference lists as obsolete (lib/practice-obsolete.mjs).
import { basename, extname } from 'node:path';
import { inScope, isProgram, isJcl } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { drive, loopOver } from '../kernel/shared-pass.mjs';
import { loadSite } from '../site.mjs';
import { parseJcl } from '../jcl.mjs';
import { optionCards, enterpriseChecks, compileStepOptions } from '../options.mjs';
import { CHECKS, DEFAULT_POLICY, treePolicy } from '../policy.mjs';
import { execReading } from '../exec-reading.mjs';
import { reachOf } from '../practice-reach.mjs';
import { obsoleteIn } from '../practice-obsolete.mjs';

const OBSOLETE_REF = [{
  title: 'IBM Enterprise COBOL for z/OS 6.4 Language Reference: Obsolete language elements',
  url: 'https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=appendixes-obsolete-language-elements',
  section: 'Appendixes',
}];
const OPTIONS_REF = [
  { title: 'IBM Enterprise COBOL for z/OS 6.4 Programming Guide: SSRANGE' },
  { title: 'IBM Enterprise COBOL for z/OS 6.4 Programming Guide: NUMCHECK' },
  { title: 'IBM Enterprise COBOL for z/OS 6.4 Programming Guide: PARMCHECK' },
];

const obsolete = (sev, text, why, how, steps = []) => ({
  class: 'obsolete', sev, evidence: 'construct', cwe: 'CWE-477', text, why, how, steps, references: OBSOLETE_REF, measured: false,
});

export const PRACTICE_RULES = {
  'dead-code-paragraph': {
    class: 'dead-code', sev: 'low', evidence: 'construct', cwe: 'CWE-561',
    text: 'A paragraph or section that no run of the program reaches',
    why: 'Nothing performs it, goes to it, names it as a SORT or MERGE procedure or a USE procedure, and the code above it never falls into it, so it never runs: it is read, reviewed and changed to no effect, and a fix made there fixes nothing',
    how: 'Delete it, or add the PERFORM or GO TO that is missing if it is meant to run',
    steps: [
      'Search the repository and the copy libraries the build uses for the paragraph name, including CICS HANDLE, SQL WHENEVER and ALTER statements in copybooks the tree does not hold',
      'If nothing names it, delete the paragraph and any exit paragraph that only it used',
      'If it should run, add the PERFORM or GO TO at the point in the flow where it belongs',
    ],
    references: [], measured: false,
  },
  'dead-code-statements': {
    class: 'dead-code', sev: 'low', evidence: 'construct', cwe: 'CWE-561',
    text: 'Statements follow an unconditional STOP RUN or GOBACK in the same paragraph',
    why: 'Control never passes the STOP RUN or GOBACK and no paragraph header follows it, so the statements after it never run; a reader takes them for part of the program\'s ending',
    how: 'Delete the statements after the STOP RUN or GOBACK, or move them before it if they are meant to run',
    steps: [
      'Read what the statements were meant to do at the end of the run: closing files, writing totals, setting RETURN-CODE',
      'Move any that should run ahead of the STOP RUN or GOBACK and delete the rest',
    ],
    references: [], measured: false,
  },
  'unused-data-record': {
    class: 'unused-data', sev: 'info', evidence: 'construct', cwe: 'CWE-1164',
    text: 'A WORKING-STORAGE or LOCAL-STORAGE record that the program declares and never names',
    why: 'No statement, condition, USING, EXEC block, REDEFINES, RENAMES or OCCURS DEPENDING ON names the record or anything in it, so it holds storage and a reader\'s attention and does nothing',
    how: 'Delete the record, or, if another program or a debugger reads it, say so in a comment beside it',
    steps: [
      'Check the record is not shared with another program as EXTERNAL or through a copybook a nested program uses',
      'Delete the record and compile; a reference the scan could not see stops the compile with an undefined name',
    ],
    references: [], measured: false,
  },
  'options-check-off': {
    class: 'options', sev: 'low', evidence: 'context', cwe: null,
    text: 'A run-time check the policy requires is not turned on for a program',
    why: 'No CBL or PROCESS card, compile step or declared site default turns the compiler option on, so an out-of-range subscript, a bad numeric value or a short argument is not caught where it happens and the program carries on with whatever storage it reached',
    how: 'Turn the option on for the program: SSRANGE for subscripts and reference modification, NUMCHECK(ABD) for numeric data, PARMCHECK(ABD) for argument lengths',
    steps: [
      'Add the option to the estate\'s compile procedure, or to a CBL card at the top of the program',
      'Record the estate\'s defaults as compilerOptions in cobolwork.site.json so the check can see them',
      'Run the program\'s tests: a check that now abends shows where the program used storage it did not own',
    ],
    references: OPTIONS_REF, measured: false,
  },
  'options-undeclared': {
    class: 'options', sev: 'info', evidence: 'context', cwe: null,
    text: 'A program compiles on defaults nobody declared',
    why: 'It has no CBL or PROCESS card, no compile step the tree holds names it, and the site declares no compiler defaults, so how it is compiled is the installation default, which an installation can change from IBM\'s and the source cannot show',
    how: 'Declare the estate\'s compiler defaults as compilerOptions in cobolwork.site.json, or put the options the program depends on on a CBL card',
    steps: [
      'Take the options from the compile procedure the estate uses, or from a compile listing\'s options section',
      'Write them as compilerOptions in cobolwork.site.json',
    ],
    references: OPTIONS_REF, measured: false,
  },
  'obsolete-alter': obsolete('low',
    'An ALTER statement changes where a GO TO goes',
    'Which paragraph a GO TO reaches depends on which ALTER ran last, so the flow cannot be read from the source; IBM lists ALTER as obsolete, and it cannot be used in a RECURSIVE program, a method or under THREAD',
    'Replace the ALTER and the GO TO it changes with a field the paragraph tests, or a GO TO ... DEPENDING ON or EVALUATE that names each target',
    ['Find every ALTER naming the paragraph and the targets it sets', 'Give each target a value of a new field, set the field where the ALTER was, and branch on it where the GO TO is']),
  'obsolete-go-to-without-name': obsolete('low',
    'A GO TO names no procedure, so an ALTER decides where it goes',
    'The GO TO goes wherever the last ALTER sent it and abends if none has run; IBM lists GO TO without a procedure-name as obsolete',
    'Name the target in the GO TO, or replace the ALTER and GO TO pair with a field the paragraph tests'),
  'obsolete-enter': obsolete('low',
    'An ENTER statement',
    'Enterprise COBOL checks its syntax and ignores it, so it says another language runs here when nothing does; IBM lists it as obsolete',
    'Delete the ENTER statement'),
  'obsolete-identification-paragraph': obsolete('info',
    'An AUTHOR, INSTALLATION, DATE-WRITTEN, DATE-COMPILED or SECURITY paragraph',
    'Its comment entry is documentation the compiler does not check, and IBM lists these paragraphs as obsolete; DATE-COMPILED is replaced in the listing only, not in the source',
    'Move what it says into a comment line and delete the paragraph'),
  'obsolete-debugging-declarative': obsolete('low',
    'A USE FOR DEBUGGING declarative or a reference to DEBUG-ITEM',
    'Debugging sections, USE FOR DEBUGGING and the DEBUG-ITEM special register are obsolete, and they run only when the program is compiled WITH DEBUGGING MODE',
    'Remove the debugging section and its DEBUG-ITEM references, and debug with the compiler\'s TEST option or a debugger'),
  'obsolete-label-records': obsolete('low',
    'An FD or SD has a LABEL RECORDS clause',
    'Enterprise COBOL checks its syntax and it has no effect on the run; IBM lists it as obsolete',
    'Delete the clause; the DD statement\'s LABEL parameter says how a tape is labelled'),
  'obsolete-value-of': obsolete('low',
    'An FD has a VALUE OF clause',
    'Enterprise COBOL checks its syntax and it has no effect on the run; IBM lists it as obsolete',
    'Delete the clause; the data set the file reads is named by its DD statement'),
  'obsolete-data-records': obsolete('low',
    'An FD or SD has a DATA RECORDS clause',
    'Enterprise COBOL checks its syntax and it serves only as documentation of the record names; IBM lists it as obsolete',
    'Delete the clause; the record descriptions under the FD already name the records'),
  'obsolete-memory-size': obsolete('low',
    'An OBJECT-COMPUTER paragraph has a MEMORY SIZE clause',
    'Enterprise COBOL checks its syntax and it has no effect on the run; IBM lists it as obsolete',
    'Delete the clause'),
  'obsolete-multiple-file-tape': obsolete('low',
    'An I-O-CONTROL paragraph has a MULTIPLE FILE TAPE clause',
    'Enterprise COBOL checks its syntax and it has no effect on the run, the DD statement\'s LABEL parameter doing the work; IBM lists it as obsolete',
    'Delete the clause and keep the file positions on the DD statements'),
  'obsolete-rerun': obsolete('low',
    'An I-O-CONTROL paragraph has a RERUN clause',
    'The clause still takes checkpoint records, but IBM lists it as obsolete, and it cannot be used for EXTERNAL files, in RECURSIVE programs, in methods or under THREAD',
    'Take checkpoints the way the estate restarts jobs now, and delete the clause once nothing restarts from its records',
    ['Find whether any job restarts this program from a RERUN checkpoint', 'If none does, delete the clause and the checkpoint DD']),
  'obsolete-reversed': obsolete('low',
    'An OPEN statement opens a file REVERSED',
    'The phrase still positions a single-reel tape file at its end, but IBM lists it as obsolete',
    'Read the file forwards, or sort it into the order the program needs before it runs'),
  'obsolete-stop-literal': obsolete('low',
    'A STOP statement with a literal suspends the run for the operator',
    'The run waits for an operator reply on the console before it carries on, which a batch window or an unattended run does not give; IBM lists STOP literal as obsolete',
    'Write the message with DISPLAY and end or continue the run in the program, or set RETURN-CODE for the job to test'),
  'obsolete-segment-number': obsolete('low',
    'A section header carries a segment number',
    'Segmentation is obsolete; IBM still reads numbers 50 to 99 as independent segments whose procedures return to their initial state each time they are entered, which an ALTER there undoes silently, and segmentation is not supported under THREAD',
    'Remove the segment number from the section header'),
};

const SHOWN = 5;
const memberName = (file) => basename(file, extname(file)).toUpperCase();
// An Enterprise COBOL listing kept under a program's extension, whose page headers read as code.
const LISTING = /^[01 -]?PP \d{4}-[A-Z0-9]{3} IBM /m;
const PARSE_TROUBLE = new Set(['unterminated-exec', 'unterminated-literal', 'copy-without-period']);
// System copybooks a translator supplies; the parser takes their names as declared.
const SYSTEM_COPY_OK = (c) => c.status === 'resolved' || c.status === 'system';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const OBSOLETE_DETAIL = {
  'obsolete-alter': () => 'an ALTER statement changes where a GO TO goes',
  'obsolete-go-to-without-name': () => 'a GO TO names no procedure, so the last ALTER decides where it goes',
  'obsolete-enter': () => 'an ENTER statement, which Enterprise COBOL ignores',
  'obsolete-identification-paragraph': (o) => `the ${o.item} paragraph`,
  'obsolete-debugging-declarative': (o) => (o.item === 'DEBUG-ITEM' ? 'a reference to the DEBUG-ITEM special register' : 'a USE FOR DEBUGGING declarative'),
  'obsolete-label-records': () => 'a LABEL RECORDS clause, which has no effect',
  'obsolete-value-of': () => 'a VALUE OF clause, which has no effect',
  'obsolete-data-records': () => 'a DATA RECORDS clause, which has no effect',
  'obsolete-memory-size': () => 'a MEMORY SIZE clause, which has no effect',
  'obsolete-multiple-file-tape': () => 'a MULTIPLE FILE TAPE clause, which has no effect',
  'obsolete-rerun': () => 'a RERUN clause',
  'obsolete-reversed': () => 'an OPEN ... REVERSED',
  'obsolete-stop-literal': () => 'a STOP literal, which waits for the operator',
  'obsolete-segment-number': (o) => `section ${o.item} has segment number ${o.segment}${o.segment >= 50 ? ', which makes it an independent segment' : ''}`,
};

// Why a program's parse cannot be trusted to show every name and every route, or null.
function whyUndecided(r, src, p) {
  if (r.copies.some((c) => c.status === 'expansion-limit')) return 'its COPY or REPLACE statements expand past what one parse reads';
  if (r.copies.some((c) => !SYSTEM_COPY_OK(c))) return 'a copybook it includes is not in the tree';
  if (/^.{0,6}(?:-INC|\+\+INCLUDE)\s/im.test(src)) return 'it includes source a library manager expands';
  if (r.diags.some((d) => PARSE_TROUBLE.has(d.kind))) return 'the parse did not read it cleanly';
  if (p.diags.some((d) => d.kind === 'unrecognised-data-sentence')) return 'the parse did not recognise all of its data division';
  return null;
}

// The 01 and 77 records of a program's own WORKING-STORAGE and LOCAL-STORAGE that nothing names.
function unusedRecords(p, file, others) {
  const roots = p.items.filter((it) => !it.parent && (it.level === 1 || it.level === 77)
    && (it.section === 'WORKING-STORAGE' || it.section === 'LOCAL-STORAGE'));
  // A word the program uses that resolves to no item may be an index name, which belongs to its table.
  const words = new Set(p.refs.map((r) => r.tok.u));
  const execWords = new Set();
  for (const e of p.execs) for (const w of execReading(e).words) execWords.add(w);
  const subtree = (it) => { const all = []; (function walk(x) { all.push(x); for (const c of x.children) walk(c); })(it); return all; };
  const named = (x) => x.directRefs > 0 || (x.name !== 'FILLER' && (execWords.has(x.name) || others.has(x.name)))
    || [...(x.indexNames || []), ...(x.capacityName ? [x.capacityName] : [])].some((n) => words.has(n) || execWords.has(n) || others.has(n));
  const used = new Set();
  const rootOf = (x) => { while (x.parent) x = x.parent; return x; };
  for (const r of roots) if (subtree(r).some(named)) used.add(r);
  // A record laid over a named one shares its storage, and the one a named record lies over is named by it.
  for (let changed = true; changed;) {
    changed = false;
    for (const it of p.items) {
      if (!it.redefinesItem) continue;
      const from = rootOf(it);
      const to = rootOf(it.redefinesItem);
      if (used.has(from) && !used.has(to)) { used.add(to); changed = true; }
    }
  }
  return roots.filter((r) => !used.has(r) && r.file === file && r.name !== 'FILLER' && !r.external && !r.implicit
    && !r.constant && !subtree(r).some((x) => x.file !== file))
    .map((r) => ({ record: r, under: subtree(r).length - 1 }));
}

export function* scanPracticeSteps(root, opts = {}) {
  const tree = treeFor(root, opts);
  const all = tree.list().filter(inScope(opts));
  const files = all.filter(isProgram);
  const findings = [];
  const stats = {
    filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0, listingsSkipped: 0,
    programsRead: 0, programsUndecided: 0, paragraphsRead: 0, paragraphsInCopybooks: 0, recordsRead: 0,
  };
  const because = {};
  const undecided = [];
  const site = loadSite(root, opts.site || null, opts.tree).compilerOptions || [];
  const declaredChecks = opts.policy?.checks ?? treePolicy(root)?.raw?.checks;
  const required = (Array.isArray(declaredChecks) ? declaredChecks : DEFAULT_POLICY.checks).filter((c) => CHECKS.includes(c));
  const parsedJcl = [];
  for (const f of all.filter(isJcl)) {
    try { parsedJcl.push({ ...parseJcl(tree.text(f).text, f), file: tree.rel(f) }); } catch { /* the jcl set reports it */ }
  }
  const stepsOf = new Map();
  for (const s of compileStepOptions(parsedJcl)) {
    if (!stepsOf.has(s.member)) stepsOf.set(s.member, []);
    stepsOf.get(s.member).push(s);
  }
  const seenObsolete = new Set();

  const judge = (f, src, r) => {
    const path = tree.rel(f);
    const cards = optionCards(src);
    const steps = stepsOf.get(memberName(f)) || [];
    const programs = r.programs.filter((p) => p.id && !p.diags.some((d) => d.kind === 'no-procedure-division'));
    const programAt = (line) => { let at = null; for (const p of programs) if (p.line <= line) at = p; return at; };
    const refsOf = programs.map((p) => new Set([...p.refs.map((x) => x.tok.u), ...p.unresolvedRefs.map((x) => x.name)]));

    programs.forEach((p, pi) => {
      stats.programsRead++;
      const why = whyUndecided(r, src, p);

      const { checks } = enterpriseChecks({ required, site, steps, cards });
      const line = cards.length ? cards[cards.length - 1].line : p.line || 1;
      for (const c of checks) {
        if (c.ok === true) continue;
        findings.push({ rule: 'options-check-off', path, line, program: p.id, item: c.check, detail: `${p.id}: the ${c.check} check is off: ${c.why}` });
      }
      if (!cards.length && !site.length && !steps.length) {
        findings.push({ rule: 'options-undeclared', path, line: p.line || 1, program: p.id, item: null, detail: `${p.id} has no CBL or PROCESS card, no compile step in the tree names it, and cobolwork.site.json declares no compilerOptions, so it compiles on whatever the installation's defaults are` });
      }

      if (why) {
        stats.programsUndecided++;
        because[why] = (because[why] || 0) + 1;
        if (undecided.length < 200) undecided.push(`${path} (${p.id}): ${why}`);
        return;
      }

      const others = new Set();
      refsOf.forEach((s, qi) => { if (qi !== pi) for (const n of s) others.add(n); });
      const records = p.items.filter((it) => !it.parent && (it.level === 1 || it.level === 77) && it.file === f && (it.section === 'WORKING-STORAGE' || it.section === 'LOCAL-STORAGE'));
      stats.recordsRead += records.length;
      for (const { record, under } of unusedRecords(p, f, others)) {
        findings.push({
          rule: 'unused-data-record', path, line: record.line, program: p.id, item: record.name,
          detail: `${p.id}: ${record.level === 77 ? '77' : '01'} ${record.name} in ${record.section}${under ? ` and the ${plural(under, 'item')} under it` : ''} ${under ? 'are' : 'is'} named by no statement, condition, USING, EXEC block, REDEFINES, RENAMES or OCCURS DEPENDING ON`,
        });
      }

      const dataNames = new Set(p.items.flatMap((it) => [it.name, ...(it.indexNames || [])]));
      const reach = reachOf(p, (n) => dataNames.has(n));
      if (reach.undecided) {
        stats.programsUndecided++;
        because[reach.undecided] = (because[reach.undecided] || 0) + 1;
        if (undecided.length < 200) undecided.push(`${path} (${p.id}): ${reach.undecided}`);
        return;
      }
      const named = reach.paras.filter((x) => x.name);
      stats.paragraphsRead += named.length;
      const own = (x) => x.file === f;
      stats.paragraphsInCopybooks += named.filter((x) => !own(x)).length;
      const why2 = (i) => {
        const prev = reach.paras[i - 1];
        if (!prev) return 'and nothing comes before it';
        const name = prev.name ? `${prev.kind === 'S' ? 'section' : 'paragraph'} ${prev.name}` : 'the code';
        if (!prev.reached) return `and ${name} above it is never reached either`;
        if (prev.ender) return `and ${name} above it ends with ${prev.ender.what} at line ${prev.ender.line}`;
        return `and ${name} above it is entered only by PERFORM, so control returns at its end rather than running on`;
      };
      const reported = new Set();
      reach.paras.forEach((x, i) => {
        if (x.kind !== 'S' || x.reached || !own(x)) return;
        const members = reach.paras.filter((y) => y.kind === 'P' && y.section === x.name);
        if (members.some((y) => y.reached)) return;
        for (const y of members) reported.add(y);
        findings.push({
          rule: 'dead-code-paragraph', path, line: x.line, program: p.id, item: x.name,
          detail: `${p.id}: section ${x.name}${members.length ? ` and its ${plural(members.length, 'paragraph')}` : ''} ${members.length ? 'are' : 'is'} reached by no PERFORM, GO TO, SORT or MERGE procedure, USE or EXEC block, ${why2(i)}`,
        });
      });
      reach.paras.forEach((x, i) => {
        if (x.kind !== 'P' || x.reached || !own(x) || reported.has(x)) return;
        findings.push({
          rule: 'dead-code-paragraph', path, line: x.line, program: p.id, item: x.name,
          detail: `${p.id}: paragraph ${x.name} is reached by no PERFORM, GO TO, SORT or MERGE procedure, USE or EXEC block, ${why2(i)}`,
        });
      });
      for (const d of reach.deadRuns) {
        const first = d.after[0];
        if (first.file !== f) continue;
        const where = d.para.name ? `paragraph ${d.para.name}` : 'the first paragraph';
        const verbs = [...new Set(d.after.map((a) => a.what))].slice(0, SHOWN).join(', ');
        findings.push({
          rule: 'dead-code-statements', path, line: first.line, program: p.id, item: d.para.name || null,
          detail: `${p.id}: ${plural(d.after.length, 'statement')} in ${where} (${verbs}) ${d.after.length === 1 ? 'follows' : 'follow'} the ${d.ender.what} at line ${d.ender.line}, which ends the run on every route, and no paragraph header comes between`,
        });
      }
    });

    const tokens = r.programs.find((p) => p.proc)?.proc.tokens;
    if (!tokens) return;
    for (const o of obsoleteIn(tokens, r.programs)) {
      const at = o.tok.file;
      if (!at || !tree.contains(at)) continue;
      const opath = tree.rel(at);
      const key = `${o.rule}|${opath}|${o.tok.line}|${o.item}`;
      if (seenObsolete.has(key)) continue;
      seenObsolete.add(key);
      const prog = at === f ? programAt(o.tok.line) : null;
      const owner = prog ? `${prog.id}: ` : '';
      const via = at === f ? '' : ` (in a copybook ${path} copies)`;
      const detail = `${owner}${OBSOLETE_DETAIL[o.rule](o)}${via}`;
      findings.push({ rule: o.rule, path: opath, line: o.tok.line, program: prog ? prog.id : null, item: o.item, detail });
    }
  };

  const run = yield loopOver(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    if (LISTING.test(src)) { stats.filesScanned++; stats.listingsSkipped++; return src.length; }
    let r;
    try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    judge(f, src, r);
    r = null;
    return src.length;
  }, { label: 'practice', maxBytes: opts.maxSourceBytes ?? Infinity });

  if (stats.programsUndecided) {
    stats.undecidedBecause = because;
    stats.undecided = undecided;
    stats.coverageIncomplete = true;
    stats.readInPart = `${plural(stats.programsUndecided, 'program')} were read for options and obsolete elements only, because their dead code and unused data could not be decided: ${Object.entries(because).map(([k, v]) => `${v} because ${k}`).join('; ')}`;
  }
  return report('practice', { rules: PRACTICE_RULES, findings, stats, run });
}

export const scanPractice = (root, opts = {}) => drive(scanPracticeSteps(root, opts));
