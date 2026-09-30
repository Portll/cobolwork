// SPDX-License-Identifier: AGPL-3.0-or-later
// Execution: whether the estate's own runs entered the paragraph a finding is in, from the
// reports `ironwork run --coverage` writes. A finding in a paragraph a run entered is code the tests
// exercise; one in a paragraph no run entered is code they never reach. See docs/spec/evidence.md §13.4 (execution coverage).
import { readFileSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';

export function executionFeedPaths(opts = {}) {
  if (opts.executionFeeds) return opts.executionFeeds;
  return (process.env.COBOLWORK_EXECUTION || '').split(delimiter).filter(Boolean);
}

// One report: per PROGRAM-ID, each paragraph's source line, name and how often a run entered it.
// Shape (ironwork's): { programs: [{ program, detail: [{ name, line, entered }] }] }.
export function loadExecutionFeed(path) {
  const feed = { file: basename(path), programs: new Map(), problem: null };
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { feed.problem = e.code ? `could not be read (${e.code})` : `is not JSON (${e.message})`; return feed; }
  if (!doc || !Array.isArray(doc.programs)) { feed.problem = 'holds no programs'; return feed; }
  for (const p of doc.programs) {
    const detail = Array.isArray(p?.detail) ? p.detail : null;
    if (typeof p?.program !== 'string' || !detail || !detail.every((d) => typeof d?.name === 'string' && Number.isInteger(d.line) && Number.isInteger(d.entered) && d.entered >= 0)) {
      feed.problem = `a program's paragraphs are not { name, line, entered }`;
      return feed;
    }
    feed.programs.set(p.program.toUpperCase(), detail.map((d) => ({ name: d.name, line: d.line, entered: d.entered })));
  }
  return feed;
}

const PROGRAM_ID = /^.{0,6}[ \d]?\s*PROGRAM-ID\.?\s+['"]?([A-Za-z0-9#$@-]+)/;

// The programs a source holds, by PROGRAM-ID and the line it starts on.
function programsOf(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const m = PROGRAM_ID.exec(line);
    if (m) out.push({ id: m[1].toUpperCase(), line: i + 1 });
  });
  return out;
}

// Each finding inside a paragraph of a covered program gets `executed: { paragraph, entered }`,
// entered summed over the feeds. A finding before the program's first paragraph, or in a program
// no feed covers, is left as it is.
export function applyExecution(findings, root, feeds) {
  const good = feeds.filter((f) => !f.problem);
  const byExecution = { entered: 0, 'never-entered': 0 };
  if (!good.length) return { byExecution: null };
  const sources = new Map();
  const programs = (path) => {
    if (!sources.has(path)) {
      let text = null;
      try { text = readFileSync(join(root, path), 'utf8'); } catch { /* not a file the scan can read again */ }
      sources.set(path, text === null ? [] : programsOf(text));
    }
    return sources.get(path);
  };
  for (const f of findings) {
    if (!f.path || !Number.isInteger(f.line)) continue;
    const owner = programs(f.path).filter((p) => p.line <= f.line && good.some((g) => g.programs.has(p.id))).at(-1);
    if (!owner) continue;
    let paragraph = null;
    let entered = 0;
    for (const g of good) {
      const detail = g.programs.get(owner.id);
      const at = detail?.filter((d) => d.line >= owner.line && d.line <= f.line).at(-1);
      if (!at) continue;
      paragraph = at.name;
      entered += at.entered;
    }
    if (paragraph === null) continue;
    f.executed = { paragraph, entered };
    byExecution[entered > 0 ? 'entered' : 'never-entered']++;
  }
  return { byExecution };
}
