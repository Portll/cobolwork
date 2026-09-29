import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const declared = (p) => [
  ...['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((k) => Object.keys(p[k] || {}).map((n) => `${k}: ${n}`)),
  ...['bundleDependencies', 'bundledDependencies'].flatMap((k) => (p[k] === true ? [`${k}: all`] : (p[k] || []).map((n) => `${k}: ${n}`))),
];

test('the package declares no dependency of any kind', () => {
  assert.deepEqual(declared(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))), []);
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.deepEqual(declared({ [k]: { left: '1.0.0' } }), [`${k}: left`]);
  }
  assert.deepEqual(declared({ bundleDependencies: ['left'], bundledDependencies: true }), ['bundleDependencies: left', 'bundledDependencies: all']);
});
