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

// A task is the index of a wanted file. Workers claim tasks in order through a shared counter and
// start one only once the main thread's limit has passed it, so a task never waits behind a busy
// worker while another is idle.
const QUEUED = 0;
const STARTED = 1;
const CANCELLED = 2;
const CLAIM = 0;
const LIMIT = 1;

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

function serve({ spec, port, signal, control, states, tasks }) {
  for (;;) {
    const t = Atomics.add(control, CLAIM, 1);
    if (t >= tasks.length) return;
    for (let limit = Atomics.load(control, LIMIT); t >= limit; limit = Atomics.load(control, LIMIT)) Atomics.wait(control, LIMIT, limit);
    if (Atomics.compareExchange(states, t, QUEUED, STARTED) !== QUEUED) continue;
    let programs = null;
    try { programs = analyseFile(parseInDirectory(spec, tasks[t]), tasks[t]); } catch { /* the main thread's own parse reports it */ }
    try { port.postMessage({ t, programs }); } catch { port.postMessage({ t, programs: null }); }
    Atomics.add(signal, 0, 1);
    Atomics.notify(signal, 0);
  }
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
// Files are asked for in order. Workers start at most `ahead` wanted files past the one the main
// thread is on, since an answer waiting to be taken holds the whole analysis. Twice the workers by
// default: a large program's analysis takes as long as the main thread's own work on several files,
// and on cnafbadboy's Batch, scheduled from its measured costs, one more than the workers leaves the
// main thread waiting a fifth of its loop and twice the workers about 1%.
//
// Every failure a worker can catch is answered. One that runs out of heap dies without answering, and
// nothing the main thread can read while it waits says so. A worker's heap is as large as the main
// thread's, so a program that exhausts it would exhaust the main thread's too: the wait for a started
// analysis is long rather than tuned, and past it the main thread analyses the program itself.
export function controlAhead(spec, files, wanted, { workers, ahead = 2 * workers, waitMs = 30 * 60_000 }) {
  const tasks = [];
  const indexOf = [];
  files.forEach((f, i) => { if (wanted(f)) { tasks.push(f); indexOf.push(i); } });
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const control = new Int32Array(new SharedArrayBuffer(8));
  const states = new Int32Array(new SharedArrayBuffer(4 * Math.max(1, tasks.length)));
  const maxOldGenerationSizeMb = Math.ceil(getHeapStatistics().heap_size_limit / (1024 * 1024));
  const startWorker = () => {
    const { port1, port2 } = new MessageChannel();
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { controlWorker: true, spec, port: port2, signal, control, states, tasks },
      transferList: [port2],
      resourceLimits: { maxOldGenerationSizeMb },
    });
    worker.on('error', () => {});
    worker.unref();
    port1.unref();
    return { worker, port: port1 };
  };
  const pool = tasks.length ? Array.from({ length: workers }, startWorker) : [];
  // The first task the main thread has neither taken nor passed, and the answers from it on.
  let next = 0;
  const answers = new Map();
  const drain = () => {
    for (const w of pool) {
      for (let m = receiveMessageOnPort(w.port); m; m = receiveMessageOnPort(w.port)) {
        if (m.message.t >= next) answers.set(m.message.t, m.message.programs);
      }
    }
  };
  const pass = () => {
    Atomics.compareExchange(states, next, QUEUED, CANCELLED);
    answers.delete(next++);
  };
  const offer = (upTo) => {
    const limit = Math.min(tasks.length, upTo);
    if (limit <= Atomics.load(control, LIMIT)) return;
    Atomics.store(control, LIMIT, limit);
    Atomics.notify(control, LIMIT);
  };
  return {
    take(file, index) {
      drain();
      while (next < tasks.length && indexOf[next] < index) pass();
      if (next >= tasks.length || indexOf[next] !== index) { offer(next + ahead); return null; }
      const t = next;
      const notStarted = Atomics.compareExchange(states, t, QUEUED, CANCELLED) === QUEUED;
      offer(t + 1 + ahead);
      let programs = null;
      if (!notStarted) {
        const deadline = Date.now() + waitMs;
        for (;;) {
          const seen = Atomics.load(signal, 0);
          drain();
          if (answers.has(t) || Date.now() > deadline) break;
          Atomics.wait(signal, 0, seen, 200);
        }
        programs = answers.get(t) ?? null;
      }
      answers.delete(t);
      next = t + 1;
      return programs;
    },
    close() {
      for (let t = next; t < tasks.length; t++) Atomics.compareExchange(states, t, QUEUED, CANCELLED);
      Atomics.store(control, LIMIT, tasks.length);
      Atomics.notify(control, LIMIT);
      for (const w of pool) { w.port.close(); w.worker.terminate(); }
      answers.clear();
    },
  };
}
