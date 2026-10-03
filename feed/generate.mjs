// Drives a local model through a worklist until every target has a row the gate accepts, or until
// the attempt budget runs out. Hands-off: nothing here asks a person anything, and nothing the
// model says is believed - verify.mjs decides what survives.
//
// The loop is generate-and-test, not generate-and-hope. The model proposes; the gate disposes; a
// rejection is fed back verbatim as the next attempt's instruction. "Complete" means every target
// has an accepted row. "Coherent" is not something the model is asked to judge - it is what
// surviving the gate means.
//
//   lms load qwen3-27b            # or whatever LM Studio calls it
//   node feed/generate.mjs --kind utility --worklist feed/worklists/utility.json
//
// Options:
//   --kind <name>        which row shape to produce         (required)
//   --worklist <path>    JSON array of targets              (required)
//   --endpoint <url>     default http://localhost:1234/v1
//   --model <name>       default whatever LM Studio has loaded
//   --attempts <n>       per target, default 4
//   --out <dir>          default feed/out
//   --concurrency <n>    default 1 - a local model is one GPU
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { GENERABLE } from './schema.mjs';
import { verifyRow } from './verify.mjs';
import { CATALOGUE } from './catalogue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

// What the model is told it is doing, per kind. Each says what the row is for, what the gate will
// check, and - the part that matters most at this size - what it must not invent.
const BRIEFS = {
  compliance: [
    'You map one cobolwork security rule to one clause of one regulatory framework.',
    'The quote MUST be copied character for character from the document text provided. Do not',
    'paraphrase it, do not tidy it, do not join two separate sentences. A quote that does not',
    'appear verbatim in the document is rejected automatically, and so is a ruleId that is not in',
    'the list given. If no clause in the provided text genuinely covers the rule, say so by',
    'returning a row with clause set to the empty string rather than reaching for a near miss.',
  ].join(' '),
  recon: [
    'You write one pattern that recognises the SHAPE of a mainframe name - never a specific site',
    'name. Give at least two strings that must match and two near misses that must not; both lists',
    'are run against your pattern and any disagreement rejects the row. Prefer a pattern that is',
    'too narrow over one that is too broad: this rule set runs over JCL where every line holds a',
    'dataset name, so a loose pattern buries the finding it was written for.',
  ].join(' '),
  utility: [
    'You describe one parameter of one z/OS utility and what makes it worth seeing in a security',
    'review. The JCL fragment you give is checked against the JCL statement grammar: statements',
    'begin with // in columns 1 and 2, the name field is 1 to 8 characters, the operation must be',
    'a real JCL operation (EXEC, DD, JOB, ...), nothing may exceed 72 columns of statement, and a',
    'continued operand resumes between columns 4 and 16. Invalid JCL rejects the row.',
  ].join(' '),
  advisory: [
    'You record one published advisory against one COBOL compiler or runtime. The affected range',
    'must be a form the rule can evaluate: a comparison like <=2.2, an exact version, a closed',
    'interval like [2.0,2.2], or several of those joined by ||. Do not invent an advisory ID and',
    'do not guess a version: if the document does not state it, the row is not ready.',
  ].join(' '),
  vendor: [
    'You describe one command or verb of one vendor product found on z/OS, and the risk it carries.',
    'This pack is loaded only by shops that run the product, so be specific to it rather than',
    'general about mainframes.',
  ].join(' '),
};

const RULES_FOR_PROMPT = () => [...CATALOGUE.values()]
  .map((r) => '  ' + r.id + '  [' + r.set + ', ' + r.sev + ', ' + r.cwe + ']  ' + r.text).join('\n');

function systemPrompt(kind) {
  return [
    'You produce one JSON object per request for the cobolwork security feed. ' + BRIEFS[kind],
    '',
    'Rules of the exercise:',
    '- Output exactly one JSON object. No prose, no code fence, no explanation.',
    '- Every field is required. Set kind to "' + kind + '".',
    '- source.retrieved is the date the document was fetched, in YYYY-MM-DD form.',
    '- A machine checks your work immediately. Wrong output costs nothing and is discarded; it is',
    '  confident wrong output that would cost something, so where you are unsure, be narrow.',
    kind === 'compliance' ? '\nThe only valid ruleId values are:\n' + RULES_FOR_PROMPT() : '',
  ].join('\n');
}

