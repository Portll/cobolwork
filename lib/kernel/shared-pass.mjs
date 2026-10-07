// SPDX-License-Identifier: AGPL-3.0-or-later
// One pass over the tree for every rule set that reads programs, so that a file is read and parsed
// once per scan rather than once per set.
//
// A set's scan is a generator. Where it would run its guarded loop it yields `loopOver(...)` and is
// resumed with the loop's account, exactly what eachWithinMemory would have returned. `drive` runs
// one set on its own, its loop as it always ran. `driveTogether` runs several: it gathers the loop
// each asks for, walks the files of all of them once in the tree's order, gives each set its own
// files in its own order, and resumes each with its own account. While a file is being handed round,
// the tree answers text() and parse() for it from what the first set to ask was given.
//
// Each set's per-file work is unchanged, so its findings are the ones it reported alone. What is
// shared is the reading and the parse, which is why no set may change a parse result it is given.
import { eachWithinMemory, memoryStatus, stoppedBecause, watchMemoryBuffer, MEMORY_RESERVE } from './memory.mjs';

const LOOP = Symbol('loop');
const LOOPS = Symbol('loops');

// What a set yields in place of `eachWithinMemory(items, work, opts)`. `guarded: false` asks for a
// plain loop: every item, no memory check and no byte budget.
export const loopOver = (items, work, opts = {}) => ({ [LOOP]: true, items, work, opts });

// Several loops of one set walked in the same pass, each with its own account, the set resumed with
// their accounts in the order given. A file both loops hold goes to the first, then the second.
export const loopsOver = (...loops) => ({ [LOOPS]: true, loops });
const loopsOf = (value) => (value[LOOPS] ? value.loops : [value]);
const resumeWith = (value, runs) => (value[LOOPS] ? runs : runs[0]);

function plainLoop(items, work, label) {
  for (let i = 0; i < items.length; i++) work(items[i], i);
  return { label, processed: items.length, bytes: 0, skipped: [], complete: true, stoppedBy: null, peakHeapBytes: 0, note: null };
}

const runAlone = (req) => (req.opts.guarded === false
  ? plainLoop(req.items, req.work, req.opts.label || 'scan')
  : eachWithinMemory(req.items, req.work, req.opts));

export function drive(steps) {
  let step = steps.next();
  while (!step.done) step = steps.next(resumeWith(step.value, loopsOf(step.value).map(runAlone)));
  return step.value;
}

// A tree that, while `focus` names a file, answers bytes(), text() and parse() for that file once and
// hands every later caller the same answer, its error included. A tree whose text is its bytes
// through `decode` has the file read once for both.
export function sharingTree(base) {
  let focus = null;
  let bytes = null;
  let text = null;
  let parsed = null;
  const once = (held, read) => {
    if (!held) { try { held = { value: read() }; } catch (e) { held = { error: e }; } }
    return held;
  };
  const answer = (held) => {
    if (held.error) throw held.error;
    return held.value;
  };
  const tree = {
    ...base,
    focusOn(f) { focus = f; bytes = null; text = null; parsed = null; },
    bytes(p) {
      if (p !== focus) return base.bytes(p);
      bytes = once(bytes, () => base.bytes(p));
      return answer(bytes);
    },
    text(p) {
      if (p !== focus) return base.text(p);
      text = once(text, () => (base.decode ? base.decode(tree.bytes(p)) : base.text(p)));
      return answer(text);
    },
    parse(p, src) {
      if (p !== focus) return base.parse(p, src);
      const own = src ?? tree.text(p).text;
      if (!parsed || parsed.src !== own) {
        try { parsed = { src: own, value: base.parse(p, own) }; } catch (e) { parsed = { src: own, error: e }; }
      }
      if (parsed.error) throw parsed.error;
      return parsed.value;
    },
  };
  return tree;
}

