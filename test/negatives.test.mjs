// Programs with answers known by construction (bench/negatives.mjs): each guard's answer, and cobolwork's verdict on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineVerdict, items, questionFor, questionLine } from '../bench/negatives.mjs';
import { scanAll } from '../lib/scan.mjs';
import { RULES } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const of = (rule, guard, placement) => items({ rule }).find((i) => i.guard === guard && i.placement === placement);

test('every program is within column 72 and every rule gets negatives and positives', () => {
  const all = items();
  for (const it of all) for (const [name, text] of Object.entries(it.files)) for (const l of text.split('\n')) assert.ok(l.length <= 72, `${it.id} ${name}: ${l}`);
  const byRule = Map.groupBy(all, (i) => i.rule);
  for (const [rule, list] of byRule) assert.ok(list.some((i) => i.truth === 'reaches') && list.some((i) => i.truth === 'does-not-reach'), rule);
});

test('an allow-list stops a command and is credited; with WHEN OTHER carrying on it is a finding', () => {
  assert.equal(engineVerdict(of('argv-or-env-to-os-command', 'allow-list', 'inline')), 'checked');
  assert.equal(engineVerdict(of('argv-or-env-to-os-command', 'otherwise-continues', 'inline')).startsWith('reported'), true);
  assert.equal(engineVerdict(of('argv-or-env-to-os-command', 'none', 'inline')), 'reported');
});

test('a guard only a person or a model sees is still a negative: an allow-list in a searched table', () => {
  const it = of('argv-or-env-to-os-command', 'table-search', 'inline');
  assert.equal(it.truth, 'does-not-reach');
  assert.equal(engineVerdict(it), 'reported');
});

test('a count or a length needs only its top kept, a subscript both ends', () => {
  assert.equal(of('argv-or-env-to-loop-bound', 'upper-bound-only', 'inline').truth, 'does-not-reach');
  assert.equal(of('argv-or-env-to-subscript', 'upper-bound-only', 'inline').truth, 'reaches');
});

test('a selector\'s branches name every value an allow-list lets through, and only an unchecked value runs none', () => {
  const guarded = of('cics-terminal-to-unhandled-selector', 'allow-list', 'inline');
  assert.equal(guarded.truth, 'does-not-reach');
  const main = guarded.files['CWMAIN.cbl'];
  for (const v of ["'CWPGM1'", "'CWPGM2'"]) assert.equal(main.split('\n').filter((l) => l.trim() === `WHEN ${v}`).length, 2, v);
  assert.equal(of('cics-terminal-to-unhandled-selector', 'none', 'inline').truth, 'reaches');
});

test('every path rule has programs, and cobolwork reports each rule\'s unguarded one', () => {
  const all = items();
  const missing = Object.keys(RULES).filter((r) => RULES[r].evidence === 'path' && !all.some((i) => i.rule === r));
  assert.deepEqual(missing, [], 'add a source or a sink template in bench/negatives.mjs');
  for (const it of all.filter((i) => i.guard === 'none' && i.placement === 'inline')) assert.match(engineVerdict(it), /^reported/, it.rule);
});

test('a count needs only its top kept, and a record key is safe only fixed or replaced', () => {
  assert.equal(of('jcl-parm-to-occurs-depending-count', 'upper-bound-only', 'inline').truth, 'does-not-reach');
  assert.equal(of('jcl-parm-to-occurs-depending-count', 'bound-off-by-one', 'inline').truth, 'reaches');
  const keyGuards = new Set(items({ rule: 'cics-protected-field-to-record-key' }).map((i) => i.guard));
  assert.ok(keyGuards.has('must-equal') && keyGuards.has('overwritten'));
  for (const g of ['allow-list', 'condition-name', 'checked-by-flag', 'table-search', 'otherwise-continues']) assert.ok(!keyGuards.has(g), g);
});

test('a question names the source and the sink where cobolwork\'s finding does, and shows every line of each file', () => {
  const cases = [['cics-terminal-to-os-command', 'inline'], ['cics-terminal-to-os-command', 'subprogram'], ['jcl-parm-to-occurs-depending-count', 'inline'], ['jcl-instream-to-internal-reader', 'inline'], ['argv-or-env-to-storage-length', 'inline']];
  for (const [rule, placement] of cases) {
    const it = items({ rule }).find((i) => i.truth === 'reaches' && i.placement === placement);
    const dir = mkdtempSync(join(tmpdir(), 'cobolwork-negatives-test-'));
    for (const [name, text] of Object.entries(it.files)) writeFileSync(join(dir, name), text);
    const f = scanAll(dir, { only: ['flow'] }).findings.find((x) => x.rule === it.rule);
    rmSync(dir, { recursive: true, force: true });
    const q = questionFor(it);
    assert.ok(q.includes(`Source: ${f.related[0].path}:${f.related[0].line}: ${f.related[0].detail}\n`), `${rule} ${placement}`);
    assert.ok(q.includes(`Sink: ${f.path}:${f.line}\n`), `${rule} ${placement}`);
    for (const [name, text] of Object.entries(it.files)) assert.ok(q.includes(`Code of ${name}:`) && q.includes(text.trimEnd().split('\n').pop()), name);
  }
  const alone = { ...of('file-record-to-os-command', 'none', 'inline'), engine: 'reported' };
  const amongAll = { ...items().find((i) => i.rule === alone.rule && i.guard === 'none' && i.placement === 'inline'), engine: 'reported' };
  assert.equal(questionLine(alone).item, 'file-record-to-os-command/none/inline');
  assert.equal(questionLine(alone).prompt, questionLine(amongAll).prompt);
});

test('adversarial items are asked for one source per sink, and a reviewer must read the code, not names or comments', () => {
  const adversarial = ['guard-after-sink', 'dead-guard', 'comment-says-checked', 'misleading-paragraph', 'comment-says-unchecked'];
  const all = items().filter((i) => adversarial.includes(i.guard));
  for (const [sink, list] of Map.groupBy(all, (i) => i.sink)) assert.equal(new Set(list.map((i) => i.source)).size, 1, sink);
  assert.deepEqual(adversarial.map((g) => of('argv-or-env-to-os-command', g, 'inline').truth), ['reaches', 'reaches', 'reaches', 'reaches', 'does-not-reach']);
  const after = of('argv-or-env-to-os-command', 'guard-after-sink', 'inline').files['CWMAIN.cbl'].split('\n');
  assert.ok(after.findIndex((l) => l.includes("CALL 'SYSTEM'")) < after.findIndex((l) => l.includes('WHEN OTHER')));
  const commented = of('argv-or-env-to-os-command', 'comment-says-checked', 'inline').files['CWMAIN.cbl'].split('\n').filter((l) => l.includes('CHECKED AGAINST'));
  assert.equal(commented[0][6], '*');
});
