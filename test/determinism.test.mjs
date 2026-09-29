// A test whose verdict depends on the machine is not a test.
//
// The memory guard's `available` is min(heap headroom, machine free), and the second term is the
// whole box. Any test that reaches a rule set - directly, through bench/, or through a spawned
// diag/ or bin/ script - can therefore be stopped early by an unrelated process and fail an
// assertion about what a complete scan finds. That happened three times in one afternoon on three
// different paths into the guard, each missed by a rule about which imports count.
//
// So the rule is not about which imports count. Every test file imports ./pin-machine.mjs; the
// guard's own tests pin their own readers instead. Nothing is left to judgement, and a new test
// file cannot reintroduce the flake by importing something nobody thought of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const PINS_VIA_MODULE = /'\.\/pin-machine\.mjs'/;
const PINS_ITS_OWN = /setMemoryReaders\(/;

const testFiles = readdirSync(HERE).filter((f) => f.endsWith('.test.mjs'));
const source = (f) => readFileSync(join(HERE, f), 'utf8');

test('every test file pins the machine term', () => {
  const unpinned = testFiles.filter((f) => {
    const src = source(f);
    return !PINS_VIA_MODULE.test(src) && !PINS_ITS_OWN.test(src);
  });
  assert.deepEqual(unpinned, [],
    `add \`import './pin-machine.mjs';\` to: ${unpinned.join(', ')}`);
});

test('the invariant is not vacuous', () => {
  assert.ok(testFiles.length > 50, `${testFiles.length} test files`);
  const viaModule = testFiles.filter((f) => PINS_VIA_MODULE.test(source(f)));
  assert.ok(viaModule.length > testFiles.length - 5, `${viaModule.length} of ${testFiles.length} use the module`);
});

// A child process inherits no imports, only the environment. pin-machine.mjs sets both, and a test
// that spawns a scan without it would pass here and flake in CI, so this names them explicitly.
test('every test that spawns a scan pins it through the environment', () => {
  const spawners = testFiles.filter((f) => /spawnSync|execFileSync|spawn\(/.test(source(f)));
  assert.ok(spawners.length > 5, `${spawners.length} test files spawn a child`);
  assert.deepEqual(spawners.filter((f) => !PINS_VIA_MODULE.test(source(f))), []);
});

test('pinning leaves the heap term real, so a starved heap still stops a scan', async () => {
  const { setMemoryReaders, memoryStatus, MEMORY_FLOOR } = await import('../lib/kernel/memory.mjs');
  const { PINNED_FREE } = await import('./pin-machine.mjs');

  assert.equal(memoryStatus().osHeadroom, PINNED_FREE, 'the machine term is the pinned one');

  setMemoryReaders({
    heap: () => ({ used_heap_size: 4000 * 1024 * 1024, heap_size_limit: 4096 * 1024 * 1024 }),
    free: () => PINNED_FREE,
  });
  assert.ok(memoryStatus().available < MEMORY_FLOOR, 'a full heap is still reported as no room');

  setMemoryReaders({ free: () => PINNED_FREE });
});
