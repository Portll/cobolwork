// SPDX-License-Identifier: AGPL-3.0-or-later
// What this cobolwork can do, as one document a caller reads instead of probing: `cobolwork
// capabilities --json`. The commands and options here are held to bin/cobolwork.mjs by a test, and
// every version is read from where the document that carries it is built.
import { RULE_SETS, ALL_RULES } from './kernel/registry.mjs';
import { EVIDENCE } from './kernel/findings.mjs';
import { FINGERPRINT_VERSION } from './kernel/identity.mjs';
import { PROGRAM_EXT, COPY_EXT, JCL_EXT, BMS_EXT } from './sources.mjs';
import { FLOW_MODEL, SCHEMA_VERSION, TOOL_VERSION } from './version.mjs';
import { BUILD_SCHEMA_VERSION, BUILD_EXIT } from './build.mjs';
import { VERDICT_EXIT } from './gate.mjs';
import { CHECKS, COMPILERS, DEFAULT_POLICY } from './policy.mjs';
import { CLASSES, TIERS } from './consequence.mjs';
import { toolRevision } from './revision.mjs';

export const CAPABILITIES_SCHEMA_VERSION = 1;

// Each command, what it takes and what it writes.
export const COMMANDS = {
  scan: { args: ['<path>'], options: ['--format', '--out', '--repos', '--only', '--quiet', '--full-trace', '--baseline', '--no-baseline', '--advisories', '--copylib'], documents: ['cobolwork', 'sarif'] },
  flow: { args: ['<path>'], options: ['--out', '--repos', '--quiet', '--full-trace', '--baseline', '--no-baseline', '--copylib'], documents: ['cobolwork-flow'] },
  inventory: { args: ['<path>'], options: ['--out', '--quiet', '--copylib'], documents: ['cobolwork-inventory'] },
  parse: { args: ['<file>'], options: ['--out'], documents: ['cobolwork-parse'] },
  diff: { args: ['<repo>'], options: ['--base', '--head', '--format', '--out', '--only', '--quiet', '--full-trace', '--copylib'], documents: ['cobolwork-diff', 'sarif'] },
  baseline: { args: ['<path>'], options: ['--reason', '--who', '--expires', '--action', '--rule', '--out', '--repos', '--only', '--advisories', '--copylib'], documents: ['cobolwork-baseline'] },
  tui: { args: ['[path]'], options: ['--report', '--keys', '--baseline', '--no-baseline', '--advisories', '--copylib'], documents: [] },
  explain: { args: ['<path>', '<fingerprint>'], options: ['--report', '--out', '--baseline', '--no-baseline', '--advisories', '--copylib'], documents: ['cobolwork-explain'] },
  gate: { args: ['<repo>'], options: ['--base', '--head', '--target', '--cobc', '--exit-code', '--target-only', '--out'], documents: ['cobolwork-gate'] },
  build: { args: ['<repo>', '[-- <compiler> <arg>...]'], options: ['--base', '--head', '--policy', '--provenance', '--ironwork', '--advisories', '--copylib', '--no-baseline', '--format', '--out'], documents: ['cobolwork-build', 'cobolwork-build-provenance', 'sarif'] },
  capabilities: { args: [], options: ['--json'], documents: ['cobolwork-capabilities'] },
};

// Options every command takes, or that end the run before a command is chosen.
export const GLOBAL_OPTIONS = ['--help', '--version', '--rules-path'];

export function capabilities() {
  return {
    tool: 'cobolwork-capabilities',
    schemaVersion: CAPABILITIES_SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    toolRevision: toolRevision(),
    commands: COMMANDS,
    globalOptions: GLOBAL_OPTIONS,
    // A document whose schemaVersion is null carries none yet; a reader should key on `tool`.
    documents: {
      cobolwork: SCHEMA_VERSION,
      'cobolwork-flow': SCHEMA_VERSION,
      'cobolwork-inventory': SCHEMA_VERSION,
      'cobolwork-diff': SCHEMA_VERSION,
      'cobolwork-gate': SCHEMA_VERSION,
      'cobolwork-build': BUILD_SCHEMA_VERSION,
      'cobolwork-build-provenance': BUILD_SCHEMA_VERSION,
      'cobolwork-capabilities': CAPABILITIES_SCHEMA_VERSION,
      'cobolwork-explain': null,
      'cobolwork-baseline': null,
      'cobolwork-parse': null,
      sarif: '2.1.0',
    },
    identity: { version: FINGERPRINT_VERSION },
    analysis: { flowModel: FLOW_MODEL, ruleSets: RULE_SETS, rules: Object.keys(ALL_RULES).length },
    sourceKinds: {
      program: PROGRAM_EXT,
      copybook: COPY_EXT,
      jcl: JCL_EXT,
      bms: BMS_EXT,
      extensionless: 'sniffed by content: a file with no extension is classified by what it holds',
    },
    evidenceKinds: Object.keys(EVIDENCE),
    build: {
      tiers: TIERS,
      classes: CLASSES,
      checks: CHECKS,
      compilers: COMPILERS,
      defaultPolicy: DEFAULT_POLICY,
      exit: { ...BUILD_EXIT, couldNotRun: 2 },
    },
    gate: { exit: { ...VERDICT_EXIT, couldNotRun: 2 } },
  };
}
