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
import { IRONWORK_FORMATS, IRONWORK_MINIMUM, NOT_RUN_ABENDS, RUN_ENDINGS } from './ironwork-ids.mjs';

export const CAPABILITIES_SCHEMA_VERSION = 1;

// Each command, what it takes and what it writes.
export const COMMANDS = {
  scan: { args: ['<path>'], options: ['--format', '--out', '--repos', '--only', '--quiet', '--full-trace', '--all-routes', '--baseline', '--no-baseline', '--advisories', '--copylib', '--pds-export', '--evidence'], documents: ['cobolwork', 'sarif'] },
  flow: { args: ['<path>'], options: ['--out', '--repos', '--quiet', '--full-trace', '--all-routes', '--baseline', '--no-baseline', '--copylib', '--evidence'], documents: ['cobolwork-flow'] },
  inventory: { args: ['<path>'], options: ['--out', '--quiet', '--copylib', '--evidence'], documents: ['cobolwork-inventory'] },
  parse: { args: ['<file>'], options: ['--out'], documents: ['cobolwork-parse'] },
  sbom: { args: ['<path>'], options: ['--name', '--out', '--quiet', '--copylib', '--evidence'], documents: ['cyclonedx'] },
  diff: { args: ['<repo>'], options: ['--base', '--head', '--format', '--out', '--only', '--quiet', '--full-trace', '--copylib', '--pds-export', '--evidence'], documents: ['cobolwork-diff', 'sarif'] },
  baseline: { args: ['<path>'], options: ['--reason', '--who', '--expires', '--action', '--rule', '--out', '--repos', '--only', '--advisories', '--copylib', '--evidence'], documents: ['cobolwork-baseline'] },
  tui: { args: ['[path]'], options: ['--report', '--keys', '--baseline', '--no-baseline', '--advisories', '--copylib'], documents: [] },
  explain: { args: ['<path>', '<fingerprint>'], options: ['--report', '--out', '--baseline', '--no-baseline', '--advisories', '--copylib'], documents: ['cobolwork-explain'] },
  gate: { args: ['<repo>'], options: ['--base', '--head', '--target', '--cobc', '--exit-code', '--target-only', '--out', '--evidence'], documents: ['cobolwork-gate'] },
  build: { args: ['<repo>', '[-- <compiler> <arg>...]'], options: ['--base', '--head', '--policy', '--provenance', '--provenance-format', '--artifact', '--equivalence', '--allowed-signers', '--ironwork', '--advisories', '--copylib', '--no-baseline', '--format', '--out', '--evidence'], documents: ['cobolwork-build', 'cobolwork-build-provenance', 'sarif'] },
  evidence: { args: ['verify|seal|anchor|sign', '[statement]'], options: ['--evidence', '--ssh-key', '--signer', '--expect-key', '--allowed-signers', '--anchor-git', '--ref', '--anchor-pin', '--push', '--max-unsealed', '--tsq', '--tsr', '--tsa-ca', '--cosign-bundle', '--cosign-key', '--certificate-identity', '--certificate-oidc-issuer', '--trusted-root', '--insecure-ignore-tlog', '--out', '--quiet'], documents: ['cobolwork-evidence'] },
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
      'cobolwork-evidence': null,
      cyclonedx: '1.6',
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
      pdsExport: 'scan --pds-export: every member classified by content, whatever extension the download gave it; text, --binary and --record downloads; XMIT files and IEBCOPY unloads of a PDS or a sequential data set',
      zowe: ['zowe.config.json', 'zowe.config.user.json', '.mcp.json', '.vscode/mcp.json', '.cursor/mcp.json', '.claude/settings.json', '.claude/settings.local.json', '.gemini/settings.json', 'claude_desktop_config.json', '.vscode/settings.json', 'systems.json under a mock directory'],
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
    // The ironwork releases cobolwork reads: from `minimum` on, each format from the release it names.
    ironwork: { minimum: IRONWORK_MINIMUM, formats: IRONWORK_FORMATS, runEndings: RUN_ENDINGS, notRunAbends: NOT_RUN_ABENDS },
  };
}