function userPrompt(kind, target, lastProblems) {
  const parts = ['Target: ' + JSON.stringify(target, null, 1)];
  if (target.documentText) {
    parts.push('', 'Document text (the ONLY source you may quote from):', '---', target.documentText, '---');
  }
  if (lastProblems && lastProblems.length) {
    parts.push('', 'Your previous attempt was rejected by the gate for these reasons. Fix every one:',
      ...lastProblems.map((p) => '  - ' + p));
  }
  return parts.join('\n');
}

async function ask(endpoint, model, kind, target, lastProblems, signal) {
  const res = await fetch(endpoint.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: model || 'local-model',
      temperature: lastProblems && lastProblems.length ? 0.4 : 0.7,   // retry tighter than first try
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt(kind) },
        { role: 'user', content: userPrompt(kind, target, lastProblems) },
      ],
    }),
  });
  if (!res.ok) throw new Error('endpoint returned ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const body = await res.json();
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error('no content in response');
  // A model at this size still sometimes fences its JSON despite being told not to.
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

async function run() {
  const kind = arg('kind');
  const worklistPath = arg('worklist');
  if (!kind || !GENERABLE.includes(kind)) {
    console.error('--kind must be one of: ' + GENERABLE.join(', '));
    process.exit(2);
  }
  if (!worklistPath || !existsSync(worklistPath)) {
    console.error('--worklist <path> is required and must exist');
    process.exit(2);
  }

  const endpoint = arg('endpoint', 'http://localhost:1234/v1');
  const model = arg('model');
  const attempts = Number(arg('attempts', '4'));
  const outDir = arg('out', join(HERE, 'out'));
  mkdirSync(outDir, { recursive: true });

  const outPath = join(outDir, kind + '.jsonl');
  const rejectPath = join(outDir, kind + '.rejects.jsonl');
  const targets = JSON.parse(readFileSync(worklistPath, 'utf8'));

  // Resumable: a target already answered is not asked again, so an interrupted overnight run
  // picks up where it stopped rather than paying for the whole worklist twice.
  const done = new Set();
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, 'utf8').split('\n')) {
      if (line.trim()) { try { done.add(JSON.parse(line)._target); } catch { /* keep going */ } }
    }
  }

  const started = Date.now();
  let accepted = 0, failed = 0, skipped = 0;

  for (const [n, target] of targets.entries()) {
    const key = target.id ?? JSON.stringify(target);
    if (done.has(key)) { skipped++; continue; }

    let problems = null;
    let won = false;
    for (let a = 1; a <= attempts; a++) {
      let row;
      try {
        row = await ask(endpoint, model, kind, target, problems);
      } catch (e) {
        problems = ['the response could not be read: ' + e.message];
        continue;
      }
      problems = verifyRow(row);
      if (!problems.length) {
        appendFileSync(outPath, JSON.stringify({ ...row, _target: key, _attempts: a }) + '\n');
        accepted++; won = true;
        console.log('[' + (n + 1) + '/' + targets.length + '] accepted on attempt ' + a + ': ' + key);
        break;
      }
      appendFileSync(rejectPath, JSON.stringify({ target: key, attempt: a, row, problems }) + '\n');
    }
    if (!won) {
      failed++;
      console.log('[' + (n + 1) + '/' + targets.length + '] GAVE UP after ' + attempts + ': ' + key);
      for (const p of problems || []) console.log('      - ' + p);
    }
  }

  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log('\n' + accepted + ' accepted, ' + failed + ' unanswered, ' + skipped + ' already done, ' + mins + ' min');
  console.log('rows:     ' + outPath);
  console.log('rejects:  ' + rejectPath + '   (read these to fix the brief, not the gate)');

  // Completeness is a property of the worklist, not of the run, so it is stated rather than implied.
  const total = accepted + skipped;
  console.log('\ncoverage: ' + total + ' of ' + targets.length + ' targets' +
    (total === targets.length ? ' - complete' : ' - INCOMPLETE, ' + (targets.length - total) + ' outstanding'));
  process.exit(total === targets.length ? 0 : 1);
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) run().catch((e) => { console.error(e.message); process.exit(2); });
