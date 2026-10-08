// SPDX-License-Identifier: AGPL-3.0-or-later
// The operator's oversight of model answers (bench/label-models.mjs): a sheet to read each item
// from, a ledger of rescorings, and the final answer per item, where a rescoring outranks the
// judge and the judge outranks the two models (docs/spec/reach.md §9.6).
//
//   node bench/label-review.mjs sheet --answers <answers.jsonl> --prompts <prompts.jsonl> [--only disputed|withheld|all]
//        [--per-rule <n>] [--out review.md]
//   node bench/label-review.mjs rescore --ledger <ledger.jsonl> --set <set> --item <item> --verdict <verdict> --who <name> --why <text>
//   node bench/label-review.mjs final --answers <answers.jsonl> [--ledger <ledger.jsonl>] [--out final.json]
//   node bench/label-review.mjs labels --answers <answers.jsonl> [--ledger <ledger.jsonl>] [--out labels.json]
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { JUDGE_VERDICTS } from './label-models.mjs';

const lines = (file) => (file && existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const keyOf = (r) => `${r.set}\0${r.item}`;

// Each item's answers by model, from rows that hold an answer.
export function byItem(rows) {
  const out = new Map();
  for (const r of rows) {
    if (r.error) continue;
    if (!out.has(keyOf(r))) out.set(keyOf(r), { set: r.set, item: r.item, rule: r.rule, truth: r.truth, answers: {} });
    out.get(keyOf(r)).answers[r.model] = r;
  }
  return out;
}

// The latest rescoring of each item.
export function rescorings(ledger) {
  const out = new Map();
  for (const r of ledger) out.set(keyOf(r), r);
  return out;
}

// An item's final answer and who gave it: the operator's rescoring, else the judge's verdict.
export function finalOf(entry, rescored) {
  if (rescored) return { verdict: rescored.verdict, by: 'operator', who: rescored.who, why: rescored.why, judge: entry.answers.J?.verdict ?? null };
  if (entry.answers.J) return { verdict: entry.answers.J.verdict, by: 'judge', judge: entry.answers.J.verdict };
  return { verdict: 'no-consensus', by: 'none', judge: null };
}

// Items worth a person's time first: the judge withheld, or the judge and a model disagree.
const disputed = (e) => {
  const v = ['A', 'B', 'J'].map((m) => e.answers[m]?.verdict).filter(Boolean);
  return new Set(v).size > 1;
};
const withheld = (e) => ['no-consensus', 'not-recommended'].includes(e.answers.J?.verdict);

const said = (r) => (r ? `**${r.verdict}**${r.reason ? `: ${r.reason}` : ''}${r.checks?.length ? `\n  checks: ${r.checks.map((c) => `${c.line ?? '?'} ${c.what}`).join('; ')}` : ''}` : '(no answer)');

// Up to `n` items of each rule, in an order set by each item's name rather than by its repository,
// so a rule's sample is not one estate's copies.
export function perRuleSample(entries, n) {
  const order = (e) => createHash('sha1').update(e.item).digest('hex');
  return [...Map.groupBy(entries, (e) => e.rule).values()].flatMap((g) => g.sort((a, b) => (order(a) < order(b) ? -1 : 1)).slice(0, n));
}

export function sheet(rows, prompts, only = 'all', perRule = 0) {
  const promptOf = new Map(prompts.map((p) => [keyOf(p), p.prompt]));
  const pick = only === 'disputed' ? disputed : only === 'withheld' ? withheld : () => true;
  const picked = [...byItem(rows).values()].filter(pick);
  const out = ['# Model answers to review', '', `Items: ${only}${perRule ? `, up to ${perRule} a rule` : ''}. Rescore with the command under each item; a rescoring outranks every model.`, ''];
  for (const e of perRule ? perRuleSample(picked, perRule) : picked) {
    out.push(`## ${e.item}`, '', `Set ${e.set}, rule ${e.rule}${e.truth ? `, known answer ${e.truth}` : ''}.`, '',
      `- Judge: ${said(e.answers.J)}`, `- Model A: ${said(e.answers.A)}`, `- Model B: ${said(e.answers.B)}`, '',
      '<details><summary>Code shown to the models</summary>', '', '```', promptOf.get(keyOf(e)) || '(not in the prompts file)', '```', '', '</details>', '',
      '```sh', `node bench/label-review.mjs rescore --ledger <ledger.jsonl> --set ${e.set} --item '${e.item.replace(/'/g, "'\\''")}' --verdict <${JUDGE_VERDICTS.join('|')}> --who <name> --why <text>`, '```', '');
  }
  return out.join('\n');
}

// Final answers, and how often the operator's rescoring changed the judge's.
export function finals(rows, ledger) {
  const rescored = rescorings(ledger);
  const items = [];
  const counts = { items: 0, byOperator: 0, operatorChangedJudge: 0, withheld: 0, right: 0, wrong: 0 };
  for (const e of byItem(rows).values()) {
    const f = finalOf(e, rescored.get(keyOf(e)));
    counts.items++;
    if (f.by === 'operator') { counts.byOperator++; if (f.verdict !== f.judge) counts.operatorChangedJudge++; }
    if (f.verdict === 'no-consensus' || f.verdict === 'not-recommended') counts.withheld++;
    else if (e.truth) { if (f.verdict === e.truth) counts.right++; else counts.wrong++; }
    items.push({ set: e.set, item: e.item, rule: e.rule, ...(e.truth ? { truth: e.truth } : {}), ...f });
  }
  return { counts, items };
}

// Labels for bench/precision.mjs, source `model`: each finding with no known answer, by its final
// answer. An answer withheld, or no answer, leaves the label unknown.
export function modelLabels(rows, ledger) {
  const rescored = rescorings(ledger);
  const out = [];
  for (const e of byItem(rows).values()) {
    if (e.truth) continue;
    const at = /^([^/]+)\/(.+):(\d+):([^:]+)$/.exec(e.item);
    if (!at) continue;
    const f = finalOf(e, rescored.get(keyOf(e)));
    const fingerprint = Object.values(e.answers).find((r) => r.fingerprint)?.fingerprint;
    out.push({ source: 'model', by: f.by, repo: at[1], path: at[2], line: Number(at[3]), rule: at[4], ...(fingerprint ? { fingerprint } : {}),
      label: f.verdict === 'reaches' || f.verdict === 'does-not-reach' ? f.verdict : 'unknown', ...(f.by === 'operator' ? { why: f.why } : {}) });
  }
  return out;
}

function main(argv) {
  const [command, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) opts[rest[i].slice(2)] = rest[++i];
  if (command === 'sheet' && opts.answers) {
    const text = sheet(lines(opts.answers), lines(opts.prompts), opts.only || 'all', Number(opts['per-rule']) || 0);
    if (opts.out) writeFileSync(opts.out, text); else process.stdout.write(text);
    return 0;
  }
  if (command === 'rescore' && opts.ledger && opts.set && opts.item && JUDGE_VERDICTS.includes(opts.verdict) && opts.who && opts.why) {
    appendFileSync(opts.ledger, `${JSON.stringify({ set: opts.set, item: opts.item, verdict: opts.verdict, who: opts.who, why: opts.why, at: new Date().toISOString() })}\n`);
    return 0;
  }
  if (command === 'final' && opts.answers) {
    const text = `${JSON.stringify(finals(lines(opts.answers), lines(opts.ledger)), null, 1)}\n`;
    if (opts.out) writeFileSync(opts.out, text); else process.stdout.write(text);
    return 0;
  }
  if (command === 'labels' && opts.answers) {
    const text = `${JSON.stringify({ tool: 'cobolwork-label-review', labels: modelLabels(lines(opts.answers), lines(opts.ledger)) }, null, 1)}\n`;
    if (opts.out) writeFileSync(opts.out, text); else process.stdout.write(text);
    return 0;
  }
  process.stderr.write('usage: node bench/label-review.mjs sheet --answers <file> --prompts <file> [--only disputed|withheld|all] [--per-rule n] [--out file]\n'
    + `       node bench/label-review.mjs rescore --ledger <file> --set <set> --item <item> --verdict <${JUDGE_VERDICTS.join('|')}> --who <name> --why <text>\n`
    + '       node bench/label-review.mjs final --answers <file> [--ledger <file>] [--out file]\n'
    + '       node bench/label-review.mjs labels --answers <file> [--ledger <file>] [--out file]\n');
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
