// Scores the flow engine against the hand-labelled corpus (feed/specs/06-corpus.md): a worksheet
// from diag/label-sheet.mjs as a person filled it in, or corpus rows in the feed's JSONL shape,
// against the answer key sealed beside it.
//
//   node diag/score-corpus.mjs <worksheet.json | rows.jsonl> <answer-key.json.gz>
//                              [--partial] [--rows out.jsonl] [--json out.json]
//
// Every label goes through the feed gate as a corpus row. A row whose method is not "human", or
// whose reasoning is missing or short, is refused and listed with the reason; it is never scored
// and never dropped quietly. Nothing is scored while a site lacks an accepted label, because the
// scores and the list of disagreements show the engine's answers, and a label finished after
// seeing them is no longer blind. --partial scores the accepted labels anyway and says so.
//
// A site is scored on its first accepted label. A later label of the same site is compared with the
// first, which is the second person's spot check the spec asks for.
//
// --rows writes the accepted labels as corpus rows, which is the form the corpus is kept in.
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRow } from '../feed/verify.mjs';

export function readKey(path) {
  const buf = readFileSync(path);
  return JSON.parse((buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8'));
}

const ANSWERS = { yes: true, no: false, undecidable: 'undecidable' };
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const listOf = (v) => (Array.isArray(v) ? v : blank(v) ? [] : String(v).split(/[\s,]+/).filter(Boolean));

// A worksheet as filled in, as corpus rows. A site with nothing filled in has not been labelled yet,
// which is a different thing from a label the gate refuses. The sheet-level labeller, method and
// date apply to every site that does not give its own.
export function rowsFromWorksheet(sheet) {
  const labels = [];
  const one = (s, at, added) => {
    const from = listOf(s.from);
    if (blank(s.reachable) && blank(s.reasoning) && !from.length) return;
    const said = typeof s.reachable === 'string' ? s.reachable.trim().toLowerCase() : s.reachable;
    labels.push({ at, row: {
      kind: 'corpus',
      method: s.method ?? sheet.method,
      labeller: blank(s.labeller) ? sheet.labeller : s.labeller,
      labelledAt: blank(s.labelledAt) ? sheet.labelledAt : s.labelledAt,
      repo: s.repo, program: s.program, sink: s.sink, line: s.line,
      reachable: Object.hasOwn(ANSWERS, said) ? ANSWERS[said] : said,
      reasoning: s.reasoning,
      file: s.file,
      ...(from.length ? { from } : {}),
      ...(added ? { added: true } : { site: s.id }),
      sheet: sheet.sheet,
    } });
  };
  (sheet.sites || []).forEach((s) => one(s, s.id, false));
  (sheet.added || []).forEach((s, i) => one(s, `added[${i}]`, true));
  return labels;
}

// A worksheet is one JSON document; rows are one JSON object per line, in a .jsonl file.
export function readLabels(path) {
  const text = readFileSync(path, 'utf8');
  if (/\.jsonl$/i.test(path)) {
    return text.split(/\r?\n/).flatMap((l, i) => {
      if (!l.trim()) return [];
      try { return [{ at: `line ${i + 1}`, row: JSON.parse(l) }]; } catch (e) { return [{ at: `line ${i + 1}`, row: null, error: `not JSON: ${e.message}` }]; }
    });
  }
  let sheet;
  try { sheet = JSON.parse(text); } catch (e) {
    // A worksheet is edited by hand, and Node 18 names only the character offset of the mistake.
    const at = !/line \d+/.test(e.message) && /position (\d+)/.exec(e.message);
    throw new Error(`${path} is not a readable worksheet${at ? ` (line ${text.slice(0, Number(at[1])).split('\n').length})` : ''}: ${e.message}`);
  }
  if (!sheet || !Array.isArray(sheet.sites)) throw new Error(`${path} has no sites; rows go one per line in a .jsonl file`);
  return rowsFromWorksheet(sheet);
}

function indexKey(key) {
  const byId = new Map(key.sites.map((s) => [s.id, s]));
  const byPlace = new Map();
  for (const s of key.sites) {
    const k = `${s.repo}|${s.program}|${s.sink}|${s.line}`;
    if (!byPlace.has(k)) byPlace.set(k, []);
    byPlace.get(k).push(s);
  }
  const programs = new Set(key.programs.flatMap((p) => p.programs.map((id) => `${p.repo}|${id}`)));
  return { byId, byPlace, programs };
}

// The key site a row labels, or null for a sink the key does not list: the key lists every sink
// site the engine knows in the programs it covers, so the engine reports no path to one it lacks.
function siteOf(row, key, ix) {
  if (row.site !== undefined) {
    const s = ix.byId.get(row.site);
    if (!s) return { problem: `site: '${row.site}' is not in this answer key` };
    if (s.repo !== row.repo || s.program !== row.program || s.sink !== row.sink || s.line !== row.line || (row.file && row.file !== s.file)) {
      return { problem: `site: '${row.site}' is ${s.sink} at ${s.repo} ${s.file}:${s.line} in ${s.program}, not the sink this row names` };
    }
    return { site: s };
  }
  const found = (ix.byPlace.get(`${row.repo}|${row.program}|${row.sink}|${row.line}`) || []).filter((s) => !row.file || s.file === row.file);
  if (found.length > 1) return { problem: 'names more than one site in the answer key; give its file' };
  if (found.length === 1) return { site: found[0] };
  if (!ix.programs.has(`${row.repo}|${row.program}`)) return { problem: `program: ${row.program} in ${row.repo} is not in this selection` };
  if (!Object.hasOwn(key.sinkKinds, row.sink)) return { problem: `sink: '${row.sink}' is not a kind of sink the engine models, so no score can say anything about it` };
  return { site: null };
}

function fromProblems(row, site, key) {
  if (row.from === undefined) return [];
  if (!Array.isArray(row.from)) return ['from: must be a list of kinds of source'];
  if (row.from.length && row.reachable !== true) return ['from: names what reaches a site, so it belongs only on a reachable one'];
  const problems = [];
  for (const k of row.from) {
    if (!Object.hasOwn(key.sourceKinds, k)) problems.push(`from: '${k}' is not one of ${Object.keys(key.sourceKinds).join(', ')}`);
    else if (site && !site.sourcesThatCount.includes(k)) {
      problems.push(`from: '${k}' does not count at a ${site.sink} site, only ${site.sourcesThatCount.join(', ')} do; if nothing that counts reaches it, it is not reachable`);
    }
  }
  return problems;
}

const round = (x) => Math.round(x * 1000) / 1000;
const ratio = (a, b) => (b ? round(a / b) : null);

// A 95% Wilson interval. The normal approximation leaves [0, 1] and narrows to nothing at a
// precision of 1 over a handful of sites, which is where a rule's figure usually is.
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))];
}

