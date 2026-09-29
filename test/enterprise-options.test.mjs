// provenance/enterprise-options.json is IBM's compiler-option table with its sources. The gate's
// spellings and the table ironwork vendors are generated from it, so neither can hold a spelling IBM
// does not document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './pin-machine.mjs';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTION_SPELLINGS } from '../lib/enterprise-options.mjs';
import { enterpriseChecks } from '../lib/options.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prov = JSON.parse(readFileSync(join(root, 'provenance', 'enterprise-options.json'), 'utf8'));

test('lib/enterprise-options.mjs and provenance/enterprise-options.tsv are what the table generates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'options-'));
  try {
    const [mjs, tsv] = [join(dir, 'o.mjs'), join(dir, 'o.tsv')];
    const gen = spawnSync(process.execPath, [join(root, 'diag', 'generate-options.mjs'), join(root, 'provenance', 'enterprise-options.json'), mjs, tsv], { encoding: 'utf8' });
    assert.equal(gen.status, 0, gen.stderr);
    assert.equal(readFileSync(join(root, 'lib', 'enterprise-options.mjs'), 'utf8'), readFileSync(mjs, 'utf8'));
    assert.equal(readFileSync(join(root, 'provenance', 'enterprise-options.tsv'), 'utf8'), readFileSync(tsv, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every option cites its page, answers to its own name, and quotes any rule on where it goes', () => {
  const owner = new Map();
  for (const o of prov.options) {
    assert.ok(o.page >= 345 && o.page <= 431, `${o.name}: page ${o.page} is outside the options chapter`);
    for (const name of o.name.split('/')) assert.ok(o.spellings.includes(name), `${o.name} does not answer to ${name}`);
    if (!o.process || o.firstProgramOnly || !o.installationDefault) assert.ok(o.placement, `${o.name} has a rule and no quotation`);
    for (const s of o.spellings) {
      assert.ok(!owner.has(s), `${s} names both ${owner.get(s)} and ${o.name}`);
      owner.set(s, o.name);
    }
  }
  assert.equal(prov.options.length, 85, 'Table 45 lists 85 options');
  assert.equal(Object.keys(OPTION_SPELLINGS).length, owner.size);
});

test('the gate reads every spelling IBM documents for the checks it enforces', () => {
  const on = (required, token) => enterpriseChecks({ required: [required], cards: [{ options: [token], level: 'CBL', line: 1 }] }).checks[0].ok;
  assert.equal(on('numeric-data', 'NC(ABD)'), true);
  assert.equal(on('numeric-data', 'NONC'), false);
  assert.equal(on('subscript', 'SSR'), true);
  assert.equal(on('subscript', 'NOSSR'), false);
  assert.equal(on('argument-length', 'NOPC'), false);
});
