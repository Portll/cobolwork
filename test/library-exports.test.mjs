import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as library from '@portll/cobolwork';
import { schemaProblems } from './schema-check.mjs';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STABILITY = readFileSync(join(ROOT, 'STABILITY.md'), 'utf8');
const CASE = join(ROOT, 'bench', 'cases', '001-argv-reaches-os-command');

// What a consumer may import from @portll/cobolwork, and the kind of each: STABILITY.md's library table.
const PUBLIC = {
  RULES: 'object',
  analyze: 'function',
  buildFileIndex: 'function',
  detectFormat: 'function',
  inventory: 'function',
  normalize: 'function',
  parseFile: 'function',
  parseSource: 'function',
  scan: 'function',
  toSarif: 'function',
  tokenize: 'function',
};
const UPDATE = 'change PUBLIC in test/library-exports.test.mjs and the library table in STABILITY.md together. '
  + 'A new name comes in a minor release; removing or renaming one, or changing its kind, waits for a major release';

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const schema = (name) => JSON.parse(readFileSync(join(ROOT, 'schema', name), 'utf8'));
const conforms = (value, name) => {
  const s = schema(`${name}.schema.json`);
  assert.deepEqual(schemaProblems(value, s, s, '$', schema), [], name);
};

test('the package lets a consumer import lib/index.mjs and nothing else', async () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.exports, { '.': './lib/index.mjs' },
    `package.json "exports" names another entry point, and each one is public: ${UPDATE}`);
  await assert.rejects(import('@portll/cobolwork/lib/parser.mjs'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
});

test('the library exports exactly the public names, each of its kind', () => {
  const kinds = Object.fromEntries(Object.keys(library).map((k) => [k, kindOf(library[k])]));
  const added = Object.keys(kinds).filter((k) => !(k in PUBLIC));
  const removed = Object.keys(PUBLIC).filter((k) => !(k in kinds));
  const changed = Object.keys(PUBLIC).filter((k) => k in kinds && kinds[k] !== PUBLIC[k]).map((k) => `${k}: ${PUBLIC[k]} -> ${kinds[k]}`);
  assert.deepEqual({ added, removed, changed }, { added: [], removed: [], changed: [] }, `lib/index.mjs exports differ from PUBLIC: ${UPDATE}`);
});

test('STABILITY.md lists each public name with its kind', () => {
  const section = STABILITY.split(/^## /m).find((s) => /^The library\r?\n/.test(s));
  assert.ok(section, 'STABILITY.md has a "## The library" section');
  const rows = section.split('\n').filter((l) => l.startsWith('| `')).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  const listed = Object.fromEntries(rows.map(([name, kind]) => [name.replace(/`/g, ''), kind]));
  assert.deepEqual(listed, PUBLIC, `STABILITY.md's library table differs from PUBLIC: ${UPDATE}`);
});

test('scan and inventory return the documents their schemas describe, and toSarif SARIF 2.1.0', () => {
  const report = library.scan(CASE);
  assert.ok(report.findings.length > 0);
  conforms(report, 'cobolwork-flow');
  for (const f of report.findings) assert.ok(library.RULES[f.rule], `RULES holds ${f.rule}`);
  conforms(library.inventory(CASE), 'cobolwork-inventory');
  assert.equal(library.toSarif(report).version, '2.1.0');
});