// Labeller down, engine across.
const matrix = () => ({ yes: { reported: 0, notReported: 0 }, no: { reported: 0, notReported: 0 }, undecidable: { reported: 0, notReported: 0 } });
const said = (r) => (r === true ? 'yes' : r === false ? 'no' : 'undecidable');

function measures(m) {
  const tp = m.yes.reported;
  const fn = m.yes.notReported;
  const fp = m.no.reported;
  const tn = m.no.notReported;
  const undecidable = m.undecidable.reported + m.undecidable.notReported;
  return {
    tp, fp, fn, tn, undecidable,
    precision: ratio(tp, tp + fp), precisionInterval: wilson(tp, tp + fp),
    recall: ratio(tp, tp + fn), recallInterval: wilson(tp, tp + fn),
    undecidableRate: ratio(undecidable, tp + fp + fn + tn + undecidable),
    confusion: m,
  };
}

export const NOT_COVERED = [
  'Whether a label was made without sight of the engine\'s answers cannot be checked from the rows. method "human" '
    + 'is the labeller\'s declaration; the gate checks that it was made, not that it is true.',
  'Recall is over the sinks the engine knows, and any the labeller added. A kind of sink or source the engine does '
    + 'not model is not on the sheet at all, so what it misses there is not counted.',
  'A site counts once overall and per sink kind, and the engine is credited with it whichever kind of source it '
    + 'names. The rule figures check the kind of source, and only on sites labelled with from.',
  'A path the engine reports past a check counts as reported, although it is reported one severity lower.',
  'Undecidable labels are left out of precision and recall, which describe the decidable sites only.',
  'The intervals are 95% Wilson intervals that treat sites as independent. Sites in one program are not, so the '
    + 'real uncertainty is wider.',
  'The answers are those of the engine that generated the sheet, named at the top. A later engine is not '
    + 'measured by this key.',
];

