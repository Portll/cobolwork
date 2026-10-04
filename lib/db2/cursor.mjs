// SPDX-License-Identifier: AGPL-3.0-or-later
// The Db2 statement cursor: the shared token cursor, failing with Db2Syntax.
import { tokenCursor, split } from '../statement-cursor.mjs';

export class Db2Syntax extends Error {
  constructor(message, tok) {
    super(message);
    this.name = 'Db2Syntax';
    this.line = tok ? tok.line : null;
    this.col = tok ? tok.col : null;
  }
}

export const cursor = (toks) => tokenCursor(toks, Db2Syntax);
export { split };
