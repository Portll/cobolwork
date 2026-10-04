// SPDX-License-Identifier: AGPL-3.0-or-later
// How much of a Db2 SQL corpus the reader parses, by statement kind.
//
//   node diag/db2-measure.mjs <dir> [--synthetic repoA,repoB] [--samples out.json] [--per-kind 40]
import { measureStatements, cli } from './statement-measure.mjs';
import { readDb2, parseDb2Statement } from '../lib/db2/read.mjs';

const DB2_FILE = /\.(sql|ddl|db2)$/i;

export const measure = (root, opts = {}) => measureStatements(root, { ...opts, accept: (p) => DB2_FILE.test(p), read: (t) => readDb2(t).statements, parse: parseDb2Statement });

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) cli(measure);
