// SPDX-License-Identifier: AGPL-3.0-or-later
// What a finding would let someone do, in the two classes a build refuses whatever the severity -
// gaining authority the input's author did not have, and changing data - and the tier a report
// ranks it in: docs/spec/build-gate.md §5a. Every defect rule is classified here or named as
// having neither consequence, and a test holds the registry to that, so a new rule cannot reach a
// build unclassified.
import { ALL_RULES } from './kernel/registry.mjs';
import { SOURCE_KINDS, SINK_KINDS } from './dataflow.mjs';

export const CLASSES = ['privilege-escalation', 'data-mutation'];
export const TIERS = ['info', 'low', 'med', 'high', 'crit', 'known-exploitable'];
export const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t, i]));

const ESCALATES = 'privilege-escalation';
const MUTATES = 'data-mutation';

// Input that chooses a command, a program, a statement, a file or a job runs with the program's
// authority rather than its author's. Input that chooses which record is changed, or where in
// storage a write lands, changes data.
const SINK_CLASSES = {
  'os-command': [ESCALATES, MUTATES],
  'dynamic-sql': [ESCALATES, MUTATES],
  'internal-reader': [ESCALATES, MUTATES],
  'dynamic-program-load': [ESCALATES],
  'cics-dynamic-transfer': [ESCALATES],
  'dynamic-file-path': [ESCALATES],
  'record-update': [MUTATES],
  'queue-name': [MUTATES],
  'subscript': [MUTATES],
  'reference-modification': [MUTATES],
  'occurs-depending-count': [MUTATES],
  'loop-bound': [MUTATES],
  'outbound-http': [],
  'socket-send': [],
  'message-queue': [],
  'extrapartition-queue': [],
  'web-response': [],
  'http-header': [],
  'outbound-host': [],
  'arithmetic': [],
  'record-key': [],
  'log': [],
  'storage-length': [],
  'xml-document': [],
  'connection-target': [],
  'screen': [],
  'cics-sysid': [],
  // A system-programming command acts with the region's authority on whatever resource it names.
  'cics-system-resource': [ESCALATES],
};

// Past a table or a reference with SSRANGE abending, a bad index stops the program instead of
// writing into the storage after it.
const BOUNDED_BY_SSRANGE = new Set(['subscript', 'reference-modification', 'occurs-depending-count', 'loop-bound']);

const RULE_CLASSES = {
  // A variable names the program, and nothing says input reaches it: over the 500-repository corpus
  // every one read held a literal. Input that does reach it is *-to-cics-dynamic-transfer.
  'cics-transfer-to-variable-program': [],
  // A failure carried on from: what follows depends on the program, and severity decides.
  'cics-condition-ignored': [],
  // Disclosure of stored secrets and a weaker check; severity decides.
  'program-checks-stored-password': [],
  'password-case-folded-before-compare': [],
  'cics-signon-bypassed': [ESCALATES],
  'csd-defines-diagnostic-transaction': [ESCALATES],
  'csd-transaction-without-command-security': [ESCALATES],
  'job-loads-from-an-authorised-library': [ESCALATES],
  'vendor-privileged-command': [ESCALATES],
  'jcl-instream-security-command': [ESCALATES],
  'jcl-instream-credential': [ESCALATES],
  'credential-in-source': [ESCALATES],
  'web-uri-carries-a-credential': [ESCALATES],
  'log-writes-a-credential': [ESCALATES],
  'zowe-config-secret-in-clear': [ESCALATES],
  'zowe-mcp-password-in-config': [ESCALATES],
  'zowe-mock-credentials': [ESCALATES],
  // An agent at the full tier submits jobs and runs commands as the user it logs on as.
  'zowe-mcp-tier-full': [ESCALATES],
  'zowe-mcp-tier-writes': [MUTATES],
  // A crafted source file compiled by an affected cobc runs in the build, with the build's authority.
  'build-pins-vulnerable-compiler': [ESCALATES],
  'build-pins-exploited-compiler': [ESCALATES],
  'call-parameter-exceeds-caller-record': [MUTATES],
  'call-parameter-exceeds-argument': [MUTATES],
  'cics-commarea-without-length-check': [MUTATES],
  'cics-commarea-length-exceeds-area': [MUTATES],
  'cics-commarea-length-exceeds-callee': [MUTATES],
  'jcl-instream-destructive': [MUTATES],
  'recon-nonproduction-job-writes-production-dataset': [MUTATES],
  'web-request-changes-state-without-a-token': [MUTATES],
  // Disclosure, exposure, denial of service, or a consequence that depends on which advisory it is;
  // severity and the known-exploited tier decide these.
  'cics-signon-says-which-half-failed': [],
  'jcl-ftp-cleartext': [],
  'jcl-ftp-sends-production-dataset': [],
  'build-pins-vulnerable-component': [],
  'build-pins-exploited-component': [],
  'site-declares-vulnerable-runtime': [],
  'recon-production-name-outside-production': [],
  'recon-routable-address-committed': [],
  'recon-nonproduction-job-reads-production-dataset': [],
  'web-cookie-without-secure-attributes': [],
  'web-response-without-protective-headers': [],
  'web-response-tells-the-caller-what-it-runs': [],
  'web-link-opens-without-noopener': [],
  'cics-listener-accepts-cleartext': [],
  'compile-undefined-name': [],
  // A value the generated code gets wrong with no input driving it; severity decides.
  'binary-store-exceeds-picture-under-trunc-opt': [],
  'intermediate-result-loses-high-order-digits': [],
  'character-range-reverses-in-ascii': [],
  'log-writes-personal-data': [],
  'display-echoes-a-credential': [],
  'control-cards-from-dataset': [],
  'sort-exit-named': [],
  'tso-batch-runs-program': [],
  'zowe-config-tls-verify-off': [],
  'zowe-config-cleartext': [],
  'zowe-mcp-data-marking-off': [],
  'zowe-mcp-unpinned': [],
  // An abend stops the run; an overrun or a protection exception is a write that landed, or would
  // have landed, where the input chose.
  'input-causes-abend-s0c7': [],
  'input-causes-abend': [],
  'input-causes-hang': [],
  'input-selects-program': [ESCALATES],
  'input-causes-abend-s0c4': [MUTATES],
  'input-causes-abend-subscript-range': [MUTATES],
  // Key zero or supervisor state is the operating system's authority, taken by the code itself.
  'hlasm-supervisor-state-change': [ESCALATES],
  // Nothing says input reaches EX's register, or which address space a cross-memory call reaches:
  // the linkage tables grant that, and the source does not show them. Severity decides.
  'hlasm-executes-built-instruction': [],
  'hlasm-cross-memory-service': [],
  'hlasm-runtime-module-name': [ESCALATES],
  // Disclosure in transit; severity decides.
  'web-client-opens-cleartext': [],
  'web-receive-length-exceeds-area': [MUTATES],
  // Weak cryptography discloses or lets data be changed undetected; severity decides.
  'icsf-single-length-des-key': [],
  'icsf-weak-hash': [],
  'icsf-fixed-initialization-vector': [],
  // A definition the generation step or the scheduler refuses stops the program; severity decides.
  'ims-senseg-unknown-segment': [],
  'ims-definition-inconsistent': [],
  // A grant decides who holds a privilege, not that anyone uses it; the PUBLIC grant of a write or an
  // authority is crit, and severity decides the rest.
  'db2-grant-to-public': [],
  'db2-grant-with-grant-option': [],
  'db2-system-authority-granted': [],
};

