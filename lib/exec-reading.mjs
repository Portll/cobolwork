// SPDX-License-Identifier: AGPL-3.0-or-later
// One reading of an EXEC block for every rule set and the flow engine, and the one the precompiler's
// table names: each option's argument tokens, every word in order, and for EXEC CICS the command the
// table names it and the direction each option's data moves. Cached per block, so a worker that
// rebuilds a program's parse reads each block exactly as the main thread does.
import { cicsCommand } from './precompile-cics.mjs';
import { CICS_COMMANDS, CICS_EVERY_COMMAND } from './cics-commands.mjs';

const readings = new WeakMap();

// `opts` maps each option to the tokens inside its parentheses, the first time it is written; `words`
// is every word of the block. `verb` and `sub` are the command's first two words: the table's name
// where it has one (SEND MAP however its options are ordered), else the block's first two words.
export function execReading(exec) {
  let r = readings.get(exec);
  if (r) return r;
  const toks = exec.toks;
  const opts = new Map();
  const words = [];
  const top = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'sep') { depth += t.v === '(' ? 1 : t.v === ')' ? -1 : 0; continue; }
    if (t.t !== 'word') continue;
    words.push(t.u);
    if (depth === 0) top.push({ word: t.u });
    if (toks[i + 1] && toks[i + 1].t === 'sep' && toks[i + 1].v === '(') {
      const inner = [];
      let d = 1;
      for (let k = i + 2; k < toks.length && d > 0; k++) {
        if (toks[k].t === 'sep') { d += toks[k].v === '(' ? 1 : -1; if (d === 0) break; continue; }
        inner.push(toks[k]);
      }
      if (!opts.has(t.u)) opts.set(t.u, inner);
    }
  }
  const command = exec.kind === 'CICS' && top.length ? cicsCommand(top) : null;
  const named = command ? command.split(' ') : [];
  const entry = command ? CICS_COMMANDS[command] : null;
  r = {
    opts, words, command,
    verb: named[0] || words[0],
    sub: named.length > 1 ? named[1] : words[1],
    // The way an option's data moves, as the table records it: sends, receives, both, label or none;
    // null for an option or a command the table does not hold.
    direction: (option) => (entry ? entry.options[option] || CICS_EVERY_COMMAND[option] || entry.anyOption || null : null),
  };
  readings.set(exec, r);
  return r;
}
