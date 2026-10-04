// SPDX-License-Identifier: AGPL-3.0-or-later
// The PL/I statement cursor: the shared token cursor, failing with PliSyntax.
import { tokenCursor, split } from '../statement-cursor.mjs';

export class PliSyntax extends Error {
  constructor(message, tok) {
    super(message);
    this.name = 'PliSyntax';
    this.line = tok ? tok.line : null;
    this.col = tok ? tok.col : null;
  }
}

export const cursor = (toks) => tokenCursor(toks, PliSyntax);
export { split };
