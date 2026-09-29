// SPDX-License-Identifier: AGPL-3.0-or-later
import { emitKeypressEvents } from 'node:readline';
import { keyToken } from './keys.mjs';

const ALT_ON = '\x1b[?1049h';
const ALT_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const RESET = '\x1b[0m';

export function nodeTerminal({ input = process.stdin, output = process.stdout } = {}) {
  let started = false;
  const keyHandlers = [];
  const resizeHandlers = [];
  const size = () => ({ cols: output.columns || 80, rows: output.rows || 24 });
  const onKeypress = (str, key) => {
    const token = keyToken(str, key || {});
    if (token) for (const h of keyHandlers) h(token);
  };
  const onResize = () => { for (const h of resizeHandlers) h(size()); };
  return {
    size,
    start() {
      if (started) return;
      started = true;
      emitKeypressEvents(input);
      if (input.isTTY && input.setRawMode) input.setRawMode(true);
      input.on('keypress', onKeypress);
      if (output.on) output.on('resize', onResize);
      input.resume();
      output.write(ALT_ON + CURSOR_HIDE);
    },
    stop() {
      if (!started) return;
      started = false;
      input.off('keypress', onKeypress);
      if (output.off) output.off('resize', onResize);
      if (input.isTTY && input.setRawMode) input.setRawMode(false);
      input.pause();
      output.write(RESET + CURSOR_SHOW + ALT_OFF);
    },
    write: (text) => { if (text) output.write(text); },
    onKey: (h) => { keyHandlers.push(h); },
    onResize: (h) => { resizeHandlers.push(h); },
  };
}
