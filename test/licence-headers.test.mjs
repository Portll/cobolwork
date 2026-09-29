// SPDX-License-Identifier: AGPL-3.0-or-later
// Every file the package ships carries its licence identifier on its first code line, so a file
// copied out of the tree still says what it is licensed under.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['bin', 'lib'];
const HEADER = '// SPDX-License-Identifier: AGPL-3.0-or-later';

function sources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, acc);
    else if (name.endsWith('.mjs')) acc.push(p);
  }
  return acc;
}

test('every shipped source file carries the SPDX licence identifier', () => {
  const files = SHIPPED.flatMap((d) => sources(join(ROOT, d)));
  assert.ok(files.length > 20, `expected the shipped tree to hold sources, found ${files.length}`);
  const missing = files.filter((f) => {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/, 2);
    const first = lines[0].startsWith('#!') ? lines[1] : lines[0];
    return first !== HEADER;
  });
  assert.deepEqual(missing.map((f) => f.slice(ROOT.length + 1)), []);
});
