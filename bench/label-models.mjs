// SPDX-License-Identifier: AGPL-3.0-or-later
// Two local models asked whether a finding's input reaches its sink, measured on findings whose
// answer is known before either is trusted with one that is not (docs/spec/reach.md §9.6).
//
//   node bench/label-models.mjs --calibrate --corpus <root> --execution <label.json>
//        --planted <seed.json> [--per-label 40] [--out results.jsonl] [--summary file]
//
// Each model is named by the environment: CW_MODEL_A_URL, CW_MODEL_A and CW_MODEL_A_KEY, and the
// same with _B. A model is an OpenAI-compatible chat endpoint the operator runs on their own
// machine. --model A or B asks one of them, so each can run when its host is free; the tally pairs
// the two once both have answered. --prompts-only writes the questions to --out and asks no model. Answers are written a
// line at a time to --out; a second run with the same file asks
// only what is not answered yet. Calibration writes no label: the rule that lets the two models'
// agreement stand for a label is the operator's, set from these numbers.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { scanAll } from '../lib/scan.mjs';
import { RULES } from '../lib/sets/flow.mjs';
import { readSource } from '../lib/sources.mjs';
import { includes, OPERATORS } from './seed.mjs';

export const VERDICTS = ['reaches', 'does-not-reach', 'unsure'];
const PROMPT_CAP = 12000;
const AROUND = 3;

const SYSTEM = 'You review COBOL programs for security flaws. You answer with one JSON object and nothing else.';

// The question every prompt ends with; the code before it is what changes.
const QUESTION = 'Question: can input from the source reach the sink\'s operand, unchanged in meaning and not checked or restricted, on some route a run of this program could take?\n'
  + 'Answer with JSON only: {"verdict": "reaches" | "does-not-reach" | "unsure", "reason": "<one sentence>"}';

// The numbered lines of `text` within `around` of each of `lines`, merged where they meet.
export function excerpt(text, lines, around = AROUND) {
  const all = text.split(/\r?\n/);
  const keep = new Set();
  for (const n of lines) for (let k = Math.max(1, n - around); k <= Math.min(all.length, n + around); k++) keep.add(k);
  const out = [];
  let last = 0;
  for (const k of [...keep].sort((a, b) => a - b)) {
    if (last && k > last + 1) out.push('      ...');
    out.push(`${String(k).padStart(5)} ${all[k - 1]}`);
    last = k;
  }
  return out.join('\n');
}

// Where a hop's statement is: the file and line its `via` names ("MOVE at P.cbl:12").
const placeOf = (via) => {
  const m = / at (\S+):(\d+)$/.exec(via || '');
  return m ? { file: m[1], line: Number(m[2]) } : null;
};

// The line declaring each data item a route passes through: a level number, then the name.
function declarations(text, items) {
  const lines = [];
  text.split(/\r?\n/).forEach((l, i) => {
    const m = /^.{0,7}\s+(\d{1,2})\s+([A-Z0-9][A-Z0-9-]*)/i.exec(l);
    if (m && items.has(m[2].toUpperCase())) lines.push(i + 1);
  });
  return lines;
}

// A prompt within the cap: the parts in order, each cut where the cap falls, with what was cut said.
function capped(parts) {
  let out = '';
  for (const p of parts) {
    if (out.length + p.length <= PROMPT_CAP) { out += p; continue; }
    out += `${p.slice(0, Math.max(0, PROMPT_CAP - out.length))}\n[cut: ${out.length + p.length - PROMPT_CAP} more characters]\n`;
    break;
  }
  return out;
}