export function score(labels, key, { partial = false } = {}) {
  const ix = indexKey(key);
  const refused = [];
  const accepted = [];
  const first = new Map();
  const second = [];
  for (const { at, row: raw, error } of labels) {
    if (error) { refused.push({ at, row: null, problems: [error] }); continue; }
    if (!raw || typeof raw !== 'object') { refused.push({ at, row: raw, problems: ['row: not an object'] }); continue; }
    if (raw.kind !== undefined && raw.kind !== 'corpus') { refused.push({ at, row: raw, problems: [`kind: '${raw.kind}' is not a corpus row`] }); continue; }
    const row = { ...raw, kind: 'corpus' };
    const problems = verifyRow(row);
    let site = null;
    if (!problems.length) {
      const found = siteOf(row, key, ix);
      if (found.problem) problems.push(found.problem);
      else site = found.site;
      problems.push(...fromProblems(row, site, key));
      if (key.sheet && row.sheet !== undefined && row.sheet !== key.sheet) problems.push(`sheet: labelled on sheet ${row.sheet}, and this key is for ${key.sheet}`);
    }
    if (problems.length) { refused.push({ at, row: raw, problems }); continue; }
    accepted.push(row);
    const id = site ? site.id : `${row.repo}|${row.program}|${row.file || ''}|${row.line}|${row.sink}`;
    if (first.has(id)) second.push({ site: id, at, first: first.get(id).row.reachable, then: row.reachable, agree: first.get(id).row.reachable === row.reachable });
    else first.set(id, { row, site });
  }
  const unlabelled = key.sites.filter((s) => !first.has(s.id)).map((s) => s.id);
  const labelsSha1 = createHash('sha1').update(accepted.map((r) => JSON.stringify(r)).sort().join('\n')).digest('hex');
  const result = {
    sheet: key.sheet, engine: { toolVersion: key.toolVersion, flowModel: key.flowModel },
    labels: { accepted: accepted.length, refused: refused.length, unlabelled: unlabelled.length, second: second.length,
      secondAgree: second.filter((s) => s.agree).length },
    refused, unlabelled, second, labelsSha1, rows: accepted,
  };
  if ((refused.length || unlabelled.length) && !partial) {
    return { ...result, scored: false, why: `${unlabelled.length} site(s) have no accepted label and ${refused.length} row(s) were refused. `
      + 'The scores show the engine\'s answers, so they wait until every site is labelled; --partial scores what there is.' };
  }

  const overall = matrix();
  const byKind = {};
  const byRule = {};
  const cell = (table, k) => (table[k] ||= matrix());
  const disagreements = { falsePositives: [], falseNegatives: [] };
  let unattributed = 0;
  for (const { row, site } of first.values()) {
    const reported = site ? site.reached : false;
    const answer = said(row.reachable);
    const col = reported ? 'reported' : 'notReported';
    overall[answer][col]++;
    cell(byKind, row.sink)[answer][col]++;
    const where = { site: site ? site.id : null, repo: row.repo, program: row.program, file: row.file, line: row.line, sink: row.sink };
    if (answer === 'no' && reported) disagreements.falsePositives.push({ ...where, rules: site.rules });
    if (answer === 'yes' && !reported) disagreements.falseNegatives.push({ ...where, from: row.from || [] });

    // Per rule, a site is one question per kind of source that counts there. Undecidable is
    // attributed to the rules the engine reported; a reachable site with no from cannot be.
    const engine = new Set(site ? site.sources : []);
    if (answer === 'undecidable') { for (const k of engine) cell(byRule, `${k}-to-${row.sink}`).undecidable.reported++; continue; }
    if (answer === 'yes' && !(row.from || []).length) { unattributed++; continue; }
    const human = new Set(answer === 'yes' ? row.from : []);
    for (const k of new Set([...(site ? site.sourcesThatCount : []), ...engine, ...human])) {
      cell(byRule, `${k}-to-${row.sink}`)[human.has(k) ? 'yes' : 'no'][engine.has(k) ? 'reported' : 'notReported']++;
    }
  }
  const table = (t) => Object.fromEntries(Object.keys(t).sort().map((k) => [k, measures(t[k])]));
  const notCovered = [...NOT_COVERED];
  if (unattributed) notCovered.push(`${unattributed} site(s) labelled reachable without from count overall and per sink kind, but in no rule.`);
  if (partial && (refused.length || unlabelled.length)) {
    notCovered.unshift(`PARTIAL: ${unlabelled.length} site(s) have no accepted label; these figures are over the ${first.size} that do.`);
  }
  return { ...result, scored: true, partial: Boolean(partial && (refused.length || unlabelled.length)),
    overall: measures(overall), byKind: table(byKind), byRule: table(byRule), unattributed, disagreements, notCovered };
}

const pct = (x) => (x === null ? '-' : x.toFixed(3));
const span = (iv) => (iv ? `[${iv[0].toFixed(2)}, ${iv[1].toFixed(2)}]` : '');

