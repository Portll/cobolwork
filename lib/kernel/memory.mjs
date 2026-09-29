// SPDX-License-Identifier: AGPL-3.0-or-later
// One place that decides how much more this process can afford to read, and one loop that every
// rule set uses to stay inside it.
//
// Two different failures put a scan on the floor, and a budget in bytes of source only answers the
// first:
//
//   volume        a repository holds more source than the heap can take. A byte budget answers
//                 this: stop reading at N bytes, report the rest as unread.
//
//   accumulation  a rule set holds a structure whose size is not proportional to the source it has
//                 read - a parse tree per program, a graph node per data item. The byte budget is
//                 useless here, because the thing that grows is not the bytes. A 100,000-program
//                 repository exhausted an 8GB heap with a 32MB source budget in force, because the
//                 budget bounded the input and nothing bounded the structure.
//
// So this module measures the heap itself rather than trusting a proxy for it. `getAvailableMemory`
// asks V8 what is left and asks the operating system whether it agrees; `watchMemoryBuffer` turns
// that into a decision with hysteresis, so a scan does not stop on one unlucky sample taken before
// a collection; and `eachWithinMemory` is the loop, so no rule set has to get this right on its own.
//
// What is never done is stopping quietly. Every function here reports what it did not read, and the
// caller is expected to put that in `coverageIncomplete` - a finding count over files nobody opened
// is not a clean result, and running out of memory is not an excuse to pretend otherwise.
import { freemem } from 'node:os';
import { getHeapStatistics } from 'node:v8';

const MB = 1024 * 1024;

// A floor below which we stop regardless of fractions. Enough to finish the statement in progress,
// build a report and serialise it.
export const MEMORY_FLOOR = 192 * MB;

// How much of the heap to leave unspent. V8 needs headroom to collect at all: a mark-compact that
// cannot find room is the "ineffective mark-compacts near heap limit" failure, which is a crash
// rather than a slowdown.
export const MEMORY_RESERVE = 0.2;

let override = null;

// The two readings this module takes from outside itself, and the only two. Both are injectable,
// because a test that asks the real machine is a test whose verdict is a property of the machine.
//
// This was not hypothetical. Two sessions ran the same commit: one saw 206 of 206 pass with 502 MB
// free, the other saw 17 fail with 330 MB free. The failing assertion was that a watcher reports
// 'ok' when there is room, and whether there was room depended on what else the box happened to be
// doing - other test workers, an editor, a second agent. `node --test` runs a process per file, so
// the heaps were never shared; freemem() was, because it is the whole machine.
//
// Note which of the two is the dangerous one. `available` is the lesser of the heap's headroom and
// the machine's, and on both boxes the machine term won - by 8x on one and 13x on the other. So
// injecting a heap reader alone would leave the term that actually decides still wired to the
// operating system, and the tests would look fixed while remaining a measurement of the hardware.

// An operator's statement about the machine, in megabytes, for a process whose share of it is not
// what `freemem` reports: a container with a memory limit, a CI runner sharing a host, a scan run
// beside other work. `freemem` is the whole box, so without this the scan's coverage is decided by
// what else the box happens to be doing - which is a real result, and usually not the one wanted.
// It is honoured by a child process too, which is how a spawned scan inherits the same statement.
export const FREE_MEMORY_ENV = 'COBOLWORK_FREE_MEMORY_MB';

function envFree() {
  const mb = Number(process.env[FREE_MEMORY_ENV]);
  return Number.isFinite(mb) && mb > 0 ? () => mb * MB : null;
}

const defaultFree = () => (envFree() || freemem)();

let readHeap = getHeapStatistics;
let readFree = defaultFree;

// Replace either reading. Called with nothing, or with a missing key, it restores the default one -
// so a test can hand back the machine as easily as it took it. The default free reader honours
// COBOLWORK_FREE_MEMORY_MB, so restoring does not discard an operator's statement.
export function setMemoryReaders({ heap = null, free = null } = {}) {
  readHeap = heap || getHeapStatistics;
  readFree = free || defaultFree;
}

// An explicit ceiling, in bytes, for callers that know better than the heap does - a CI box sharing
// a machine, a test that wants deterministic behaviour, an operator who has measured. Pass null to
// go back to asking V8.
export function setAvailableMemory(bytes) {
  override = bytes == null ? null : Math.max(0, Number(bytes));
}

export function memoryStatus() {
  const h = readHeap();
  const used = h.used_heap_size;
  const limit = override == null ? h.heap_size_limit : override;
  const heapHeadroom = Math.max(0, limit - used);
  // The heap limit is a promise V8 makes about itself, not about the machine. If the operating
  // system has less free than V8 thinks it may take, the operating system wins.
  const osHeadroom = readFree();
  return {
    limit, used, heapHeadroom, osHeadroom,
    available: Math.max(0, Math.min(heapHeadroom, osHeadroom)),
    fractionUsed: limit > 0 ? used / limit : 1,
    overridden: override != null,
  };
}

