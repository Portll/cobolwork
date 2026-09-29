// SPDX-License-Identifier: AGPL-3.0-or-later
import { printable } from '../kernel/printable.mjs';

export function createScreen(cols, rows) {
  return {
    cols, rows,
    chars: Array.from({ length: rows }, () => Array(cols).fill(' ')),
    styles: Array.from({ length: rows }, () => Array(cols).fill('')),
  };
}

export function put(screen, row, col, text, style = '') {
  if (row < 0 || row >= screen.rows) return;
  const s = printable(text, Infinity);
  for (let i = 0; i < s.length; i++) {
    const c = col + i;
    if (c < 0) continue;
    if (c >= screen.cols) break;
    screen.chars[row][c] = s[i];
    screen.styles[row][c] = style;
  }
}

export function styleRow(screen, row, style) {
  if (row < 0 || row >= screen.rows) return;
  screen.styles[row].fill(style);
}

export const screenText = (screen) => screen.chars.map((r) => r.join('').replace(/\s+$/, '')).join('\n');

const SGR = {
  color: { '': '', title: '\x1b[1m', warn: '\x1b[33m', dim: '\x1b[2m', sel: '\x1b[7m', hi: '\x1b[36m', crit: '\x1b[31;1m', high: '\x1b[31m' },
  plain: { '': '', title: '\x1b[1m', warn: '\x1b[1m', dim: '', sel: '\x1b[7m', hi: '', crit: '\x1b[1m', high: '' },
};

function rowAnsi(screen, r, table) {
  let out = '';
  let current = null;
  for (let c = 0; c < screen.cols; c++) {
    const st = screen.styles[r][c];
    if (st !== current) { out += '\x1b[0m' + (table[st] || ''); current = st; }
    out += screen.chars[r][c];
  }
  return out + '\x1b[0m';
}

const rowKey = (screen, r) => screen.chars[r].join('') + '\u0000' + screen.styles[r].join(',');

// Escape sequences that turn `prev` (or a blank terminal) into `next`, changed rows only.
export function redraw(prev, next, { color = true } = {}) {
  const table = color ? SGR.color : SGR.plain;
  const whole = !prev || prev.cols !== next.cols || prev.rows !== next.rows;
  let out = whole ? '\x1b[2J' : '';
  for (let r = 0; r < next.rows; r++) {
    if (!whole && rowKey(prev, r) === rowKey(next, r)) continue;
    out += `\x1b[${r + 1};1H` + rowAnsi(next, r, table);
  }
  return out;
}
