// SPDX-License-Identifier: AGPL-3.0-or-later
// Best practices a repository misses: not security findings, so this set is outside the scan
// registry and runs for `cobolwork advise` alone. Each rule carries `class` beside the rule-set
// contract's keys, and its `how` is the practice's remedy.
import { report } from '../kernel/ruleset.mjs';

export const PRACTICE_RULES = {};

export function scanPractice(root, opts = {}) {
  return report('practice', { rules: PRACTICE_RULES, findings: [], stats: { filesScanned: 0 }, run: null });
}
