// SPDX-License-Identifier: AGPL-3.0-or-later
// What an IMS macro parser needs to read operands: the refusal it throws, and sublists and integers.
import { splitOperands } from '../cards.mjs';

export class ImsSyntax extends Error {
  constructor(message) { super(message); this.name = 'ImsSyntax'; }
}

// (A,B) and A both as a list of trimmed entries; null when absent.
export const sublist = (v) => {
  if (v == null) return null;
  const inner = /^\(([\s\S]*)\)$/.exec(String(v).trim());
  return (inner ? splitOperands(inner[1]) : [String(v)]).map((x) => x.trim());
};

export const integer = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Number(String(v).trim()) : null);