// The prompt for a reported finding: the rule, its source and sink, and the code of each hop of
// its route, with the declarations of the items on it. The route itself is not listed: a model
// shown the analyser's conclusion leans to it, and a planted near-miss has none to show. `read` returns a file's text by the path
// the finding names.
export function promptFor(f, read) {
  const rule = RULES[f.rule];
  const src = (f.related || [])[0];
  const byFile = new Map();
  const note = (file, line) => { if (!file || !line) return; if (!byFile.has(file)) byFile.set(file, new Set()); byFile.get(file).add(line); };
  if (src) note(src.path, src.line);
  note(f.path, f.line);
  const items = new Map();
  for (const h of f.trace || []) {
    const at = placeOf(h.via);
    if (at) note(at.file, at.line);
    if (h.item && h.file) { if (!items.has(h.file)) items.set(h.file, new Set()); items.get(h.file).add(String(h.item).toUpperCase()); }
  }
  const parts = [
    `Rule: ${f.rule}: ${rule ? rule.text : f.rule}${rule?.cwe ? ` (${rule.cwe})` : ''}.\n`,
    `Source: ${src ? `${src.path}:${src.line}: ${src.detail || ''}` : 'unknown'}\n`,
    `Sink: ${f.path}:${f.line}\n`,
  ];
  for (const [file, lines] of byFile) {
    let text;
    try { text = read(file); } catch { continue; }
    const decl = declarations(text, items.get(file) || new Set());
    parts.push(`\nCode of ${file}:\n${excerpt(text, [...lines, ...decl])}\n`);
  }
  return `${capped(parts)}\n${QUESTION}`;
}

// The prompt for a planted program, flaw or near-miss alike: the rule, and the lines the plant
// added with the code around them, so the two are asked the same way whatever the scanner said.
export function promptForPlant(rule, host, planted) {
  const before = new Set(host.split(/\r?\n/));
  const lines = planted.split(/\r?\n/).map((l, i) => (before.has(l) ? 0 : i + 1)).filter(Boolean);
  const r = RULES[rule];
  return `${capped([
    `Rule: ${rule}: ${r ? r.text : rule}${r?.cwe ? ` (${r.cwe})` : ''}.\n`,
    'The source and the sink are among the lines shown.\n',
    `\nCode:\n${excerpt(planted, lines, 6)}\n`,
  ])}\n${QUESTION}`;
}

// A model's answer as one of VERDICTS: the first JSON object in the text, fenced or not; anything
// else is unsure.
export function parseVerdict(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) return { verdict: 'unsure', reason: null, unparsed: s.length };
  try {
    const o = JSON.parse(s.slice(start, end + 1));
    return VERDICTS.includes(o.verdict) ? { verdict: o.verdict, reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : null } : { verdict: 'unsure', reason: null, unparsed: s.length };
  } catch {
    return { verdict: 'unsure', reason: null, unparsed: s.length };
  }
}

export function modelsFromEnv(env = process.env) {
  return ['A', 'B'].map((k) => ({ name: k, url: env[`CW_MODEL_${k}_URL`], model: env[`CW_MODEL_${k}`], key: env[`CW_MODEL_${k}_KEY`] })).filter((m) => m.url && m.model);
}

