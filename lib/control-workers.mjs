// SPDX-License-Identifier: AGPL-3.0-or-later
// Control analyses of the programs ahead of the one the flow set is summarising, built in worker
// threads.
//
// A worker parses a file as the directory tree does (tree.parseSpec), runs buildControl on each
// program in it and posts each analysis kept as lib/control-reuse.mjs keeps a copy's: references into
// the parse as positions in a fixed walk of it. The main thread restores that onto its own parse of the
// same file, so the analysis it uses is made of its own objects. The scan stays synchronous: waiting
// for an answer blocks on a counter the workers raise as they post.
//
// A file no worker has started when the main thread reaches it is taken back, and the main thread
// analyses it itself. Only a started one is waited for.
import { availableParallelism } from 'node:os';
import { getHeapStatistics } from 'node:v8';
import { MessageChannel, Worker, isMainThread, parentPort, receiveMessageOnPort, workerData } from 'node:worker_threads';
import { buildControl, internFacts, namesOf } from './control.mjs';
import { keep, parseOrder } from './control-reuse.mjs';
import { parseInDirectory } from './kernel/source-tree.mjs';

export const CONTROL_WORKERS_ENV = 'COBOLWORK_CONTROL_WORKERS';
// Below this much program text, restoring an analysis on the main thread costs about what building
// it does: on ACAS, 410 programs, moving every one saved 1 s of 3.3 s.
export const CONTROL_WORKER_MIN_BYTES = 32 * 1024;

// A slot holds a task's id and its state together, so a message for a task whose slot has since been
// reused finds a different id there and is not started.
const QUEUED = 0;
const STARTED = 1;
const CANCELLED = 2;
const SLOTS = 1024;
const slotOf = (id) => id % SLOTS;
const stateOf = (id, state) => ((id % (1 << 28)) << 2) | state;

// The program's file and the copybooks its parse resolved, which the kept analysis names by position.
export const programFiles = (r, file) => [file, ...r.copies.filter((c) => c.path).map((c) => c.path)];

// Each program of a parsed file: { value }, its analysis kept; { none }, no procedure division;
// { threw }, buildControl threw; { local }, the analysis holds something keep() does not carry.
export function analyseFile(r, file) {
  const files = programFiles(r, file);
  return r.programs.map((prog) => {
    let ctl;
    try { ctl = buildControl(prog, namesOf(prog).resolve); } catch { return { threw: true }; }
    if (!ctl) return { none: true };
    internFacts(ctl.facts);
    const value = keep(ctl, parseOrder(prog), files);
    return value ? { value } : { local: true };
  });
}

function serve({ spec, port, signal, states }) {
  parentPort.on('message', ({ id, file }) => {
    if (Atomics.compareExchange(states, slotOf(id), stateOf(id, QUEUED), stateOf(id, STARTED)) !== stateOf(id, QUEUED)) return;
    let programs = null;
    try { programs = analyseFile(parseInDirectory(spec, file), file); } catch { /* the main thread's own parse reports it */ }
    try { port.postMessage({ id, programs }); } catch { port.postMessage({ id, programs: null }); }
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0);
  });
}

if (!isMainThread && workerData?.controlWorker) serve(workerData);

// How many workers a scan starts: COBOLWORK_CONTROL_WORKERS, else one fewer than the machine's
// threads, at most four. Each holds one program's parse and analysis at a time, up to 1.3 GB on
// programs of 15 MB.
export function controlWorkerCount() {
  const n = Number(process.env[CONTROL_WORKERS_ENV]);
  if (process.env[CONTROL_WORKERS_ENV] !== undefined && Number.isInteger(n) && n >= 0) return n;
  return Math.max(0, Math.min(4, availableParallelism() - 1));
}

// Analyses of `files` built ahead of the main thread, for those `wanted` selects. take(file, index)
// returns the file's answer, one entry per program, or null where the main thread must analyse it.
// Files are asked for in order, at most one more than there are workers at a time, since an answer
// waiting to be taken holds the whole analysis.
//
// Every failure a worker can catch is answered. One that runs out of heap dies without answering, and
// nothing the main thread can read while it waits says so. A worker's heap is as large as the main
// thread's, so a program that exhausts it would exhaust the main thread's too: the wait for a started
// analysis is long rather than tuned, and past it the main thread analyses the program itself.
export function controlAhead(spec, files, wanted, { workers, waitMs = 30 * 60_000 }) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const states = new Int32Array(new SharedArrayBuffer(4 * SLOTS));
  const maxOldGenerationSizeMb = Math.ceil(getHeapStatistics().heap_size_limit / (1024 * 1024));
  const startWorker = () => {
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { controlWorker: true, spec, port: port2, signal, states },
      transferList: [port2],
      resourceLimits: { maxOldGenerationSizeMb },
    });
    worker.on('error', () => {});
    worker.unref();
    port1.unref();
    return { worker, port: port1, load: 0 };
  };
  const pool = [];
  // Tasks by id until a worker answers or the task is taken back before it starts; by file while the
  // main thread may still take them.
  const byId = new Map();
  const byFile = new Map();
  let nextId = 0;
  let nextIndex = 0;
  const drain = () => {
    for (const w of pool) {
      for (let m = receiveMessageOnPort(w.port); m; m = receiveMessageOnPort(w.port)) {
        const task = byId.get(m.message.id);
        if (!task) continue;
        byId.delete(task.id);
        task.by.load--;
        if (byFile.get(task.file) === task) { task.done = true; task.programs = m.message.programs; }
      }
    }
  };
  const takeBack = (task) => {
    if (Atomics.compareExchange(states, slotOf(task.id), stateOf(task.id, QUEUED), stateOf(task.id, CANCELLED)) !== stateOf(task.id, QUEUED)) return false;
    byId.delete(task.id);
    task.by.load--;
    return true;
  };
  const forget = (task) => {
    byFile.delete(task.file);
    if (!task.done) takeBack(task);
  };
  const fill = (from) => {
    if (nextIndex < from) nextIndex = from;
    while (byFile.size <= workers && nextIndex < files.length) {
      const index = nextIndex++;
      const file = files[index];
      if (!wanted(file)) continue;
      if (!pool.length) for (let i = 0; i < workers; i++) pool.push(startWorker());
      const id = nextId++;
      const by = pool.reduce((a, b) => (b.load < a.load ? b : a));
      const task = { id, file, index, by, done: false, programs: null };
      Atomics.store(states, slotOf(id), stateOf(id, QUEUED));
      by.load++;
      byId.set(id, task);
      byFile.set(file, task);
      by.worker.postMessage({ id, file });
    }
  };
  return {
    take(file, index) {
      drain();
      for (const t of byFile.values()) if (t.index < index) forget(t);
      const task = byFile.get(file);
      fill(index + 1);
      if (!task) return null;
      const deadline = Date.now() + waitMs;
      let programs = null;
      for (;;) {
        if (task.done) { programs = task.programs; break; }
        if (takeBack(task)) break;
        const seen = Atomics.load(signal, 0);
        drain();
        if (task.done) continue;
        if (Date.now() > deadline) break;
        Atomics.wait(signal, 0, seen, 200);
      }
      byFile.delete(file);
      fill(index + 1);
      return programs;
    },
    close() {
      for (const w of pool) { w.port.close(); w.worker.terminate(); }
      byId.clear();
      byFile.clear();
    },
  };
}
