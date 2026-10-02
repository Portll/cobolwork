// SPDX-License-Identifier: AGPL-3.0-or-later
// How much of an IMS DBD and PSB corpus the reader parses, by macro.
//
//   node diag/ims-measure.mjs <dir> [--synthetic repoA,repoB] [--samples out.json] [--per-kind 40]
import { measureStatements, cli } from './statement-measure.mjs';
import { readIms, parseImsStatement } from '../lib/ims/read.mjs';

const IMS_FILE = /\.(dbd|psb|asm|mac|mlc)$/i;

export const measure = (root, opts = {}) => measureStatements(root, { ...opts, accept: (p) => IMS_FILE.test(p), read: (t) => readIms(t).statements, parse: parseImsStatement });

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) cli(measure);
