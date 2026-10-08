// The two-model labeller's prompts, its reading of an answer and its counts (bench/label-models.mjs); no model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { excerpt, JUDGE_VERDICTS, judgePrompt, modelsFromEnv, parseVerdict, promptFor, promptForPlant, readItems, tally } from '../bench/label-models.mjs';
import { scanAll } from '../lib/scan.mjs';
import './pin-machine.mjs';

const DIR = join(import.meta.dirname, 'fixtures', 'label-models');
const read = (p) => readFileSync(join(DIR, p), 'utf8');

test('an excerpt numbers the lines around each one asked for and marks the gaps', () => {
  const text = Array.from({ length: 20 }, (_, i) => `L${i + 1}`).join('\n');
  assert.equal(excerpt(text, [2, 18], 1), ['    1 L1', '    2 L2', '    3 L3', '      ...', '   17 L17', '   18 L18', '   19 L19'].join('\n'));
});

test('a finding\'s prompt names the rule, the source and the sink, and shows each hop\'s code and declarations', () => {
  const f = scanAll(DIR, { only: ['flow'] }).findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  assert.ok(f, 'the fixture reports its finding');
  const p = promptFor(f, read);
  assert.match(p, /^Rule: argv-or-env-to-os-command: Command-line or environment input reaches an operating-system command routine \(CWE-78\)\./);
  for (const line of ['    8            ACCEPT WS-IN FROM COMMAND-LINE', '    9            MOVE WS-IN TO WS-CMD', '   10            CALL \'SYSTEM\' USING WS-CMD', '    5        01 WS-IN               PIC X(8).']) assert.ok(p.includes(line), line);
  assert.match(p, /Answer with JSON only/);
  assert.ok(p.length < 12500);
});

test('a prompt can show the lines leading to the sink, and shows none of them unless asked', () => {
  const f = scanAll(DIR, { only: ['flow'] }).findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  const first = '    1        IDENTIFICATION DIVISION.';
  assert.ok(!promptFor(f, read).includes(first));
  assert.ok(promptFor(f, read, { lead: 9 }).includes(first));
});

test('a planted program\'s prompt shows the lines the plant added, flaw and near-miss alike', () => {
  const host = read('P.cbl');
  const planted = host.replace('           GOBACK.', "           IF WS-IN NOT = 'date'\n              GOBACK\n           END-IF\n           GOBACK.");
  const p = promptForPlant('argv-or-env-to-os-command', host, planted);
  assert.match(p, /IF WS-IN NOT = 'date'/);
  assert.match(p, /The source and the sink are among the lines shown/);
});

test('an answer is the first JSON object in it, fenced or not, and anything else is unsure', () => {
  assert.deepEqual(parseVerdict('{"checks":[{"line":12,"what":"date or uptime"}],"verdict":"reaches","reason":"no check"}'), { verdict: 'reaches', reason: 'no check', checks: [{ line: 12, what: 'date or uptime' }] });
  assert.equal(parseVerdict('```json\n{"verdict": "does-not-reach", "reason": "allow list"}\n```').verdict, 'does-not-reach');
  assert.equal(parseVerdict('It reaches the sink.').verdict, 'unsure');
  assert.equal(parseVerdict('{"verdict": "maybe"}').verdict, 'unsure');
  assert.equal(parseVerdict('').verdict, 'unsure');
});

test('the counts give each model\'s accuracy on each side and how often the two agreed and were right', () => {
  const rows = [
    { model: 'A', set: 'planted', item: 'x', truth: 'reaches', verdict: 'reaches' },
    { model: 'B', set: 'planted', item: 'x', truth: 'reaches', verdict: 'reaches' },
    { model: 'A', set: 'planted', item: 'y', truth: 'does-not-reach', verdict: 'reaches' },
    { model: 'B', set: 'planted', item: 'y', truth: 'does-not-reach', verdict: 'reaches' },
    { model: 'A', set: 'planted', item: 'z', truth: 'does-not-reach', verdict: 'unsure' },
    { model: 'B', set: 'planted', item: 'z', truth: 'does-not-reach', error: 'HTTP 500' },
  ];
  const t = tally(rows).planted;
  assert.deepEqual([t.models.A.accuracyOnPositives, t.models.A.accuracyOnNegatives, t.models.A.unsure], [1, 0, 1]);
  assert.equal(t.models.B.errors, 1);
  assert.deepEqual(t.both, { agreed: 2, agreedRight: 1, agreedWrong: 1, items: 2 });
  const judged = tally([...rows, { model: 'J', set: 'planted', item: 'x', truth: 'reaches', verdict: 'reaches' }, { model: 'J', set: 'planted', item: 'y', truth: 'does-not-reach', verdict: 'no-consensus' }]).planted.models.J;
  assert.deepEqual([judged.labelled, judged.withheld, judged.rightWhenLabelled], [1, 1, 1]);
});

