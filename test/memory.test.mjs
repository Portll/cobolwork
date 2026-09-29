import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAvailableMemory, setAvailableMemory, memoryStatus, watchMemoryBuffer,
  eachWithinMemory, MEMORY_FLOOR, setMemoryReaders, stoppedBecause, FREE_MEMORY_ENV,
} from '../lib/kernel/memory.mjs';
import { scan as scanFlow } from '../lib/sets/flow.mjs';

const MB = 1024 * 1024;

// A machine with room, stated rather than hoped for.
//
// Every test below that needs "there is space to carry on" used to get it by handing back to the
// real machine, which made its verdict a property of whatever else the box was running. On a box
// with under 192 MB free - MEMORY_FLOOR - the watcher correctly reports 'tight' and those tests
// failed, having tested the hardware rather than the logic. `node --test` runs a process per file,
// so a full parallel run is several workers each holding a parser and a corpus, and the suite
// depresses the very number it is asserting on.
//
// So the machine is declared. The tests that want a shortage still create one with
// setAvailableMemory, which is about this module's own ceiling and was always deterministic.
const roomy = () => setMemoryReaders({
  heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }),
  free: () => 4096 * MB,
});

// Hand the real machine back. Anything asserting on genuine V8 or OS numbers uses this.
const realMachine = () => setMemoryReaders();

// This one asks the real machine on purpose: it is asserting that the two readings are combined
// correctly, and both sides come from the same snapshot, so it cannot drift however busy the box is.
test('available memory is what V8 has left, capped by what the machine has left', () => {
  realMachine();
  setAvailableMemory(null);
  const s = memoryStatus();
  assert.ok(s.limit > 0);
  assert.ok(s.used > 0 && s.used <= s.limit);
  // The heap limit is a promise V8 makes about itself, not about the machine.
  assert.equal(s.available, Math.max(0, Math.min(s.heapHeadroom, s.osHeadroom)));
  assert.equal(s.overridden, false);
});

test('an explicit ceiling overrides what V8 believes, and can be taken back', () => {
  roomy();
  const natural = getAvailableMemory();
  setAvailableMemory(memoryStatus().used + 5 * 1024 * 1024);
  const capped = memoryStatus();
  assert.equal(capped.overridden, true);
  assert.ok(capped.available < natural, 'a lower ceiling leaves less available');
  setAvailableMemory(null);
  assert.equal(memoryStatus().overridden, false);
});

test('a watcher does not stop on one unlucky sample', () => {
  // heapUsed sawtooths. A single reading taken just before a collection would stop a scan that had
  // room, so a verdict needs consecutive agreement.
  roomy();
  setAvailableMemory(memoryStatus().used + 1024);      // nothing is available
  const w = watchMemoryBuffer({ patience: 3, floor: MEMORY_FLOOR });
  const first = w.check();
  setAvailableMemory(null);                             // plenty is available again
  assert.ok(['ok', 'tight', 'exhausted'].includes(first));
  const w2 = watchMemoryBuffer({ patience: 3 });
  assert.equal(w2.check(), 'ok', 'with room, the answer is ok');
});

test('a hard shortage is believed immediately, without waiting for patience', () => {
  roomy();
  setAvailableMemory(memoryStatus().used + 1024);
  const w = watchMemoryBuffer({ patience: 99 });
  assert.equal(w.check(), 'exhausted', 'patience does not apply when there is nothing left at all');
  setAvailableMemory(null);
});

test('the loop runs everything when there is room', () => {
  roomy();
  setAvailableMemory(null);
  const seen = [];
  const r = eachWithinMemory([1, 2, 3, 4, 5], (x) => { seen.push(x); return 10; }, { label: 't' });
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  assert.equal(r.processed, 5);
  assert.equal(r.bytes, 50);
  assert.deepEqual(r.skipped, []);
  assert.equal(r.complete, true);
  assert.equal(r.stoppedBy, null);
  assert.equal(r.note, null, 'nothing to say when nothing was missed');
});

test('the loop stops at a byte budget and names what it did not read', () => {
  roomy();
  setAvailableMemory(null);
  const seen = [];
  const r = eachWithinMemory(['a', 'b', 'c', 'd'], (x) => { seen.push(x); return 100; },
    { label: 'flow', maxBytes: 250 });
  assert.deepEqual(seen, ['a', 'b', 'c'], 'it stops once the budget is spent, not before');
  assert.deepEqual(r.skipped, ['d']);
  assert.equal(r.stoppedBy, 'byte budget');
  assert.equal(r.complete, false);
  assert.match(r.note, /1 of 4 files were not read/);
  assert.match(r.note, /because the scan reached its source byte budget/);
  assert.match(r.note, /not a result for this repository as a whole/);
});