// Runs every generator to completion and returns their results in the order given. A generator
// that throws, before its loop or inside it, yields { error } in its place, as a set that throws
// alone does; the others carry on.
export function driveTogether(stepsList, tree) {
  const live = stepsList.map((steps) => ({ steps, step: null, result: undefined, error: null }));
  const advance = (g, input, thrown) => {
    try { g.step = thrown ? g.steps.throw(thrown) : g.steps.next(input); } catch (e) { g.error = e; g.step = { done: true }; return; }
    if (g.step.done) g.result = g.step.value;
  };
  for (const g of live) advance(g);
  for (;;) {
    const waiting = live.filter((g) => !g.step.done);
    if (!waiting.length) break;
    const runs = mergedLoop(waiting.flatMap((g) => loopsOf(g.step.value)), tree);
    let at = 0;
    for (const g of waiting) {
      const own = runs.slice(at, at += loopsOf(g.step.value).length);
      advance(g, resumeWith(g.step.value, own.map((r) => r.run)), own.find((r) => r.error)?.error);
    }
  }
  return live.map((g) => (g.error ? { error: g.error } : g.result));
}

// The files of every request, once each, in the order of the tree's list. A request whose items are
// not in that order runs alone first, so no set sees its files in an order its own loop would not use.
function mergedLoop(requests, tree) {
  const rank = new Map(tree.list().map((p, i) => [p, i]));
  const inOrder = (items) => items.every((p, i) => rank.has(p) && (i === 0 || rank.get(items[i - 1]) < rank.get(p)));
  const states = requests.map((req) => ({
    req, guarded: req.opts.guarded !== false, maxBytes: req.opts.maxBytes ?? Infinity, label: req.opts.label || 'scan',
    next: 0, processed: 0, bytes: 0, skipped: [], stoppedBy: null, error: null, alone: null,
  }));
  for (const s of states) if (!inOrder(s.req.items)) {
    try { s.alone = runAlone(s.req); } catch (e) { s.error = e; s.alone = {}; }
  }
  const shared = states.filter((s) => !s.alone);
  const w = shared.map((s) => s.req.opts.watcher).find(Boolean) || watchMemoryBuffer();
  const every = Math.min(...shared.map((s) => s.req.opts.every ?? 8), 8);
  const files = [...new Set(shared.flatMap((s) => s.req.items))].sort((a, b) => rank.get(a) - rank.get(b));
  let stoppedBy = null;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const wanting = shared.filter((s) => s.req.items[s.next] === f);
    if (!stoppedBy && wanting.some((s) => s.guarded && !s.error && s.bytes < s.maxBytes)
      && (i % every === 0 || memoryStatus().fractionUsed > 1 - MEMORY_RESERVE)) {
      const state = w.check();
      if ((state === 'exhausted' || state === 'tight') && (!w.collect() || w.stillTight())) {
        stoppedBy = state === 'exhausted' ? 'memory exhausted' : 'memory reserve';
      }
    }
    tree.focusOn?.(f);
    for (const s of wanting) {
      const index = s.next++;
      if (s.error) continue;
      if (s.guarded) {
        if (s.stoppedBy) { s.skipped.push(f); continue; }
        if (s.bytes >= s.maxBytes) { s.stoppedBy = 'byte budget'; s.skipped.push(f); continue; }
        if (stoppedBy) { s.stoppedBy = stoppedBy; s.skipped.push(f); continue; }
      }
      let took;
      try { took = s.req.work(f, index); } catch (e) { s.error = e; continue; }
      if (typeof took === 'number') s.bytes += took;
      s.processed++;
    }
    tree.focusOn?.(null);
  }
  return states.map((s) => {
    if (s.alone) return { run: s.alone, error: s.error };
    const { items } = s.req;
    const run = s.guarded
      ? { label: s.label, processed: s.processed, bytes: s.bytes, skipped: s.skipped, complete: s.skipped.length === 0, stoppedBy: s.stoppedBy, peakHeapBytes: w.peak,
        note: s.skipped.length === 0 ? null
          : `${s.label}: ${s.skipped.length} of ${items.length} files were not read because ${stoppedBecause(s.stoppedBy)}. `
            + 'The findings below are over what was read, and are not a result for this repository as a whole.' }
      : { label: s.label, processed: s.processed, bytes: 0, skipped: [], complete: true, stoppedBy: null, peakHeapBytes: 0, note: null };
    return { run, error: s.error };
  });
}