// One question to one model; the answer's text, or an error.
async function ask(m, prompt, timeoutMs) {
  const started = Date.now();
  try {
    const r = await fetch(`${m.url.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(m.key ? { authorization: `Bearer ${m.key}` } : {}) },
      body: JSON.stringify({ model: m.model, temperature: 0, max_tokens: 300, reasoning_effort: 'none', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { error: `HTTP ${r.status}`, ms: Date.now() - started };
    const body = await r.json();
    return { text: body.choices?.[0]?.message?.content ?? '', ms: Date.now() - started };
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? `no answer in ${timeoutMs / 1000}s` : e.message, ms: Date.now() - started };
  }
}

// Per model and per set: each verdict against the known answer, and the two models together.
export function tally(rows) {
  const out = {};
  const key = (r) => `${r.set}`;
  const byItem = new Map();
  for (const r of rows) {
    const s = (out[key(r)] ||= { models: {}, both: { agreed: 0, agreedRight: 0, agreedWrong: 0, items: 0 } });
    const m = (s.models[r.model] ||= { positives: 0, negatives: 0, rightOnPositives: 0, rightOnNegatives: 0, unsure: 0, errors: 0 });
    if (r.error) { m.errors++; continue; }
    if (r.truth === 'reaches') { m.positives++; if (r.verdict === 'reaches') m.rightOnPositives++; } else { m.negatives++; if (r.verdict === 'does-not-reach') m.rightOnNegatives++; }
    if (r.verdict === 'unsure') m.unsure++;
    const id = `${r.set}\0${r.item}`;
    if (!byItem.has(id)) byItem.set(id, []);
    byItem.get(id).push(r);
  }
  for (const answers of byItem.values()) {
    if (answers.length < 2) continue;
    const s = out[key(answers[0])].both;
    s.items++;
    const [a, b] = answers;
    if (a.verdict === b.verdict && a.verdict !== 'unsure') {
      s.agreed++;
      if (a.verdict === a.truth) s.agreedRight++; else s.agreedWrong++;
    }
  }
  for (const s of Object.values(out)) {
    for (const m of Object.values(s.models)) {
      m.accuracyOnPositives = m.positives ? m.rightOnPositives / m.positives : null;
      m.accuracyOnNegatives = m.negatives ? m.rightOnNegatives / m.negatives : null;
    }
  }
  return out;
}

// The execution set: each confirmed label's finding, found again by fingerprint (or rule, path
// and line) in a scan of its repository.
function executionItems(labelsFile, corpus) {
  const confirmed = JSON.parse(readFileSync(labelsFile, 'utf8')).labels.filter((l) => l.label === 'confirmed');
  const items = [];
  const byRepo = Map.groupBy(confirmed, (l) => l.repo);
  let matched = 0;
  for (const [repo, labels] of byRepo) {
    const root = join(corpus, repo);
    let findings;
    try { findings = scanAll(root, { only: ['flow'] }).findings; } catch { continue; }
    const read = (p) => readSource(join(root, p)).text;
    for (const l of labels) {
      const f = findings.find((x) => x.fingerprint === l.fingerprint) || findings.find((x) => x.rule === l.rule && x.path === l.path && x.line === l.line);
      if (!f) continue;
      matched++;
      items.push({ set: 'execution', item: `${repo}/${l.path}:${l.line}:${l.rule}`, rule: l.rule, truth: 'reaches', prompt: promptFor(f, read) });
    }
  }
  return { items, wanted: confirmed.length, matched };
}

// The planted set: up to `per` flaws and `per` near-misses, spread over operators in a fixed order,
// each program planted again from its host.
function plantedItems(seedFile, corpus, per) {
  const labels = JSON.parse(readFileSync(seedFile, 'utf8')).labels;
  const pick = (label) => {
    const byOp = Map.groupBy(labels.filter((l) => l.label === label), (l) => `${l.operator}/${l.variant}`);
    const queues = [...byOp.values()].map((q) => [...q].sort((a, b) => (a.host < b.host ? -1 : 1)));
    const out = [];
    for (let i = 0; out.length < per && queues.some((q) => i < q.length); i++) for (const q of queues) if (i < q.length && out.length < per) out.push(q[i]);
    return out;
  };
  const items = [];
  let skipped = 0;
  for (const l of [...pick('flaw'), ...pick('near-miss')]) {
    const [repo, ...rest] = l.host.split('/');
    const file = join(corpus, repo, ...rest);
    let src;
    try { src = readSource(file).text; } catch { skipped++; continue; }
    if (createHash('sha1').update(src).digest('hex') !== l.hostSha1) { skipped++; continue; }
    const op = OPERATORS[l.operator];
    const tree = directoryTree(join(corpus, repo));
    const byName = new Map(tree.list().map((p) => [p.split('/').pop().replace(/\.[^.]*$/, '').toUpperCase(), p]));
    const host = { file, parse: () => tree.parse(file, src), copybooks: includes(byName, file) };
    let planted;
    try { planted = op.variants[l.variant].plant(src, host); } catch { skipped++; continue; }
    if (!planted?.text) { skipped++; continue; }
    items.push({ set: 'planted', item: `${l.host}:${l.operator}/${l.variant}`, rule: l.rule, truth: l.label === 'flaw' ? 'reaches' : 'does-not-reach', prompt: promptForPlant(l.rule, src, planted.text) });
  }
  return { items, skipped };
}

async function calibrate(opts) {
  const models = modelsFromEnv().filter((m) => !opts.only || m.name === opts.only);
  if (models.length < (opts.only ? 1 : 2) && !opts.promptsOnly) throw new Error('name two models: CW_MODEL_A_URL, CW_MODEL_A, CW_MODEL_A_KEY and the same with _B');
  const exec = executionItems(opts.execution, opts.corpus);
  const planted = plantedItems(opts.planted, opts.corpus, opts.perLabel);
  const items = [...exec.items, ...planted.items];
  if (opts.promptsOnly) {
    writeFileSync(opts.out, items.map((it) => `${JSON.stringify(it)}\n`).join(''));
    return { execution: { wanted: exec.wanted, matched: exec.matched }, planted: { items: planted.items.length, skipped: planted.skipped }, results: {} };
  }
  const done = new Set();
  const rows = [];
  if (existsSync(opts.out)) for (const line of readFileSync(opts.out, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(line); rows.push(r); done.add(`${r.model}\0${r.set}\0${r.item}`); }
  // Every question to one model before the next, so the host loads each model once.
  for (const m of models) {
    for (const it of items) {
      if (done.has(`${m.name}\0${it.set}\0${it.item}`)) continue;
      const answer = await ask(m, it.prompt, opts.timeoutMs);
      const row = { model: m.name, modelId: m.model, set: it.set, item: it.item, rule: it.rule, truth: it.truth, promptSha1: createHash('sha1').update(it.prompt).digest('hex'), ms: answer.ms,
        ...(answer.error ? { error: answer.error } : parseVerdict(answer.text)) };
      appendFileSync(opts.out, `${JSON.stringify(row)}\n`);
      rows.push(row);
    }
  }
  const summary = { tool: 'cobolwork-label-models', models: models.map((m) => ({ name: m.name, model: m.model })), execution: { wanted: exec.wanted, matched: exec.matched }, planted: { items: planted.items.length, skipped: planted.skipped }, results: tally(rows) };
  if (opts.summary) writeFileSync(opts.summary, `${JSON.stringify(summary, null, 1)}\n`);
  return summary;
}

async function main(argv) {
  const opts = { perLabel: 40, timeoutMs: 600000, out: 'label-models.jsonl' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--calibrate') opts.calibrate = true;
    else if (a === '--prompts-only') opts.promptsOnly = true;
    else if (a === '--model') opts.only = argv[++i];
    else if (a === '--corpus') opts.corpus = argv[++i];
    else if (a === '--execution') opts.execution = argv[++i];
    else if (a === '--planted') opts.planted = argv[++i];
    else if (a === '--per-label') opts.perLabel = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--summary') opts.summary = argv[++i];
    else if (a === '--timeout') opts.timeoutMs = Number(argv[++i]) * 1000;
  }
  if (!opts.calibrate || !opts.corpus || !opts.execution || !opts.planted) {
    process.stderr.write('usage: node bench/label-models.mjs --calibrate --corpus <root> --execution <label.json> --planted <seed.json> [--per-label 40] [--out file] [--summary file] [--timeout seconds] [--prompts-only] [--model A|B]\n');
    return 2;
  }
  const summary = await calibrate(opts);
  process.stdout.write(`${JSON.stringify(opts.promptsOnly ? summary : summary.results, null, 1)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