test('every stop reason reads as a clause', () => {
  assert.equal(stoppedBecause('memory exhausted'), 'memory ran out');
  assert.equal(stoppedBecause('memory reserve'), 'the scan reached its memory reserve');
  assert.equal(stoppedBecause('byte budget'), 'the scan reached its source byte budget');
  assert.equal(stoppedBecause('something new'), 'the scan stopped (something new)', 'an unnamed reason is quoted, not dropped');
});

// The failure this module exists for: a byte budget bounds the input, and the thing that actually
// grew was a structure whose size had nothing to do with bytes. A 100,000-program repository
// exhausted an 8GB heap with a 32MB source budget in force.
test('the loop stops on memory pressure even when the byte budget is untouched', () => {
  roomy();
  setAvailableMemory(null);
  const seen = [];
  const r = eachWithinMemory([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (x) => {
    seen.push(x);
    // Whatever is accumulating here is not measured in the bytes read.
    if (x === 1) setAvailableMemory(memoryStatus().used + 1024);
    return 0;
  }, { label: 'cics', maxBytes: Infinity, every: 1 });

  setAvailableMemory(null);
  assert.ok(seen.length < 10, 'it stopped before the end');
  assert.ok(r.skipped.length > 0);
  assert.match(String(r.stoppedBy), /memory/);
  assert.equal(r.bytes, 0, 'and the byte budget never noticed anything');
  assert.match(r.note, /cics/);
});

test('a stopped loop still reports a peak and a count, so a report can say what happened', () => {
  roomy();
  setAvailableMemory(null);
  const r = eachWithinMemory([1, 2, 3], (x) => {
    if (x === 1) setAvailableMemory(memoryStatus().used + 1024);
    return 0;
  }, { every: 1 });
  setAvailableMemory(null);
  assert.ok(r.peakHeapBytes > 0);
  assert.equal(r.processed + r.skipped.length, 3, 'every item is accounted for, read or not');
});

test('a watcher shared across calls carries its state, so one run cannot spend the whole heap', () => {
  roomy();
  setAvailableMemory(null);
  const w = watchMemoryBuffer();
  const a = eachWithinMemory([1, 2], () => 0, { watcher: w });
  const b = eachWithinMemory([3, 4], () => 0, { watcher: w });
  assert.equal(a.complete, true);
  assert.equal(b.complete, true);
  assert.ok(w.samples >= 2, 'both runs reported to the same watcher');
  realMachine();
});

// The regression test for the flake itself. A box under the floor used to fail the assertions
// above, and a green re-run on a quieter box was what made it expensive to diagnose: two people
// measured the same commit and disagreed, and neither was wrong about what they saw.
test('a starved machine does not change the answer for a run that has room', () => {
  setAvailableMemory(null);
  // 16 MB free, well under MEMORY_FLOOR: the condition that produced the failures.
  setMemoryReaders({
    heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }),
    free: () => 16 * MB,
  });
  assert.equal(watchMemoryBuffer({ patience: 3 }).check(), 'exhausted',
    'a machine with 16 MB free is genuinely out of room, and the watcher says so');

  roomy();
  assert.equal(watchMemoryBuffer({ patience: 3 }).check(), 'ok',
    'and with room declared, the answer does not depend on what else the box is doing');
  realMachine();
});

// --expose-gc used to disable the guard entirely, which is the opposite of what anyone passing it
// expects. collect() resets the patience counter - correctly, because the readings before a
// collection describe a heap that no longer exists - and the loop then asked check(), which needs
// three consecutive tight readings and had just had its counter wiped. So every tight verdict
// erased itself, and a run with --expose-gc read on through sustained pressure until V8 aborted
// with "ineffective mark-compacts near heap limit".
//
// That is not hypothetical. It killed a corpus run on JMRoldanF__volume-100k - a 100,000-program
// repository, which is the exact case this module's header says it was written for.
test('a run with --expose-gc stops on memory pressure, like one without', () => {
  const tightMachine = () => setMemoryReaders({
    heap: () => ({ used_heap_size: 3450 * MB, heap_size_limit: 4288 * MB }),  // 80.5%, past the reserve
    free: () => 300 * MB,
  });

  tightMachine();
  const r = eachWithinMemory([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], () => 0, { every: 1, label: 'probe' });
  realMachine();

  assert.ok(r.stoppedBy, 'the guard stopped');
  assert.match(String(r.stoppedBy), /memory/);
  assert.ok(r.processed < 10, `it stopped early, not after every item (processed ${r.processed})`);
  assert.equal(r.processed + r.skipped.length, 10, 'and every item is accounted for');
});

