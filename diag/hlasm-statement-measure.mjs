// SPDX-License-Identifier: AGPL-3.0-or-later
// How much of an HLASM corpus the statement reader parses, by kind. Open code, macro definitions
// (MODEL, PROTOTYPE) and conditional assembly are separate kinds.
//
//   node diag/hlasm-statement-measure.mjs <dir> [--samples out.json] [--per-kind 40]
import { measureStatements, cli } from './statement-measure.mjs';
import { readHlasm } from '../lib/hlasm.mjs';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import { HLASM_EXT } from '../lib/sources.mjs';

const accept = (p) => HLASM_EXT.some((e) => p.toLowerCase().endsWith(e));
const read = (text) => (readHlasm(text).kind === 'hlasm' ? readHlasmStatements(text).statements : []);

export const measure = (root, opts = {}) => measureStatements(root, { ...opts, accept, read, parse: parseHlasmStatement });

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) cli(measure);
