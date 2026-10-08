// SPDX-License-Identifier: AGPL-3.0-or-later
// Two local models and a judge asked whether a finding's input reaches its sink, measured on
// findings whose answer is known before any is trusted with one that is not (docs/spec/reach.md
// §9.6). The operator reviews and rescores through bench/label-review.mjs, and a rescoring
// outranks every model.
//
//   node bench/label-models.mjs --calibrate --corpus <root> --execution <label.json>
//        --planted <seed.json> [--per-label 40] [--out results.jsonl] [--summary file]
//        [--model A|B|J] [--timeout seconds] [--parallel 4] [--prompts-only]
//   node bench/label-models.mjs --calibrate --unknown --corpus <root> --execution <label.json> ...
//   node bench/label-models.mjs --calibrate --items <questions.jsonl> [--model A|B|J] ...
//
// Each reviewer is named by the environment: CW_MODEL_A_URL, CW_MODEL_A and CW_MODEL_A_KEY, and
// the same with _B, an OpenAI-compatible chat endpoint on the operator's own machine, or with the
// URL `claude`, a Claude model through the Claude Code command line (operator 2026-10-08: Sonnet
// beside Gemma, Opus judging). The judge, J, is Claude through the Claude Code command line
// (CW_JUDGE_MODEL, claude-opus-5-5 by default): it reads the code and both models' answers, and
// may answer that no consensus is reached or that no label is recommended. --model asks one of A,
// B or J, so each runs when its host is free; J asks only about items both models have answered.
// Answers are written a line at a time to --out, and a second run asks only what is not answered
// yet. --unknown asks about every finding whose execution label is unknown, which has no known
// answer to measure against. --items asks the questions in a file, written by --prompts-only or by
// bench/negatives.mjs, so no corpus is read. Calibration writes no label: the rule that lets an
// answer stand for a label is the operator's, set from these numbers.
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { scanAll } from '../lib/scan.mjs';
import { RULES } from '../lib/sets/flow.mjs';
import { readSource } from '../lib/sources.mjs';
import { includes, OPERATORS } from './seed.mjs';

export const VERDICTS = ['reaches', 'does-not-reach', 'unsure'];
// What the judge may answer: a verdict, that the answers and the code settle nothing, or that no
// label should be given at all (the code shown is not enough to decide).
export const JUDGE_VERDICTS = ['reaches', 'does-not-reach', 'no-consensus', 'not-recommended'];
const PROMPT_CAP = 20000;
// A file's code is shown whole from the source to the sink where it spans no more than this.
const SPAN = 220;
const AROUND = 3;

const SYSTEM = 'You review COBOL programs for security flaws. You answer with one JSON object and nothing else.';

// The question every prompt ends with; the code before it is what changes.
export const QUESTION = 'Question: can input from the source reach the sink\'s operand, unchanged in meaning and not checked or restricted, on some route a run of this program could take?\n'
  + 'First list every statement between the source and the sink that tests, restricts or replaces the value (an IF, an EVALUATE and its WHEN OTHER, a SEARCH, a MOVE of a literal, a host variable), with its line and what it lets through. Then decide.\n'
  + 'Answer with JSON only: {"checks": [{"line": <n>, "what": "<what it allows>"}], "verdict": "reaches" | "does-not-reach" | "unsure", "reason": "<one sentence>"}';

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
export function capped(parts) {
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
    // Every line between the first and last statement of the route, where the stretch is short
    // enough: what runs between two hops can test, change or replace the value.
    const [lo, hi] = [Math.min(...lines), Math.max(...lines)];
    const shown = hi - lo <= SPAN ? Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) : [...lines];
    parts.push(`\nCode of ${file}:\n${excerpt(text, [...shown, ...decl])}\n`);
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

// A model's answer as one of `allowed`: the first JSON object in the text, fenced or not, with the
// checks it named; anything else is the last of `allowed`'s undecided answers.
export function parseVerdict(text, allowed = VERDICTS) {
  const s = String(text || '');
  const undecided = allowed.includes('unsure') ? 'unsure' : 'no-consensus';
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  const none = { verdict: undecided, reason: null, unparsed: s.length };
  if (start < 0 || end < start) return none;
  try {
    const o = JSON.parse(s.slice(start, end + 1));
    if (!allowed.includes(o.verdict)) return none;
    const checks = Array.isArray(o.checks) ? o.checks.slice(0, 20).map((c) => ({ line: Number(c?.line) || null, what: String(c?.what ?? '').slice(0, 200) })) : [];
    return { verdict: o.verdict, reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : null, checks };
  } catch {
    return none;
  }
}