export const getAvailableMemory = () => memoryStatus().available;

// Is there room to keep going? Returns 'ok', 'tight' (stop taking on new work) or 'exhausted'.
//
// Hysteresis matters: heapUsed sawtooths, and a single sample taken just before a collection would
// stop a scan that had plenty of room. A watcher reports 'tight' only after `patience` consecutive
// samples agree, so one unlucky reading is not a verdict.
export function watchMemoryBuffer({ reserve = MEMORY_RESERVE, floor = MEMORY_FLOOR, patience = 3 } = {}) {
  let consecutive = 0;
  let peak = 0;
  let samples = 0;

  return {
    check() {
      const s = memoryStatus();
      samples++;
      peak = Math.max(peak, s.used);
      const tight = s.available < floor || s.fractionUsed > 1 - reserve;
      consecutive = tight ? consecutive + 1 : 0;
      if (s.available < floor / 4) return 'exhausted';        // one sample is enough to believe this
      return consecutive >= patience ? 'tight' : 'ok';
    },
    // A collection, if the process was started with --expose-gc. Never required: the loop is
    // correct without it, and this only buys back headroom that was already garbage.
    //
    // It resets the patience counter because the readings before a collection describe a heap that
    // no longer exists. That reset is why `stillTight` exists and why the caller must use it: on
    // its own it would hand back a clean slate every time, and a loop that collects whenever it is
    // told it is tight would never accumulate the consecutive readings needed to stop.
    collect() {
      if (typeof global.gc === 'function') { global.gc(); consecutive = 0; return true; }
      return false;
    },
    // Is it still tight, right now, with no hysteresis?
    //
    // Hysteresis exists so that one unlucky sample taken just before a collection cannot stop a
    // scan that had room. Immediately after a collection there is nothing left to be unlucky
    // about, so the question is no longer "have several readings agreed" but the simpler one:
    // did the collection actually help. Asking `check()` here instead is what defeated the guard -
    // the reset inside `collect` guaranteed it answered 'ok', so a run started with --expose-gc
    // ran on through sustained pressure until V8 aborted with ineffective mark-compacts. That is
    // not hypothetical: it is how a 100,000-program repository killed a corpus run, on the guard
    // written to stop exactly that.
    stillTight() {
      const s = memoryStatus();
      return s.available < floor || s.fractionUsed > 1 - reserve;
    },
    get peak() { return peak; },
    get samples() { return samples; },
  };
}

const STOPPED_BECAUSE = {
  'byte budget': 'the scan reached its source byte budget',
  'memory reserve': 'the scan reached its memory reserve',
  'memory exhausted': 'memory ran out',
};
export const stoppedBecause = (stoppedBy) => STOPPED_BECAUSE[stoppedBy] || `the scan stopped (${stoppedBy})`;

// The loop every rule set uses instead of `for (const f of files)`.
//
// It stops when memory runs short or when a byte budget is spent, and it says which, and it names
// everything it did not get to. `work` returns the number of bytes it took on, or nothing; a rule
// set that reads a file should return its length so the byte budget means something.
export function eachWithinMemory(items, work, {
  maxBytes = Infinity,
  every = 8,                 // sample the heap this often, not on every item
  watcher = null,
  label = 'scan',
} = {}) {
  const w = watcher || watchMemoryBuffer();
  const skipped = [];
  let processed = 0;
  let bytes = 0;
  let stoppedBy = null;

  for (let i = 0; i < items.length; i++) {
    if (stoppedBy) { skipped.push(items[i]); continue; }

    if (bytes >= maxBytes) { stoppedBy = 'byte budget'; skipped.push(items[i]); continue; }

    // Checking costs a syscall, so it is sampled rather than continuous - except once the heap is
    // already past the reserve, when every item is checked because the next one may be the last.
    if (i % every === 0 || w.check === undefined || memoryStatus().fractionUsed > 1 - MEMORY_RESERVE) {
      const state = w.check();
      if (state === 'exhausted' || state === 'tight') {
        // Collect, and carry on only if the collection genuinely helped. Asking `check()` here
        // instead asked a counter that `collect` had just reset, so the answer was always 'ok'.
        if (!w.collect() || w.stillTight()) {
          stoppedBy = state === 'exhausted' ? 'memory exhausted' : 'memory reserve';
          skipped.push(items[i]);
          continue;
        }
      }
    }

    const took = work(items[i], i);
    if (typeof took === 'number') bytes += took;
    processed++;
  }

  return {
    label,
    processed,
    bytes,
    skipped,
    complete: skipped.length === 0,
    stoppedBy,
    peakHeapBytes: w.peak,
    // The sentence a report should carry. Written here so every rule set says it the same way.
    note: skipped.length === 0 ? null
      : `${label}: ${skipped.length} of ${items.length} files were not read because ${stoppedBecause(stoppedBy)}. `
        + 'The findings below are over what was read, and are not a result for this repository as a whole.',
  };
}