// Coverage and context assert no defect, so they carry no consequence.
const NOT_DEFECTS = new Set(['coverage', 'context']);
// Two copybooks sharing a name in one repository are separate projects or starter and solution
// copies far more often than a planted layout; copybook-shadows-system is the planted case.
const TAMPERING_WITHOUT_CONSEQUENCE = new Set(['copybook-shadowed']);

// The source and sink a path rule's id spells, or null.
export function kindsOf(rule) {
  for (const source of Object.keys(SOURCE_KINDS)) {
    if (!rule.startsWith(`${source}-to-`)) continue;
    const sink = rule.slice(source.length + 4);
    if (Object.hasOwn(SINK_KINDS, sink)) return { source, sink };
  }
  return null;
}

// Whether the tables above decide `rule`: undefined for a rule nobody classified.
export function classesOfRule(rule) {
  const meta = ALL_RULES[rule];
  if (!meta || NOT_DEFECTS.has(meta.evidence)) return [];
  // Text arranged so the compiled program is not the one a reviewer read gives its author control
  // of what runs with the program's authority.
  if (meta.evidence === 'tampering') return TAMPERING_WITHOUT_CONSEQUENCE.has(rule) ? [] : [ESCALATES];
  if (meta.evidence === 'path') {
    const kinds = kindsOf(rule);
    return kinds ? SINK_CLASSES[kinds.sink] : undefined;
  }
  return RULE_CLASSES[rule];
}

export function classesOf(finding) {
  // A finding its own rule rates info asserts no defect: a clear-down before a rebuild, say.
  if (finding.sev === 'info') return [];
  // A vendored copy laid out exactly as the system's changes nothing a program compiles against.
  if (finding.rule === 'copybook-shadows-system' && finding.layoutMatchesSystem) return [];
  let classes = classesOfRule(finding.rule) || [];
  // Input a program's own user gives it acts with that user's authority, unless the estate says the
  // entry that starts the program runs with more.
  if (ALL_RULES[finding.rule]?.whenPrivileged && finding.effect !== 'privileged') classes = classes.filter((c) => c !== ESCALATES);
  if (!finding.ssrange) return classes;
  const kinds = kindsOf(finding.rule);
  return kinds && BOUNDED_BY_SSRANGE.has(kinds.sink) ? classes.filter((c) => c !== MUTATES) : classes;
}

// A published vulnerability CISA lists as exploited outranks any severity the tool assigns.
export const tierOf = (finding) => (finding.knownExploited && finding.knownExploited.length ? 'known-exploitable' : finding.sev);