// The other half, and the reason collect() exists at all: a collection that genuinely reclaims
// should buy the run a reprieve rather than being ignored. Three tight readings reach the patience
// limit; the fourth is the one taken just after the collection, by which time the heap is free.
test('a collection that actually helps lets the run carry on', () => {
  let reads = 0;
  setMemoryReaders({
    heap: () => {
      reads++;
      return reads <= 3
        ? { used_heap_size: 3450 * MB, heap_size_limit: 4288 * MB }
        : { used_heap_size: 400 * MB, heap_size_limit: 4288 * MB };
    },
    free: () => 4096 * MB,
  });
  const r = eachWithinMemory([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], () => 0, { every: 1, label: 'probe' });
  realMachine();

  // Only meaningful where a collection is possible at all; without --expose-gc collect() is a
  // no-op and the guard stops, which the test above already covers.
  if (typeof global.gc === 'function') {
    assert.equal(r.stoppedBy, null, 'the reclaimed heap was noticed');
    assert.equal(r.processed, 10);
  } else {
    assert.match(String(r.stoppedBy), /memory/, 'with no gc available there is nothing to reclaim');
  }
});

// stillTight is the instantaneous reading the post-collection check needs. check() cannot answer
// this question, because the counter it depends on was just reset by the collection.
test('stillTight answers without hysteresis, so a reset counter cannot hide pressure', () => {
  setMemoryReaders({
    heap: () => ({ used_heap_size: 3450 * MB, heap_size_limit: 4288 * MB }),
    free: () => 300 * MB,
  });
  const w = watchMemoryBuffer({ patience: 3 });
  assert.equal(w.check(), 'ok', 'one reading is not a verdict');
  assert.equal(w.stillTight(), true, 'but the machine is tight right now, and says so');

  // Declared, not observed. The first version of this handed back to the real machine here and
  // asserted there was room - which is the exact mistake this file's other tests exist to correct,
  // and it failed the moment a corpus run was eating memory alongside the suite.
  roomy();
  assert.equal(w.stillTight(), false, 'and says the opposite once there is room');
  realMachine();
});

// The flow set counted the files the guard kept it from and did not say how many, so a caller
// comparing two runs could learn that one stopped but not how much of the repository it missed.
test('a flow scan the guard stops says how many files it did not reach', () => {
  setMemoryReaders({
    heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }),
    free: () => 16 * MB,
  });
  try {
    const cases = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'cases');
    const s = scanFlow(join(cases, '001-argv-reaches-os-command')).summary;
    assert.equal(s.stoppedBy, 'memory exhausted');
    assert.equal(s.filesNotReached, 2, 'both programs');
    assert.equal(s.coverageIncomplete, true);
  } finally { realMachine(); }
});

// The machine term is the one that decides, and `freemem` answers for the whole box rather than for
// this process's share of it. A container with a limit, a CI runner beside other jobs and a scan run
// alongside a build all need to say so, and a spawned scan needs to inherit what was said.
test('an operator can state the machine term, and a child process inherits it', () => {
  const before = process.env[FREE_MEMORY_ENV];
  try {
    process.env[FREE_MEMORY_ENV] = '2048';
    realMachine();
    assert.equal(memoryStatus().osHeadroom, 2048 * MB, 'stated, not measured');

    // Restoring the readers must not discard the statement: setMemoryReaders() is what a test calls
    // to hand the machine back, and handing back the host's free memory would undo the operator.
    setMemoryReaders({ free: () => 8 * MB });
    assert.equal(memoryStatus().osHeadroom, 8 * MB);
    realMachine();
    assert.equal(memoryStatus().osHeadroom, 2048 * MB, 'the statement survives a restore');

    for (const bad of ['0', '-1', 'lots', '']) {
      process.env[FREE_MEMORY_ENV] = bad;
      realMachine();
      assert.notEqual(memoryStatus().osHeadroom, 0, `${JSON.stringify(bad)} falls back to the machine`);
    }
  } finally {
    if (before === undefined) delete process.env[FREE_MEMORY_ENV];
    else process.env[FREE_MEMORY_ENV] = before;
    realMachine();
  }
});