export function report(r) {
  const out = [`sheet ${r.sheet}, engine ${r.engine.toolVersion} (${r.engine.flowModel})`];
  if (r.key) {
    out.push(r.key.sha1 === r.key.sealed ? 'answer key: the one selection.json sealed'
      : `answer key: NOT the one selection.json sealed (sha1 ${r.key.sha1}, sealed ${r.key.sealed})`);
  }
  out.push(`labels: ${r.labels.accepted} accepted, ${r.labels.refused} refused, ${r.labels.unlabelled} site(s) with no accepted label`
    + (r.labels.second ? `, ${r.labels.second} second label(s) of which ${r.labels.secondAgree} agree with the first` : ''));
  if (r.refused.length) {
    // One problem is usually one mistake repeated, such as a method left blank at the top.
    const byProblem = new Map();
    for (const f of r.refused) for (const p of f.problems) byProblem.set(p, [...(byProblem.get(p) || []), f.at]);
    out.push('', 'refused:');
    for (const [p, ats] of byProblem) out.push(`  ${p}`, `      ${ats.length} row(s): ${ats.slice(0, 8).join(', ')}${ats.length > 8 ? ', ...' : ''}`);
  }
  for (const s of r.second.filter((x) => !x.agree)) out.push(`  second label disagrees at ${s.site}: first ${said(s.first)}, then ${said(s.then)} (${s.at})`);
  if (!r.scored) { out.push('', r.why); return out.join('\n'); }
  if (r.partial) out.push('', r.notCovered[0]);

  const o = r.overall;
  out.push('', `overall  TP ${o.tp}  FP ${o.fp}  FN ${o.fn}  TN ${o.tn}   precision ${pct(o.precision)} ${span(o.precisionInterval)}`
    + `   recall ${pct(o.recall)} ${span(o.recallInterval)}   undecidable ${o.undecidable} (${o.undecidableRate === null ? '-' : (o.undecidableRate * 100).toFixed(1) + '%'})`);
  const c = o.confusion;
  out.push('', 'labeller down, engine across    reported  not reported');
  for (const [name, k] of [['reachable', 'yes'], ['not reachable', 'no'], ['undecidable', 'undecidable']]) {
    out.push(`  ${name.padEnd(30)}${String(c[k].reported).padStart(8)}${String(c[k].notReported).padStart(14)}`);
  }
  // A rule is one question per kind of source that counts at a site, so most rules are asked only
  // where nothing of their kind exists; a rule with nothing but true negatives is left out.
  const rows = (title, t, all) => {
    const keys = Object.keys(t).filter((k) => all || t[k].tp + t[k].fp + t[k].fn + t[k].undecidable > 0);
    if (!keys.length) return;
    const w = Math.max(title.length, ...keys.map((k) => k.length)) + 2;
    out.push('', `${title.padEnd(w)}   TP   FP   FN   TN  undec  precision  recall`);
    for (const k of keys) {
      const m = t[k];
      out.push(`${k.padEnd(w)}${[m.tp, m.fp, m.fn, m.tn, m.undecidable].map((x, i) => String(x).padStart(i === 4 ? 7 : 5)).join('')}${pct(m.precision).padStart(11)}${pct(m.recall).padStart(8)}`);
    }
  };
  rows('by sink kind', r.byKind, true);
  rows('by rule', r.byRule, false);
  const list = (title, xs, tail) => {
    if (!xs.length) return;
    out.push('', title);
    for (const x of xs) out.push(`  ${x.site || 'added'}  ${x.repo} ${x.file}:${x.line}  ${x.program}  ${x.sink}  ${tail(x)}`);
  };
  list('false positives: the engine reports a path, the labeller says not reachable', r.disagreements.falsePositives, (x) => x.rules.join(', '));
  list('false negatives: the labeller says reachable, the engine reports nothing', r.disagreements.falseNegatives, (x) => (x.from.length ? `from ${x.from.join(', ')}` : ''));
  out.push('', `labels sha1 ${r.labelsSha1}: quote it with the figures, so a label changed afterwards shows.`);
  out.push('', 'What these figures do not cover:', ...r.notCovered.map((n) => `  - ${n}`));
  return out.join('\n');
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const val = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
  const [labelsPath, keyPath] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--rows', '--json'].includes(args[i - 1])));
  if (!labelsPath || !keyPath) {
    process.stderr.write('usage: node diag/score-corpus.mjs <worksheet.json | rows.jsonl> <answer-key.json.gz> [--partial] [--rows out.jsonl] [--json out.json]\n');
    process.exit(2);
  }
  let r;
  try {
    r = score(readLabels(labelsPath), readKey(keyPath), { partial: args.includes('--partial') });
    // A key made again after the labelling began would not be the one the selection sealed.
    const selection = join(dirname(keyPath), 'selection.json');
    if (existsSync(selection)) {
      r.key = { sha1: createHash('sha1').update(readFileSync(keyPath)).digest('hex'),
        sealed: JSON.parse(readFileSync(selection, 'utf8')).files?.[basename(keyPath)] ?? null };
    }
  } catch (e) {
    process.stderr.write(`score-corpus: ${e.message}\n`);
    process.exit(2);
  }
  if (val('--rows')) writeFileSync(val('--rows'), r.rows.map((x) => JSON.stringify(x) + '\n').join(''));
  if (val('--json')) writeFileSync(val('--json'), JSON.stringify(r, null, 1));
  process.stdout.write(report(r) + '\n');
  process.exit(r.refused.length || r.unlabelled.length ? 1 : 0);
}
