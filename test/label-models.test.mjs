// The two-model labeller's prompts, its reading of an answer and its counts (bench/label-models.mjs); no model is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { excerpt, modelsFromEnv, parseVerdict, promptFor, promptForPlant, tally } from '../bench/label-models.mjs';
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

test('a planted program\'s prompt shows the lines the plant added, flaw and near-miss alike', () => {
  const host = read('P.cbl');
  const planted = host.replace('           GOBACK.', "           IF WS-IN NOT = 'date'\n              GOBACK\n           END-IF\n           GOBACK.");
  const p = promptForPlant('argv-or-env-to-os-command', host, planted);
  assert.match(p, /IF WS-IN NOT = 'date'/);
  assert.match(p, /The source and the sink are among the lines shown/);
});

test('an answer is the first JSON object in it, fenced or not, and anything else is unsure', () => {
  assert.deepEqual(parseVerdict('{"verdict":"reaches","reason":"no check"}'), { verdict: 'reaches', reason: 'no check' });
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
});

test('models are named by the environment and a model with no URL is left out', () => {
  assert.deepEqual(modelsFromEnv({ CW_MODEL_A_URL: 'http://h:1', CW_MODEL_A: 'qwen', CW_MODEL_B: 'gemma' }).map((m) => m.model), ['qwen']);
});
