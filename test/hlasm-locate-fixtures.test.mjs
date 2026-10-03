import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate } from '../lib/hlasm/locate.mjs';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

// Each fixture's expected values are z390's, recorded by diag/hlasm-locate-expect.mjs.
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'hlasm-locate');

for (const file of readdirSync(dir).filter((f) => f.endsWith('.asm'))) {
  test(`the locator places ${file} as z390 assembles it`, () => {
    const text = readFileSync(join(dir, file), 'latin1');
    const want = JSON.parse(readFileSync(join(dir, file.replace(/\.asm$/, '.json')), 'utf8'));
    const got = Object.fromEntries(locate(text).symbols.map((y) => [y.name, y]));
    for (const [name, w] of Object.entries(want.symbols)) {
      const g = got[name];
      assert.ok(g, `${name} is not defined`);
      assert.equal(g.loc, w.loc, `${name} location`);
      if (w.section !== null) assert.equal(g.section, w.section, `${name} section`);
      if (w.len !== null) assert.equal(g.len, w.len, `${name} length`);
      assert.equal(g.type, w.type, `${name} type`);
    }
    const statements = new Map(readHlasmStatements(text).statements.map((s) => [s.line, s]));
    for (const [line, length] of Object.entries(want.instructions)) {
      assert.equal(parseHlasmStatement(statements.get(Number(line))).node.length, length, `line ${line} length`);
    }
  });
}
