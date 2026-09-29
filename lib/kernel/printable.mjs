// SPDX-License-Identifier: AGPL-3.0-or-later
// Text bound for a report, terminal or log: control and bidirectional characters replaced, length capped.
export const printable = (s, max = 200) => {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '?');
  return t.length > max ? `${t.slice(0, max)}...` : t;
};
