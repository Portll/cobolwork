import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const action = readFileSync(join(ROOT, 'action.yml'), 'utf8');
const doc = readFileSync(join(ROOT, 'docs', 'github-action.md'), 'utf8');
const lines = action.split(/\r?\n/);

// The lines of a top-level section, and of each nested `key:` at the given indent within it.
const section = (name) => {
  const start = lines.findIndex((l) => l === `${name}:`);
  assert.ok(start >= 0, `action.yml has no ${name}:`);
  const end = lines.findIndex((l, i) => i > start && /^\S/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
};
const keysOf = (body, indent) => body.map((l) => l.match(new RegExp(`^ {${indent}}([a-z][a-z-]*):`))).filter(Boolean).map((m) => m[1]);

// Each `run: |` block's text, taken as the lines indented deeper than the key.
const runBlocks = () => {
  const blocks = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)(?:- )?run:\s*[|>]/);
    if (!m) return;
    const body = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > m[1].length); j++) body.push(lines[j]);
    blocks.push(body.join('\n'));
  });
  return blocks;
};

const declared = keysOf(section('inputs'), 2);
const docTableFirstColumn = (heading) => {
  const start = doc.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `docs/github-action.md has no ${heading} section`);
  const rest = doc.slice(start + heading.length + 3);
  const end = rest.search(/^## /m);
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
};

test('the action declares the inputs and outputs the task calls for', () => {
  assert.deepEqual(declared, ['path', 'base', 'policy', 'copylib', 'version', 'sarif', 'fail-on']);
  assert.deepEqual(keysOf(section('outputs'), 2), ['verdict', 'exit-code', 'sarif']);
  assert.match(action, /^ {2}using: composite$/m);
});

test('every input the steps reference is declared', () => {
  const body = lines.filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(body, /\binputs\s*\[/, 'index inputs by name, not by bracket');
  const used = new Set([...body.matchAll(/\binputs\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 0);
  assert.deepEqual([...used].filter((n) => !declared.includes(n)), []);
  for (const n of declared) if (n !== 'base') assert.ok(used.has(n), `input ${n} is declared and never used`);
});

test('no expression is interpolated into a shell script; inputs reach it through env', () => {
  const blocks = runBlocks();
  assert.equal(blocks.length, 2);
  for (const b of blocks) {
    assert.doesNotMatch(b, /\$\{\{/);
    assert.match(b, /^\s*set -euo pipefail$/m);
  }
  const shells = lines.filter((l) => /^\s+shell:/.test(l));
  assert.equal(shells.length, blocks.length);
  const fromEnv = lines.map((l) => l.match(/^\s+INPUT_[A-Z_]+: \$\{\{ inputs\.([a-z-]+) \}\}$/)).filter(Boolean).map((m) => m[1]);
  assert.deepEqual([...fromEnv].sort(), [...declared].sort());
});

test('the gate step handles exit codes 1, 2, 3 and 4 and quotes what it reads from env', () => {
  const gate = runBlocks()[1];
  const handled = new Set([...gate.matchAll(/^\s*([0-9|*]+)\)/gm)].flatMap((m) => m[1].split('|')));
  for (const code of ['0', '1', '2', '3', '4']) assert.ok(handled.has(code), `exit ${code} is not handled`);
  const unquoted = gate.split('\n').filter((l) => [...l.matchAll(/\$INPUT_[A-Z_]+/g)].some((m) => (l.slice(0, m.index).match(/"/g) || []).length % 2 === 0));
  assert.deepEqual(unquoted, [], 'an input is expanded outside double quotes');
  assert.match(gate, /GITHUB_STEP_SUMMARY/);
  for (const out of ['verdict', 'exit-code']) assert.match(gate, new RegExp(`echo "${out}=`));
  assert.doesNotMatch(action, /upload-sarif/);
});

test('the documented inputs and outputs are the declared ones', () => {
  assert.deepEqual(docTableFirstColumn('Inputs'), declared);
  assert.deepEqual(docTableFirstColumn('Outputs'), keysOf(section('outputs'), 2));
  const exits = [...doc.slice(doc.indexOf('## Exit codes')).matchAll(/^\| (\d) \|/gm)].map((m) => m[1]);
  assert.deepEqual(exits, ['0', '1', '2', '3', '4']);
  assert.match(doc, /fetch-depth: 0/);
  assert.match(doc, /if: always\(\)/);
  assert.match(doc, /security-events: write/);
});
