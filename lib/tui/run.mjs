// SPDX-License-Identifier: AGPL-3.0-or-later
import * as core from './app.mjs';
import { redraw } from './screen.mjs';

export function runTui({ report, terminal, keymap = 'ispf', color = true, app = core }) {
  return new Promise((resolve, reject) => {
    let state = app.initialState({ report, keymap, ...terminal.size() });
    let shown = null;
    let finished = false;
    const finish = (err) => {
      if (finished) return;
      finished = true;
      terminal.stop();
      if (err) reject(err); else resolve(state);
    };
    const paint = () => {
      const next = app.view(state);
      terminal.write(redraw(shown, next, { color }));
      shown = next;
    };
    const handle = (event) => {
      if (finished) return;
      try {
        const r = app.update(state, event);
        state = r.state;
        if (r.effects.some((e) => e.type === 'quit')) return finish();
        if (event.type === 'resize') shown = null;
        paint();
      } catch (e) {
        finish(e);
      }
    };
    terminal.onKey((token) => handle({ type: 'key', token }));
    terminal.onResize(({ cols, rows }) => handle({ type: 'resize', cols, rows }));
    terminal.start();
    try { paint(); } catch (e) { finish(e); }
  });
}
