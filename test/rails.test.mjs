import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import './pin-machine.mjs';

// The shared rails in lib/ only work if every caller actually uses them. An unused import is the
// failure mode that motivated this file: three rule sets imported eachWithinMemory and never
// called it, so they read as guarded and were not, and nothing failed, because an unused import is
// invisible. A grep would have found it the day it happened; a test finds it every day after.
//
// This is a structural test. It reads source rather than running it, because what it is asserting
// is a fact about how the modules are written, not about what they compute.

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib');

// Every module under lib/, at any depth. Reading only the top level would have quietly stopped
// checking anything the day the rule sets moved into lib/sets/ - a test that passes by finding
// nothing is worse than no test, because it reports a guarantee it is no longer enforcing.
function modulesUnder(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...modulesUnder(join(dir, e.name), prefix + e.name + '/'));
    else if (e.name.endsWith('.mjs')) out.push({ name: prefix + e.name, src: readFileSync(join(dir, e.name), 'utf8') });
  }
  return out;
}
const modules = modulesUnder(LIB);

// What a module imports from a sibling, as names. Only the braced form is read, because that is
// the only form this codebase uses for these helpers.
function importedFrom(src, from) {
  const names = new Set();
  // Any relative path ending in the rail's file name. './memory.mjs' and '../kernel/memory.mjs'
  // are the same import, and matching only the first form stopped this checking anything at all
  // the day the rails moved into lib/kernel/ — silently, because a test that finds nothing passes.
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'[^']*${from.replace('.', '\\.')}'`, 'g');
  let m;
  while ((m = re.exec(src)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

// Is the name used anywhere outside its own import statement? The imports are removed first, so
// the name appearing in one does not count as a use of it.
//
// Use, not invocation. Half of these helpers are passed by reference — `files.filter(isProgram)`
// never writes `isProgram(`. An earlier version of this test looked for a call and reported nine
// false positives, every one of them a predicate handed to filter.
function isUsed(src, name) {
  const withoutImports = src.replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';?/g, '');
  return new RegExp(`\\b${name}\\b`).test(withoutImports);
}

// Called, specifically — for the cases where passing the name by reference would not be enough.
function isCalled(src, name) {
  const withoutImports = src.replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';?/g, '');
  return new RegExp(`\\b${name}\\s*\\(`).test(withoutImports);
}

test('a module that imports a shared rail uses it', () => {
  const RAILS = ['memory.mjs', 'sources.mjs', 'site.mjs', 'findings.mjs', 'source-tree.mjs'];
  const unused = [];
  for (const { name, src } of modules) {
    for (const rail of RAILS) {
      if (name.endsWith('/' + rail) || name === rail) continue;
      for (const imported of importedFrom(src, rail)) {
        if (!isUsed(src, imported)) unused.push(`${name} imports ${imported} from ${rail} and never uses it`);
      }
    }
  }
  assert.deepEqual(unused, [], `an unused import claims a guarantee the module does not provide:\n  ${unused.join('\n  ')}`);
});

// The memory rail specifically: a rule set that walks the tree must walk it inside the guard. A
// byte budget does not bound a structure whose size is not measured in bytes, and a 100,000-program
// repository exhausted an 8 GB heap proving it.
test('every rule set walks the tree inside the memory guard', () => {
  const unguarded = [];
  for (const { name, src } of modules) {
    if (!/^sets\/[a-z]+\.mjs$/.test(name)) continue;
    // A set that never enumerates the tree has nothing to guard. Matched on tree.list(), which
    // is how a set enumerates now; the old check looked for idx.index.values() and would have
    // skipped every set silently once they stopped building their own index.
    if (!/tree\.list\(\)/.test(src)) continue;
    // A set that yields loopOver asks the scan's shared pass for the same guarded loop.
    const guarded = isCalled(src, 'eachWithinMemory') || (isCalled(src, 'loopOver') && !/guarded:\s*false/.test(src));
    if (!guarded) unguarded.push(name);
  }
  assert.deepEqual(unguarded, [], `these rule sets read the tree without a memory budget:\n  ${unguarded.join('\n  ')}`);
});
