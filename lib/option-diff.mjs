// SPDX-License-Identifier: AGPL-3.0-or-later
// Which compiler options a change to a program's CBL and PROCESS cards changes, for the families
// that change arithmetic, validation or collation without touching a statement
// (docs/spec/evidence.md §13.4). Spellings come from IBM's option table (lib/enterprise-options.mjs).
import { OPTION_SPELLINGS } from './enterprise-options.mjs';
import { optionCards, optionTokens } from './options.mjs';

export const WATCHED = ['TRUNC', 'ARITH', 'NUMPROC', 'NUMCHECK', 'SSRANGE', 'CODEPAGE', 'INTDATE'];
const ARITH_SUBS = { C: 'COMPAT', COMPAT: 'COMPAT', E: 'EXTEND', EXTEND: 'EXTEND' };

// One option token as `FAMILY(SUB,...)` or `NOFAMILY`, or null for a family not watched.
function settingOf(token) {
  const m = /^([A-Z0-9-]+)(?:\((.*)\))?$/.exec(token);
  if (!m) return null;
  const spelled = OPTION_SPELLINGS[m[1]];
  if (!spelled || !WATCHED.includes(spelled[0])) return null;
  const [family, off] = spelled;
  if (off) return { family, value: `NO${family}` };
  let subs = m[2] === undefined ? [] : optionTokens(m[2]);
  if (family === 'ARITH') subs = subs.map((s) => ARITH_SUBS[s] || s);
  if (family === 'NUMCHECK' || family === 'SSRANGE') subs = [...subs].sort();
  return { family, value: subs.length ? `${family}(${subs.join(',')})` : family };
}

// The watched options a program's cards set, the later card winning, each with its line.
export function optionsInForce(text) {
  const state = new Map();
  for (const card of optionCards(text)) {
    for (const token of card.options) {
      const s = settingOf(token);
      if (s) state.set(s.family, { value: s.value, line: card.line });
    }
  }
  return state;
}

export function optionChanges(baseText, headText) {
  const before = optionsInForce(baseText);
  const after = optionsInForce(headText);
  const out = [];
  for (const family of WATCHED) {
    const b = before.get(family);
    const a = after.get(family);
    const base = b ? b.value : 'default';
    const head = a ? a.value : 'default';
    if (base !== head) out.push({ option: family, base, head, line: (a || b).line });
  }
  return out;
}
