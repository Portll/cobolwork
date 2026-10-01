// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I EXEC SQL, EXEC CICS and EXEC DLI statements.
import { hostVariablesIn } from '../../embedded-sql.mjs';
import { CICS_COMMANDS, CICS_EVERY_COMMAND } from '../../cics-commands.mjs';
import { cicsCommand } from '../../precompile-cics.mjs';

function toSqlTok(t) {
  if (t.t === 'word') return { t: 'word', u: t.u };
  if (t.t === 'op' && t.v === ':') return { t: 'op', v: ':' };
  if (t.t === 'op' && t.v === '.') return { t: 'period', joined: true };
  if (t.t === 'lit') return { t: 'lit', v: t.v };
  if (t.t === 'num') return { t: 'word', u: t.v };
  return { t: 'word', u: t.v };
}

function parseSql(c) {
  const rest = c.drain();
  const sqlToks = rest.map(toSqlTok);
  const verb = sqlToks.find((t) => t.t === 'word')?.u;
  const hostVars = hostVariablesIn(sqlToks).map((h) => ({ host: h.host, written: h.written }));
  return { verb, hostVars };
}

// The options of an EXEC CICS command as words with their argument tokens, the command resolved by
// the same table the COBOL translator uses, and each option's direction from it.
function parseCics(c) {
  const options = [];
  while (!c.done()) {
    const w = c.expectWord();
    options.push({ name: w.u, args: c.isOp('(') ? c.group() : null });
  }
  const name = cicsCommand(options.map((o) => ({ word: o.name })));
  const table = name ? CICS_COMMANDS[name].options : {};
  for (const o of options.slice(1)) o.direction = table[o.name] || CICS_EVERY_COMMAND[o.name] || null;
  return { command: name ? name.split(' ') : options.slice(0, 1).map((o) => o.name), known: !!name, options: options.slice(1) };
}

export const parsers = {
  EXEC(c, stmt, ctx) {
    c.expectWord('EXEC');
    const procTok = c.peek();
    if (!procTok || procTok.t !== 'word') c.fail('a processor word after EXEC');
    const processor = procTok.u;
    c.next();
    const node = { kind: 'EXEC', processor, toks: [] };
    if (processor === 'SQL') {
      node.sql = parseSql(c);
    } else if (processor === 'CICS') {
      node.cics = parseCics(c);
    } else {
      node.toks = c.drain();
    }
    return node;
  },
};
