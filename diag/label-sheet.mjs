// Builds the worksheet a person fills in to label the flow corpus (feed/specs/06-corpus.md), and
// seals the engine's answers away from it.
//
//   node diag/label-sheet.mjs <corpus-root> --programs N --out <dir> [--seed S]
//                             [--prefer sinks|mixed|no-findings] [--skip a,b] [--exclude-paths a,b]
//
// <dir> gets three files:
//   worksheet.json      every sink the engine knows in each chosen program, reached or not, with
//                       blank fields for the label. Nothing in it says what the engine concluded.
//   answer-key.json.gz  for each site, whether the engine reports a path to it, from which kinds
//                       of source, under which rules, and the paths. Compressed, so that opening or
//                       searching the directory does not show it by accident.
//   selection.json      the programs, the seed, the criteria and the date: the selection, frozen
//                       before anyone labels.
//
// Programs are chosen as bench/seed.mjs chooses hosts: distinct by content, round-robin across
// repositories so that no one repository supplies the sample. The seed shuffles the order of the
// repositories and of the programs in each, so the same seed over the same corpus gives the same
// selection.
//
// --prefer is the triage the spec allows. It decides which programs are read, never a label:
//   sinks        the most sink sites first, reached or not, so the ranking looks at no answer
//   mixed        alternately a program where the engine reports a path and one where it reports
//                none, so the sample measures misses as well as false alarms
//   no-findings  only programs where the engine reports nothing. Whoever chose this knows the
//                engine's answer for every site, so someone else should label the sheet.
//
// Corpus programs carry their own licences and the corpus stays private: the worksheet quotes the
// code at each site, so neither it nor the key belongs in this repository.
import { readdirSync, mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../lib/dataflow.mjs';
import { byText, EXPLOITABILITY } from '../lib/kernel/findings.mjs';
import { scan as flowScan } from '../lib/sets/flow.mjs';
import { stampExploitability } from '../lib/exploitability.mjs';
import { kindsOf } from '../lib/consequence.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { inScope, isProgram, readSource } from '../lib/sources.mjs';
import { FLOW_MODEL, TOOL_VERSION } from '../lib/version.mjs';

export const PREFER = ['none', 'sinks', 'mixed', 'no-findings'];

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

const HOW = 'Repositories, and the programs in each, are ordered by sha1 of the seed and the name, and '
  + 'programs are taken round-robin across repositories, one per repository per round. A program is '
  + 'passed over when its text is a copy of one already taken, when the engine could not read its '
  + 'whole repository, when it does not parse, and when it holds no sink the engine knows.';

const PREFERENCE = {
  none: 'No triage: each repository offers its programs in seeded order.',
  sinks: 'Each repository offers its programs with the most sink sites first, reached or not.',
  mixed: 'Programs alternate between one where the engine reports a path and one where it reports none, '
    + 'each repository offering the one with the most sink sites first.',
  'no-findings': 'Only programs where the engine reports no path, each repository offering the one with the '
    + 'most sink sites first.',
};

const CAVEATS = {
  none: [],
  sinks: ['The ranking counts the sinks the engine knows, reached or not, so it says nothing about its answers.'],
  mixed: ['Which programs were chosen for a reported path and which for none is in the answer key, not here.'],
  'no-findings': ['Every program here is one where the engine reports no path, so whoever chose this triage knows '
    + "the engine's answer for every site. Labels made by that person measure agreement with it; someone else "
    + 'should label this sheet.'],
};

// Written into the worksheet, so it is what the labeller reads first. It names no rule and says
// nothing any one site's answer depends on.
const INSTRUCTIONS = [
  "Label every site without looking at anything cobolwork reports. answer-key.json.gz holds the engine's "
    + 'answers: do not open it, search it or run the scorer until every site has a label.',
  'A site is one statement, or for a subscript or reference modification one name indexing one table, listed '
    + 'at the first statement that does it. operands are the names the engine watches there, and code is the '
    + 'statement from its first line to the first line naming one of them.',
  'reachable: yes, no or undecidable. yes means a value from one of the kinds in sourcesThatCount can reach one '
    + 'of the operands when the statement runs, by any route: MOVE, a group, REDEFINES, a CALL argument or a '
    + 'COMMAREA into another program of the same repository, or the JCL that runs it. A value from any other '
    + 'kind of source does not count.',
  "undecidable is for a site whose answer needs something the source does not say: a runtime value, a dataset's "
    + 'contents, a program that is not in the repository. It is counted and published, not hidden.',
  'from: when reachable is yes, every kind of source you found reaching the site, from sourceKinds. Without it '
    + 'the site still counts overall and per sink kind, but not per rule.',
  'reasoning: at least 40 characters naming the statements that decide the answer. A label without a reason '
    + 'cannot be reviewed or disputed.',
  'labeller and method at the top apply to every site. method must be the word human: the scorer refuses any '
    + 'other value, and a model may not fill in this sheet.',
  'labelledAt: the date you labelled a site, as YYYY-MM-DD. A site left blank takes the date at the top.',
  'A sink the list misses goes in added, as {"repo", "program", "file", "line", "sink", "reachable", "from", '
    + '"reasoning"}, with sink one of sinkKinds.',
];

// The sink sites of every program file in one analysis. A site is one statement and kind of sink,
// whatever the number of operands the engine watches there: a report names the statement, so that
// is what a label is about.
function sitesByProgramFile(res) {
  const byFile = new Map();
  const place = (p, file, line, kind) => `${p}|${file}|${line}|${kind}`;
  for (const s of res.sinks) {
    if (!byFile.has(s.programFile)) byFile.set(s.programFile, new Map());
    const at = byFile.get(s.programFile);
    const key = place(s.program, s.file, s.line, s.kind);
    let site = at.get(key);
    if (!site) at.set(key, (site = { program: s.program, file: s.file, line: s.line, sink: s.kind, operands: [], count: new Set(), findings: [] }));
    site.operands.push({ item: s.item, detail: s.detail });
    for (const k of s.onlyFrom || Object.keys(res.sourceKinds)) site.count.add(k);
  }
  for (const f of res.findings) {
    // The last hop is the sink's own node, whose file is the program holding it; the sink's own
    // file may be a copybook.
    const site = byFile.get(f.path[f.path.length - 1].file)?.get(place(f.sink.program, f.sink.file, f.sink.line, f.sink.kind));
    if (!site) throw new Error(`a path ends at ${f.sink.file}:${f.sink.line}, where the engine lists no sink`);
    site.findings.push(f);
  }
  const out = new Map();
  for (const [file, at] of byFile) {
    out.set(file, [...at.values()]
      .map(({ count, ...s }) => ({ ...s, sourcesThatCount: Object.keys(res.sourceKinds).filter((k) => count.has(k)) }))
      .sort((a, b) => byText(a.file, b.file) || a.line - b.line || byText(a.sink, b.sink) || byText(String(a.program), String(b.program))));
  }
  return out;
}

// The exploitability verdict the engine gives each site, the most urgent where several paths end
// there, from the flow report a scan prints. No access facts are declared for a public corpus, so a
// verdict here is the route half only: never exploitable or restricted.
const sitePlace = (program, file, line, sink) => `${program}|${file}|${line}|${sink}`;
function verdictsBySite(base, tree) {
  const report = flowScan(base, { tree });
  stampExploitability(report.findings, null, report.checked);
  const order = Object.keys(EXPLOITABILITY);
  const at = new Map();
  for (const f of [...report.findings, ...report.checked]) {
    const kinds = f.exploitability && kindsOf(f.rule);
    if (!kinds) continue;
    const k = sitePlace(f.program, f.path, f.line, kinds.sink);
    const held = at.get(k);
    if (!held || order.indexOf(f.exploitability.verdict) < order.indexOf(held)) at.set(k, f.exploitability.verdict);
  }
  return at;
}

// A graph the memory guard or the byte budget cut short would answer for part of a repository, and
// the key would record a miss where the engine never looked.
const incomplete = (stats) => Boolean(stats.stoppedBy || stats.filesNotReached || stats.overBudget);
const unparsedFiles = (stats) => new Set((stats.unparsedFiles || []).map((u) => u.slice(0, u.lastIndexOf(': '))));

function candidatesIn(root, repo, { seed, deny, prefer, skip }) {
  const base = join(root, repo);
  const tree = directoryTree(base);
  const found = [];
  for (const abs of tree.list().filter(isProgram).filter(inScope({ deny }))) {
    let text;
    try { text = readSource(abs).text; } catch { skip('unreadable'); continue; }
    if (!/PROCEDURE\s+DIVISION/i.test(text)) { skip('not a program'); continue; }
    const file = tree.rel(abs);
    found.push({ repo, file, sha1: sha1(text), order: sha1(`${seed}\0${repo}\0${file}`) });
  }
  if (!found.length) return [];
  const res = analyze(base, { tree, listSinks: true });
  if (incomplete(res.stats)) { skip('the engine could not read the whole repository', found.length); return []; }
  const unparsed = unparsedFiles(res.stats);
  const sitesOf = sitesByProgramFile(res);
  const out = [];
  for (const c of found) {
    if (unparsed.has(c.file)) { skip('does not parse'); continue; }
    // Only counts are kept: the paths of every candidate in a corpus do not fit in memory, and the
    // chosen ones are analysed again when the sheet is built.
    const sites = sitesOf.get(c.file) || [];
    if (!sites.length) { skip('no sink the engine knows'); continue; }
    out.push({ ...c, sites: sites.length, reported: sites.some((s) => s.findings.length > 0) });
  }
  const rank = prefer === 'none' ? () => 0 : (a, b) => b.sites - a.sites;
  return out.sort((a, b) => rank(a, b) || byText(a.order, b.order));
}

function* roundRobin(repos, candidatesOf, accept) {
  const next = new Map();
  for (let progressed = true; progressed;) {
    progressed = false;
    for (const repo of repos) {
      const list = candidatesOf(repo);
      let i = next.get(repo) || 0;
      while (i < list.length && !accept(list[i])) i++;
      next.set(repo, i + 1);
      if (i < list.length) { progressed = true; yield list[i]; }
    }
  }
}

export function select(root, opts = {}) {
  const want = Number(opts.programs);
  if (!Number.isInteger(want) || want < 1) throw new Error('--programs must be a whole number of at least 1');
  const prefer = opts.prefer || 'none';
  if (!PREFER.includes(prefer)) throw new Error(`--prefer must be one of ${PREFER.filter((p) => p !== 'none').join(', ')}`);
  const seed = String(opts.seed ?? '0');
  const skipRepos = opts.skip || [];
  const deny = opts.excludePaths || [];
  const skipped = {};
  const skip = (why, n = 1) => { skipped[why] = (skipped[why] || 0) + n; };
  const order = (repo) => sha1(`${seed}\0${repo}`);
  const repos = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .filter((r) => !skipRepos.some((k) => r.includes(k)))
    .sort((a, b) => byText(order(a), order(b)));

  const examined = new Map();
  const candidatesOf = (repo) => {
    if (!examined.has(repo)) examined.set(repo, candidatesIn(root, repo, { seed, deny, prefer, skip }));
    return examined.get(repo);
  };
  const used = new Set();
  const pools = { none: [null], sinks: [null], mixed: [true, false], 'no-findings': [false] }[prefer];
  const streams = pools.map((reported) => roundRobin(repos, candidatesOf, (c) => {
    if (reported !== null && c.reported !== reported) return false;
    if (used.has(c.sha1)) { skip('a copy of a program already chosen'); return false; }
    return true;
  }));
  const selected = [];
  const live = streams.map(() => true);
  for (let k = 0; selected.length < want && live.some(Boolean); k++) {
    const s = k % streams.length;
    if (!live[s]) continue;
    const next = streams[s].next();
    if (next.done) { live[s] = false; continue; }
    used.add(next.value.sha1);
    selected.push(next.value);
  }
  return {
    seed, prefer, want, skipRepos, deny, selected, skipped,
    examined: { repositories: examined.size, programsThatQualified: [...examined.values()].reduce((n, l) => n + l.length, 0) },
  };
}

// The selected programs, analysed again with their paths, as the three documents the sheet is.
export function labelSheet(root, opts = {}) {
  const chosen = select(root, opts);
  const { seed, prefer } = chosen;
  // In name order. The order they were chosen in would tell the labeller of a mixed sheet which
  // half each program came from.
  const selected = [...chosen.selected].sort((a, b) => byText(a.repo, b.repo) || byText(a.file, b.file));
  const now = opts.now || new Date();
  const programs = [];
  const sheetSites = [];
  const keySites = [];
  const repositories = {};
  let kinds = null;
  const width = (n, min) => Math.max(min, String(n).length);
  const pw = width(selected.length, 2);
  // The corpus row requires a program, and a site nobody can label would hold up scoring for good.
  const idOf = (id) => id ?? '(no PROGRAM-ID)';
  for (const repo of [...new Set(selected.map((c) => c.repo))]) {
    const base = join(root, repo);
    const tree = directoryTree(base);
    const res = analyze(base, { tree, listSinks: true });
    if (incomplete(res.stats)) throw new Error(`${repo}: the engine could not read the whole repository this time; free some memory and run again`);
    kinds = kinds || { sourceKinds: res.sourceKinds, sinkKinds: res.sinkKinds };
    // A miss behind a caller that did not parse is the parser's, and the reviewer needs to know.
    repositories[repo] = { files: res.stats.files, programs: res.stats.programs, unparsed: res.stats.unparsedFiles || [],
      unreadable: res.stats.unreadableFiles || [] };
    const sitesOf = sitesByProgramFile(res);
    const verdictAt = verdictsBySite(base, tree);
    const lines = new Map();
    // A site's line is where its statement starts, and the operand is often on a continuation, so
    // the code runs on to the first line that names one.
    const codeOf = (file, n, operands) => {
      if (!lines.has(file)) { try { lines.set(file, readSource(join(base, file)).text.split(/\r?\n/)); } catch { lines.set(file, []); } }
      const all = lines.get(file);
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the item name is escaped
      const names = operands.map((o) => new RegExp(`(^|[^A-Z0-9-])${o.item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9-]|$)`, 'i'));
      let end = n;
      for (let k = n; k < n + 6 && k <= all.length; k++) if (names.some((re) => re.test(all[k - 1]))) { end = k; break; }
      return all.slice(n - 1, end).map((l) => l.trimEnd());
    };
    for (const c of selected.filter((x) => x.repo === repo)) {
      const sites = sitesOf.get(c.file) || [];
      if (sites.length !== c.sites) throw new Error(`${repo}/${c.file}: ${sites.length} sink sites now, ${c.sites} when it was chosen`);
      let ids = [];
      try { ids = tree.parse(join(base, c.file)).programs.map((p) => p.id); } catch { /* the sites name their programs */ }
      const n = selected.indexOf(c) + 1;
      const sw = width(sites.length, 3);
      programs[n - 1] = { repo, file: c.file, sha1: c.sha1, programs: [...new Set([...ids, ...sites.map((s) => s.program)].map(idOf))], sites: sites.length, reported: c.reported };
      sites.forEach((s, i) => {
        const id = `P${String(n).padStart(pw, '0')}-S${String(i + 1).padStart(sw, '0')}`;
        const where = { id, repo, program: idOf(s.program), file: s.file, line: s.line, sink: s.sink };
        sheetSites.push({ ...where, operands: s.operands, sourcesThatCount: s.sourcesThatCount, code: codeOf(s.file, s.line, s.operands),
          reachable: '', from: [], reasoning: '', labelledAt: '' });
        keySites.push({ ...where, sourcesThatCount: s.sourcesThatCount, reached: s.findings.length > 0,
          verdict: verdictAt.get(sitePlace(s.program, s.file, s.line, s.sink)) || null,
          sources: [...new Set(s.findings.map((f) => f.source.kind))], rules: [...new Set(s.findings.map((f) => f.rule))],
          findings: s.findings.map((f) => ({ rule: f.rule, source: f.source, hops: f.hops, crossProgram: f.crossProgram,
            ...(f.guard ? { guard: f.guard } : {}), path: f.path })) });
      });
    }
  }
  // Built repository by repository; the padded ids sort back into name order.
  const byId = (a, b) => byText(a.id, b.id);
  sheetSites.sort(byId);
  keySites.sort(byId);

  const criteria = { programs: chosen.want, prefer, how: HOW, preference: PREFERENCE[prefer],
    skipRepositories: chosen.skipRepos, excludePaths: chosen.deny };
  const sheet = sha1(JSON.stringify({ seed, criteria, programs: programs.map((p) => [p.repo, p.file, p.sha1]),
    sites: sheetSites.map((s) => [s.id, s.repo, s.program, s.file, s.line, s.sink]) })).slice(0, 16);
  const listed = programs.map(({ repo, file, programs: ids, sites }) => ({ repo, file, programs: ids, sites }));

  const worksheet = {
    sheet,
    about: 'Worksheet for the hand-labelled flow corpus (feed/specs/06-corpus.md). Every sink cobolwork knows '
      + 'in the programs below is listed, whether or not anything reaches it.',
    instructions: INSTRUCTIONS,
    labeller: '',
    method: '',
    labelledAt: '',
    sourceKinds: kinds ? kinds.sourceKinds : {},
    sinkKinds: kinds ? kinds.sinkKinds : {},
    programs: listed,
    sites: sheetSites,
    added: [],
  };
  const key = {
    sealed: 'The engine\'s answers for worksheet.json. Not to be opened until every site there is labelled.',
    sheet, toolVersion: TOOL_VERSION, flowModel: FLOW_MODEL,
    sourceKinds: worksheet.sourceKinds, sinkKinds: worksheet.sinkKinds,
    programs: programs.map(({ repo, file, programs: ids, reported }) => ({ repo, file, programs: ids, reported })),
    repositories,
    sites: keySites,
  };
  const selection = {
    sheet,
    createdAt: now.toISOString(),
    corpus: basename(root),
    tool: 'diag/label-sheet.mjs', toolVersion: TOOL_VERSION, flowModel: FLOW_MODEL,
    seed,
    criteria,
    programs: programs.map(({ repo, file, sha1: digest, programs: ids, sites }) => ({ repo, file, sha1: digest, programs: ids, sites })),
    ...(selected.length < chosen.want ? { shortfall: chosen.want - selected.length } : {}),
    examined: chosen.examined,
    skipped: chosen.skipped,
    caveats: CAVEATS[prefer],
  };
  return { worksheet, key, selection };
}

// JSON a person can read and edit: anything short stays on one line.
export function pretty(v, pad = '') {
  const inline = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || inline.length <= 120) return inline;
  const inner = pad + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${pad}]`;
  return `{\n${Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(',\n')}\n${pad}}`;
}

export const FILES = { worksheet: 'worksheet.json', key: 'answer-key.json.gz', selection: 'selection.json' };

// A worksheet may hold hours of labels.
const refuseOverwrite = (dir) => {
  if (existsSync(join(dir, FILES.worksheet))) throw new Error(`${join(dir, FILES.worksheet)} exists and may hold labels; choose another directory`);
};

// The selection records the digest of the key it was written with, so a key made again after the
// labelling began does not pass for the one that was sealed.
export function writeSheet(dir, { worksheet, key, selection }) {
  refuseOverwrite(dir);
  mkdirSync(dir, { recursive: true });
  const sheetText = pretty(worksheet) + '\n';
  const keyBytes = gzipSync(JSON.stringify(key));
  writeFileSync(join(dir, FILES.worksheet), sheetText);
  writeFileSync(join(dir, FILES.key), keyBytes);
  const frozen = { ...selection, files: { [FILES.worksheet]: sha1(sheetText), [FILES.key]: sha1(keyBytes) } };
  writeFileSync(join(dir, FILES.selection), pretty(frozen) + '\n');
  return frozen;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const list = (k) => (val(k) ? val(k).split(',').map((x) => x.trim()).filter(Boolean) : []);
  const root = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
  if (!root || !val('--programs') || !val('--out')) {
    process.stderr.write('usage: node diag/label-sheet.mjs <corpus-root> --programs N --out <dir> [--seed S]\n'
      + '                                 [--prefer sinks|mixed|no-findings] [--skip a,b] [--exclude-paths a,b]\n');
    process.exit(2);
  }
  let written;
  let result;
  try {
    refuseOverwrite(val('--out'));
    result = labelSheet(root, { programs: val('--programs'), seed: val('--seed') ?? undefined, prefer: val('--prefer') ?? undefined,
      skip: list('--skip'), excludePaths: list('--exclude-paths') });
    written = writeSheet(val('--out'), result);
  } catch (e) {
    process.stderr.write(`label-sheet: ${e.message}\n`);
    process.exit(2);
  }
  // Nothing about the engine's answers is printed: whoever runs this is usually the labeller.
  const repos = new Set(written.programs.map((p) => p.repo)).size;
  process.stdout.write(`${written.programs.length} programs from ${repos} repositories, ${result.worksheet.sites.length} sites to label (sheet ${written.sheet}, seed ${written.seed})\n`);
  if (written.shortfall) process.stdout.write(`only ${written.programs.length} of ${written.criteria.programs} asked for qualified\n`);
  for (const c of written.caveats) process.stdout.write(`note: ${c}\n`);
  process.stdout.write(`\nlabel   ${join(val('--out'), FILES.worksheet)}\nsealed  ${join(val('--out'), FILES.key)}   do not open it until every site is labelled\n`
    + `frozen  ${join(val('--out'), FILES.selection)}\n`);
  process.exit(written.shortfall ? 1 : 0);
}