// The judge's question: the same code, and the two reviewers' answers, unnamed.
export function judgePrompt(prompt, a, b) {
  const shown = (r) => JSON.stringify({ checks: r.checks || [], verdict: r.verdict, reason: r.reason });
  return `${prompt.replace(QUESTION, '').trimEnd()}\n\n${QUESTION.split('\n')[0]}\n\n`
    + `Two reviewers answered:\nReviewer 1: ${shown(a)}\nReviewer 2: ${shown(b)}\n\n`
    + 'Judge from the code, not from the reviewers: check each statement they named, and any they missed.\n'
    + 'Answer "no-consensus" where the code shown does not settle it, and "not-recommended" where no label should be given because the code needed to decide is not shown.\n'
    + 'Answer with JSON only: {"checks": [{"line": <n>, "what": "<what it allows>"}], "verdict": "reaches" | "does-not-reach" | "no-consensus" | "not-recommended", "reason": "<one sentence>"}';
}

// One question to Claude through the Claude Code command line, with no tools, settings or servers,
// run from a scratch directory so no project's instructions reach it.
function askClaude(prompt, timeoutMs, model) {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn('claude', ['-p', '--model', model, '--output-format', 'json', '--tools', '', '--no-session-persistence', '--system-prompt', SYSTEM,
      '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands'], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { child.kill(); done({ error: `no answer in ${timeoutMs / 1000}s`, ms: Date.now() - started }); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', (e) => { clearTimeout(timer); done({ error: e.message, ms: Date.now() - started }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const o = JSON.parse(out);
        if (o.is_error) return done({ error: String(o.result || 'the call failed').slice(0, 200), ms: Date.now() - started });
        done({ text: o.result ?? '', ms: Date.now() - started, costUsd: o.total_cost_usd });
      } catch {
        done({ error: `the command wrote no JSON (exit ${code})`, ms: Date.now() - started });
      }
    });
    child.stdin.end(prompt);
  });
}

// `work` over `list`, at most `n` at a time.
async function pool(list, n, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (next < list.length) await work(list[next++]); }));
}

export function modelsFromEnv(env = process.env) {
  return ['A', 'B'].map((k) => ({ name: k, url: env[`CW_MODEL_${k}_URL`], model: env[`CW_MODEL_${k}`], key: env[`CW_MODEL_${k}_KEY`] })).filter((m) => m.url && m.model);
}

