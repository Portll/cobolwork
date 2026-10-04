// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';

// Bumped when a field a consumer reads changes meaning or shape, so a reader can refuse a report it
// was not written for rather than misread it. 2: filesScanned is the widest rule set, not programs.
// 3: findings carry `evidence`, and setsIncomplete entries a `kind`.
export const SCHEMA_VERSION = 3;

// The smaller documents each command writes, versioned apart from the report.
export const EXPLAIN_SCHEMA_VERSION = 1;
export const PARSE_SCHEMA_VERSION = 1;
export const BASELINE_RESULT_SCHEMA_VERSION = 1;
export const EVIDENCE_RESULT_SCHEMA_VERSION = 1;

// Names how taint moves through groups, so a finding that appears or disappears between two reports
// can be attributed to the model rather than to the code scanned. 'byte-range': a tainted field
// taints those bytes of its group, and the bytes are followed through MOVE, REDEFINES and CALL.
export const FLOW_MODEL = 'byte-range';

// The package version, read once: a row says which cobolwork produced it.
export const TOOL_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
