// SPDX-License-Identifier: AGPL-3.0-or-later
export const ACTIONS = Object.freeze([
  'help', 'end', 'quit', 'up', 'down', 'pageUp', 'pageDown', 'top', 'bottom', 'open', 'command',
]);

const COMMON = {
  F1: 'help', 'C-c': 'quit', Up: 'up', Down: 'down', PageUp: 'pageUp', PageDown: 'pageDown',
  Home: 'top', End: 'bottom', Enter: 'open',
};

const ISPF = { ...COMMON, F3: 'end', F12: 'end', F7: 'pageUp', F8: 'pageDown', Tab: 'command' };

const MODERN = {
  ...COMMON, F3: 'end', Escape: 'end', 'char:q': 'end', 'char:?': 'help', 'char:j': 'down', 'char:k': 'up',
  'char: ': 'pageDown', 'char:b': 'pageUp', 'char:g': 'top', 'char:G': 'bottom', 'char::': 'command', 'char:/': 'command',
};

export const KEYMAPS = Object.freeze({ ispf: Object.freeze(ISPF), modern: Object.freeze(MODERN) });

export const actionFor = (keymap, token) => (KEYMAPS[keymap] || KEYMAPS.ispf)[token] || null;

export const LEGEND = Object.freeze({
  ispf: ' F1=Help F3=End F7=Up F8=Down F12=Cancel  Enter=Open  Type a command, then Enter',
  modern: ' F1=Help ?=Help q/Esc=Back j/k=Move Space/b=Page Enter=Open :=Command /=Find',
});

const NAMED = {
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', pageup: 'PageUp', pagedown: 'PageDown',
  home: 'Home', end: 'End', return: 'Enter', enter: 'Enter', escape: 'Escape', tab: 'Tab', backspace: 'Backspace',
};

// readline keypress → 'F1'..'F12', 'Up', 'Enter', ..., 'char:<c>', or 'C-c'.
export function keyToken(str, key = {}) {
  if (key.ctrl && key.name === 'c') return 'C-c';
  if (key.name && /^f([1-9]|1[0-2])$/.test(key.name)) return key.name.toUpperCase();
  if (key.name && NAMED[key.name] && !key.ctrl && !key.meta) return NAMED[key.name];
  if (typeof str === 'string' && str.length === 1 && str >= ' ' && str !== '\x7f') return `char:${str}`;
  return null;
}
