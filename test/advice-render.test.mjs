// The advice document's SARIF and Markdown renders carry every item and add nothing of their own
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advise } from '../lib/advice.mjs';
import { adviceToSarif, adviceToMarkdown } from '../lib/advice-render.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASE = join(HERE, '..', 'bench', 'cases', '001-argv-reaches-os-command');
const doc = advise(CASE);

test('SARIF carries one result per item, each citing a described rule', () => {
  const s = adviceToSarif(doc);
  const run = s.runs[0];
  assert.equal(run.results.length, doc.items.length);
  const ids = new Set(run.tool.driver.rules.map((r) => r.id));
  for (const r of run.results) assert.ok(ids.has(r.ruleId), r.ruleId);
  const finding = run.results.find((r) => r.properties.kind === 'finding');
  assert.ok(finding.fingerprints && finding.locations[0].physicalLocation.region.startLine >= 1);
  assert.ok(run.invocations[0].toolExecutionNotifications.length >= 1, 'unmeasured parts are notifications');
  assert.equal(run.invocations[0].properties['cobolwork/advice'].summary.items, doc.items.length);
  const rule = run.tool.driver.rules.find((r) => r.id === 'argv-or-env-to-os-command');
  assert.match(rule.help.text, /literal|allow-list/i);
});

test('SARIF rules describe only what the items cite, sorted by id', () => {
  const rules = adviceToSarif(doc).runs[0].tool.driver.rules;
  const cited = new Set(doc.items.map((i) => i.ref));
  assert.deepEqual(rules.map((r) => r.id), [...cited].sort((a, b) => a.localeCompare(b)));
});

test('Markdown follows the order, names every item and the unmeasured parts', () => {
  const md = adviceToMarkdown(doc);
  assert.match(md, /^# Advice for 001-argv-reaches-os-command\n/);
  assert.match(md, /## Not measured\n\n- no compiler ran/);
  for (const it of doc.items) assert.ok(md.includes(`### ${it.ref} at `), it.id);
  const first = doc.items[0];
  assert.ok(md.indexOf(`### ${first.ref} at `) < md.indexOf(`### ${doc.items[doc.items.length - 1].ref} at `) || doc.items.length === 1);
  assert.match(md, /\*\*Fix\.\*\*/);
  assert.ok(md.endsWith('\n') && !md.includes('\n\n\n'));
});

test('renders are deterministic', () => {
  assert.equal(JSON.stringify(adviceToSarif(doc)), JSON.stringify(adviceToSarif(advise(CASE))));
  assert.equal(adviceToMarkdown(doc), adviceToMarkdown(advise(CASE)));
});

test('the CLI writes SARIF and Markdown for advise and refuses md elsewhere', async () => {
  const { spawnSync } = await import('node:child_process');
  const BIN = join(HERE, '..', 'bin', 'cobolwork.mjs');
  const sarif = spawnSync(process.execPath, [BIN, 'advise', CASE, '--format', 'sarif'], { encoding: 'utf8' });
  assert.equal(sarif.status, 0, sarif.stderr);
  assert.equal(JSON.parse(sarif.stdout).runs[0].tool.driver.name, 'cobolwork-advice');
  const md = spawnSync(process.execPath, [BIN, 'advise', CASE, '--format', 'md'], { encoding: 'utf8' });
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /^# Advice for /);
  const refused = spawnSync(process.execPath, [BIN, 'scan', CASE, '--format', 'md'], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /--format md is for advise/);
});
