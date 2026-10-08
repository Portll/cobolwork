// Programs with answers known by construction (bench/negatives.mjs): each guard's answer, and cobolwork's verdict on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineVerdict, items, questionFor, questionLine } from '../bench/negatives.mjs';
import { scanAll } from '../lib/scan.mjs';
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

test('a question names the source and the sink where cobolwork\'s finding does, and shows every line of each file', () => {
  for (const placement of ['inline', 'subprogram']) {
    const it = items({ rule: 'cics-terminal-to-os-command' }).find((i) => i.truth === 'reaches' && i.placement === placement);
    const dir = mkdtempSync(join(tmpdir(), 'cobolwork-negatives-test-'));
    for (const [name, text] of Object.entries(it.files)) writeFileSync(join(dir, name), text);
    const f = scanAll(dir, { only: ['flow'] }).findings.find((x) => x.rule === it.rule);
    rmSync(dir, { recursive: true, force: true });
    const q = questionFor(it);
    assert.ok(q.includes(`Source: ${f.related[0].path}:${f.related[0].line}: ${f.related[0].detail}\n`), placement);
    assert.ok(q.includes(`Sink: ${f.path}:${f.line}\n`), placement);
    for (const [name, text] of Object.entries(it.files)) assert.ok(q.includes(`Code of ${name}:`) && q.includes(text.trimEnd().split('\n').pop()), name);
  }
  const alone = { ...of('file-record-to-os-command', 'none', 'inline'), engine: 'reported' };
  const amongAll = { ...items().find((i) => i.rule === alone.rule && i.guard === 'none' && i.placement === 'inline'), engine: 'reported' };
  assert.equal(questionLine(alone).item, 'file-record-to-os-command/none/inline');
  assert.equal(questionLine(alone).prompt, questionLine(amongAll).prompt);
});