test('the judge may withhold a label, and reads the reviewers\' checks without their names', () => {
  assert.equal(parseVerdict('{"verdict":"not-recommended","reason":"the copybook is not shown"}', JUDGE_VERDICTS).verdict, 'not-recommended');
  assert.equal(parseVerdict('{"verdict":"unsure"}', JUDGE_VERDICTS).verdict, 'no-consensus');
  const p = judgePrompt('Rule: r.\nCode:\n    1 X\n', { verdict: 'reaches', checks: [{ line: 1, what: 'nothing' }], reason: 'r', model: 'A' }, { verdict: 'does-not-reach', checks: [], reason: 's', model: 'B' });
  assert.match(p, /Reviewer 1: \{"checks":\[\{"line":1,"what":"nothing"\}\],"verdict":"reaches","reason":"r"\}/);
  assert.doesNotMatch(p, /"model"/);
  assert.match(p, /"no-consensus" \| "not-recommended"/);
});

test('models are named by the environment and a model with no URL is left out', () => {
  assert.deepEqual(modelsFromEnv({ CW_MODEL_A_URL: 'http://h:1', CW_MODEL_A: 'qwen', CW_MODEL_B: 'gemma' }).map((m) => m.model), ['qwen']);
});

test('a rescoring outranks the judge, the judge outranks the models, and the sheet puts disputed items forward', async () => {
  const { finals, sheet } = await import('../bench/label-review.mjs');
  const rows = [
    { model: 'A', set: 'planted', item: 'x', rule: 'r', truth: 'does-not-reach', verdict: 'reaches', reason: 'a' },
    { model: 'B', set: 'planted', item: 'x', rule: 'r', truth: 'does-not-reach', verdict: 'reaches', reason: 'b' },
    { model: 'J', set: 'planted', item: 'x', rule: 'r', truth: 'does-not-reach', verdict: 'reaches', reason: 'j' },
    { model: 'A', set: 'planted', item: 'y', rule: 'r', truth: 'reaches', verdict: 'reaches' },
    { model: 'B', set: 'planted', item: 'y', rule: 'r', truth: 'reaches', verdict: 'does-not-reach' },
    { model: 'J', set: 'planted', item: 'y', rule: 'r', truth: 'reaches', verdict: 'no-consensus' },
  ];
  const ledger = [{ set: 'planted', item: 'x', verdict: 'does-not-reach', who: 'operator', why: 'the EVALUATE ends the run on any other value' }];
  const f = finals(rows, ledger);
  assert.deepEqual(f.counts, { items: 2, byOperator: 1, operatorChangedJudge: 1, withheld: 1, right: 1, wrong: 0 });
  assert.equal(f.items.find((i) => i.item === 'x').by, 'operator');
  const s = sheet(rows, [], 'disputed');
  assert.match(s, /## y/);
  assert.doesNotMatch(s, /## x/);
});

test('questions read from a file keep the first of any item named twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-label-items-'));
  const file = join(dir, 'q.jsonl');
  writeFileSync(file, ['{"set":"unknown","item":"r/P.cbl:9:x","prompt":"first"}', '{"set":"unknown","item":"r/P.cbl:9:x","prompt":"second"}', '{"set":"generated","item":"r/P.cbl:9:x","prompt":"other set"}', ''].join('\n'));
  assert.deepEqual(readItems(file).map((i) => i.prompt), ['first', 'other set']);
  rmSync(dir, { recursive: true, force: true });
});

test('a sheet can hold a few items of each rule, the same ones on every run', async () => {
  const { sheet } = await import('../bench/label-review.mjs');
  const row = (item, rule) => ({ model: 'J', set: 'unknown', item, rule, verdict: 'reaches' });
  const rows = [row('repo1/P.cbl:1:r1', 'r1'), row('repo2/P.cbl:1:r1', 'r1'), row('repo3/P.cbl:1:r1', 'r1'), row('repo1/Q.cbl:9:r2', 'r2')];
  const shown = (s) => [...s.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  const once = shown(sheet(rows, [], 'all', 1));
  assert.equal(once.length, 2);
  assert.deepEqual(new Set(once.map((i) => i.split(':').pop())), new Set(['r1', 'r2']));
  assert.deepEqual(shown(sheet([...rows].reverse(), [], 'all', 1)).sort(), [...once].sort());
});