// One question to one model; the answer's text, or an error. node:http rather than fetch, whose
// five-minute wait for a response's headers is shorter than a busy host takes to answer.
function ask(m, prompt, timeoutMs) {
  const started = Date.now();
  const url = new URL(`${m.url.replace(/\/$/, '')}/v1/chat/completions`);
  const body = JSON.stringify({ model: m.model, temperature: 0, max_tokens: 300, reasoning_effort: 'none', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] });
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((done) => {
    const req = client.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...(m.key ? { authorization: `Bearer ${m.key}` } : {}) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return done({ error: `HTTP ${res.statusCode}`, ms: Date.now() - started });
        try { done({ text: JSON.parse(text).choices?.[0]?.message?.content ?? '', ms: Date.now() - started }); } catch { done({ error: 'the answer is not JSON', ms: Date.now() - started }); }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer in ${timeoutMs / 1000}s`)));
    req.on('error', (e) => done({ error: e.message, ms: Date.now() - started }));
    req.end(body);
  });
}

// Per set: each model's verdicts against the known answer; the two local models together; and
// the judge, whose labelled answers are its reaches and does-not-reach, and whose withheld ones are
// no-consensus and not-recommended.
export function tally(rows) {
  const out = {};
  const byItem = new Map();
  for (const r of rows) {
    const s = (out[r.set] ||= { models: {}, both: { agreed: 0, agreedRight: 0, agreedWrong: 0, items: 0 } });
    const m = (s.models[r.model] ||= { positives: 0, negatives: 0, rightOnPositives: 0, rightOnNegatives: 0, unsure: 0, withheld: 0, errors: 0 });
    if (r.error) { m.errors++; continue; }
    m.verdicts = { ...(m.verdicts || {}), [r.verdict]: ((m.verdicts || {})[r.verdict] || 0) + 1 };
    if (r.truth === 'reaches') { m.positives++; if (r.verdict === 'reaches') m.rightOnPositives++; } else if (r.truth) { m.negatives++; if (r.verdict === 'does-not-reach') m.rightOnNegatives++; }
    if (r.verdict === 'unsure') m.unsure++;
    if (r.verdict === 'no-consensus' || r.verdict === 'not-recommended') m.withheld++;
    const id = `${r.set}\0${r.item}`;
    if (!byItem.has(id)) byItem.set(id, {});
    byItem.get(id)[r.model] = r;
  }
  for (const answers of byItem.values()) {
    const { A: a, B: b } = answers;
    if (!a || !b) continue;
    const s = out[a.set].both;
    s.items++;
    if (a.verdict === b.verdict && a.verdict !== 'unsure') {
      s.agreed++;
      if (a.truth) { if (a.verdict === a.truth) s.agreedRight++; else s.agreedWrong++; }
    }
  }
  for (const s of Object.values(out)) {
    for (const m of Object.values(s.models)) {
      m.accuracyOnPositives = m.positives ? m.rightOnPositives / m.positives : null;
      m.accuracyOnNegatives = m.negatives ? m.rightOnNegatives / m.negatives : null;
      const labelled = m.positives + m.negatives - m.unsure - m.withheld;
      m.labelled = labelled;
      m.rightWhenLabelled = labelled ? (m.rightOnPositives + m.rightOnNegatives) / labelled : null;
    }
  }
  return out;
}

// The execution set: each confirmed label's finding (or, for --unknown, each unknown one's), found again by fingerprint (or rule, path
// and line) in a scan of its repository.
function executionItems(labelsFile, corpus, which = 'confirmed') {
  const confirmed = JSON.parse(readFileSync(labelsFile, 'utf8')).labels.filter((l) => l.label === which);
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
      items.push({ set: which === 'confirmed' ? 'execution' : which, item: `${repo}/${l.path}:${l.line}:${l.rule}`, rule: l.rule, truth: which === 'confirmed' ? 'reaches' : null, fingerprint: l.fingerprint, prompt: promptFor(f, read) });
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

// Questions written earlier by --prompts-only or bench/negatives.mjs --prompts, one per line, the
// first of any item named twice.
export function readItems(file) {
  const seen = new Set();
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((it) => {
    const k = `${it.set}\0${it.item}`;
    return !seen.has(k) && seen.add(k);
  });
}

// One answer as a line of the answers file. `meta` is what an item carries about how it was made.
function rowFor(model, modelId, it, answer, allowed) {
  return { model, modelId, set: it.set, item: it.item, rule: it.rule, truth: it.truth, ...(it.fingerprint ? { fingerprint: it.fingerprint } : {}), ...(it.meta ? { meta: it.meta } : {}),
    promptSha1: createHash('sha1').update(it.prompt).digest('hex'), ms: answer.ms,
    ...(answer.costUsd != null ? { costUsd: answer.costUsd } : {}), ...(answer.error ? { error: answer.error } : parseVerdict(answer.text, allowed)) };
}

async function calibrate(opts) {
  const judging = opts.only === 'J';
  const models = judging ? [] : modelsFromEnv().filter((m) => !opts.only || m.name === opts.only);
  if (!judging && models.length < (opts.only ? 1 : 2) && !opts.promptsOnly) throw new Error('name two models: CW_MODEL_A_URL, CW_MODEL_A, CW_MODEL_A_KEY and the same with _B');
  const given = opts.items ? readItems(opts.items) : null;
  const exec = given ? { items: [], wanted: 0, matched: 0 } : executionItems(opts.execution, opts.corpus, opts.unknown ? 'unknown' : 'confirmed');
  const planted = given || opts.unknown ? { items: [], skipped: 0 } : plantedItems(opts.planted, opts.corpus, opts.perLabel);
  const items = given || [...exec.items, ...planted.items];
  if (opts.promptsOnly) {
    writeFileSync(opts.out, items.map((it) => `${JSON.stringify(it)}\n`).join(''));
    return { execution: { wanted: exec.wanted, matched: exec.matched }, planted: { items: planted.items.length, skipped: planted.skipped }, results: {} };
  }
  const done = new Set();
  const rows = [];
  // A question that failed is asked again; the answers kept are the ones a model gave.
  if (existsSync(opts.out)) {
    const kept = readFileSync(opts.out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error);
    writeFileSync(opts.out, kept.map((r) => `${JSON.stringify(r)}\n`).join(''));
    for (const r of kept) { rows.push(r); done.add(`${r.model}\0${r.set}\0${r.item}`); }
  }
  // Every question to one model before the next, so the host loads each model once. A local host
  // takes one question at a time; the command line takes --parallel.
  for (const m of models) {
    const todo = items.filter((it) => !done.has(`${m.name}\0${it.set}\0${it.item}`));
    await pool(todo, m.url === 'claude' ? opts.parallel : 1, async (it) => {
      const answer = m.url === 'claude' ? await askClaude(it.prompt, opts.timeoutMs, m.model) : await ask(m, it.prompt, opts.timeoutMs);
      const row = rowFor(m.name, m.model, it, answer, VERDICTS);
      appendFileSync(opts.out, `${JSON.stringify(row)}\n`);
      rows.push(row);
    });
  }
  // The judge, on each item both models answered.
  if (judging) {
    const answered = new Map(rows.map((r) => [`${r.model}\0${r.set}\0${r.item}`, r]));
    const todo = items.filter((it) => !done.has(`J\0${it.set}\0${it.item}`) && answered.has(`A\0${it.set}\0${it.item}`) && answered.has(`B\0${it.set}\0${it.item}`));
    await pool(todo, opts.parallel, async (it) => {
      const judge = process.env.CW_JUDGE_MODEL || 'claude-opus-5-5';
      const answer = await askClaude(judgePrompt(it.prompt, answered.get(`A\0${it.set}\0${it.item}`), answered.get(`B\0${it.set}\0${it.item}`)), opts.timeoutMs, judge);
      const row = rowFor('J', judge, it, answer, JUDGE_VERDICTS);
      appendFileSync(opts.out, `${JSON.stringify(row)}\n`);
      rows.push(row);
    });
  }
  const summary = { tool: 'cobolwork-label-models', models: models.map((m) => ({ name: m.name, model: m.model })), execution: { wanted: exec.wanted, matched: exec.matched }, planted: { items: planted.items.length, skipped: planted.skipped }, results: tally(rows) };
  if (opts.summary) writeFileSync(opts.summary, `${JSON.stringify(summary, null, 1)}\n`);
  return summary;
}

async function main(argv) {
  const opts = { perLabel: 40, timeoutMs: 600000, out: 'label-models.jsonl', parallel: 4 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--calibrate') opts.calibrate = true;
    else if (a === '--prompts-only') opts.promptsOnly = true;
    else if (a === '--unknown') opts.unknown = true;
    else if (a === '--parallel') opts.parallel = Number(argv[++i]);
    else if (a === '--model') opts.only = argv[++i];
    else if (a === '--corpus') opts.corpus = argv[++i];
    else if (a === '--execution') opts.execution = argv[++i];
    else if (a === '--planted') opts.planted = argv[++i];
    else if (a === '--items') opts.items = argv[++i];
    else if (a === '--per-label') opts.perLabel = Number(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--summary') opts.summary = argv[++i];
    else if (a === '--timeout') opts.timeoutMs = Number(argv[++i]) * 1000;
  }
  if (!opts.calibrate || (!opts.items && (!opts.corpus || !opts.execution || (!opts.planted && !opts.unknown)))) {
    process.stderr.write('usage: node bench/label-models.mjs --calibrate --corpus <root> --execution <label.json> --planted <seed.json> [--per-label 40] [--out file] [--summary file] [--timeout seconds] [--parallel n] [--prompts-only] [--model A|B|J] [--unknown]\n       node bench/label-models.mjs --calibrate --items <questions.jsonl> [--out file] [--summary file] [--timeout seconds] [--parallel n] [--model A|B|J]\n');
    return 2;
  }
  const summary = await calibrate(opts);
  process.stdout.write(`${JSON.stringify(opts.promptsOnly ? summary : summary.results, null, 1)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
