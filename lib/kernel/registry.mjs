// SPDX-License-Identifier: AGPL-3.0-or-later
// Every rule set this tool has, in one list.
//
// Adding the opaque set cost nine edits across four files: an import, a spread into ALL_RULES, an
// entry in RULE_SETS, a branch in scanAll, a line in the tool-name map, two lines in the feed
// catalogue, the CLI usage string, and the key list test/cli.test.mjs enumerates by hand. Eight of
// those nine are this file's job, and none of them is a decision - they are the same fact written
// down nine times, which is eight chances to write it down wrong.
//
// One of those chances was taken. The flow set was renamed to `cobolwork-flow` while the map from
// tool name to report key still said `cobolwork`, so that set's file counts went out under the
// literal key `undefined` in every report for several commits. lib/scan.mjs grew an ESETNAME throw
// to make the next rename fail loudly instead. The throw stays - see `reportKey` below - but the
// map it guarded is gone, because a name derived from one place cannot disagree with itself.
import { scan as scanFlow, scanSteps as scanFlowSteps, RULES as FLOW_RULES } from '../sets/flow.mjs';
import { scanCics, scanCicsSteps, CICS_RULES } from '../sets/cics.mjs';
import { scanHidden, HIDDEN_RULES } from '../sets/hidden.mjs';
import { scanCopybooks, scanCopybooksSteps, COPYBOOK_RULES } from '../sets/copybook.mjs';
import { scanJcl, JCL_RULES } from '../sets/jcl.mjs';
import { scanBuild, BUILD_RULES } from '../sets/build.mjs';
import { scanRecon, RECON_RULES } from '../sets/recon.mjs';
import { scanVendor, VENDOR_RULES } from '../sets/vendor.mjs';
import { scanOpaque, OPAQUE_RULES } from '../sets/opaque.mjs';
import { scanWeb, scanWebSteps, WEB_RULES } from '../sets/web.mjs';
import { scanPriv, scanPrivSteps, PRIV_RULES } from '../sets/priv.mjs';
import { scanLog, scanLogSteps, LOG_RULES } from '../sets/log.mjs';
import { scanCompile, scanCompileSteps, COMPILE_RULES } from '../sets/compile.mjs';
import { scanSemantics, scanSemanticsSteps, SEMANTICS_RULES } from '../sets/semantics.mjs';
import { scanZowe, ZOWE_RULES } from '../sets/zowe.mjs';
import { scanAbend, ABEND_RULES } from '../sets/abend.mjs';
import { scanHlasm, HLASM_RULES } from '../sets/hlasm.mjs';
import { scanIms, IMS_RULES } from '../sets/ims.mjs';
import { scanDb2, DB2_RULES } from '../sets/ddl.mjs';
import { scanCrypto, CRYPTO_RULES } from '../sets/crypto.mjs';
import { scanSecrets, SECRETS_RULES } from '../sets/secrets.mjs';
import { toolName } from './ruleset.mjs';

// The order is the order a scan runs them and the order --only lists them. It is not significant
// to correctness; it is significant to a report being comparable with yesterday's. A set with
// `steps` reads programs through the scan's one shared pass (lib/kernel/shared-pass.mjs).
export const REGISTRY = [
  { name: 'flow', scan: scanFlow, steps: scanFlowSteps, rules: FLOW_RULES },
  { name: 'cics', scan: scanCics, steps: scanCicsSteps, rules: CICS_RULES },
  { name: 'hidden', scan: scanHidden, rules: HIDDEN_RULES },
  { name: 'copybook', scan: scanCopybooks, steps: scanCopybooksSteps, rules: COPYBOOK_RULES },
  { name: 'jcl', scan: scanJcl, rules: JCL_RULES },
  { name: 'build', scan: scanBuild, rules: BUILD_RULES },
  { name: 'recon', scan: scanRecon, rules: RECON_RULES },
  { name: 'vendor', scan: scanVendor, rules: VENDOR_RULES },
  { name: 'opaque', scan: scanOpaque, rules: OPAQUE_RULES },
  { name: 'web', scan: scanWeb, steps: scanWebSteps, rules: WEB_RULES },
  { name: 'compile', scan: scanCompile, steps: scanCompileSteps, rules: COMPILE_RULES },
  { name: 'priv', scan: scanPriv, steps: scanPrivSteps, rules: PRIV_RULES },
  { name: 'log', scan: scanLog, steps: scanLogSteps, rules: LOG_RULES },
  { name: 'semantics', scan: scanSemantics, steps: scanSemanticsSteps, rules: SEMANTICS_RULES },
  { name: 'zowe', scan: scanZowe, rules: ZOWE_RULES },
  { name: 'abend', scan: scanAbend, rules: ABEND_RULES },
  { name: 'hlasm', scan: scanHlasm, rules: HLASM_RULES },
  { name: 'ims', scan: scanIms, rules: IMS_RULES },
  { name: 'ddl', scan: scanDb2, rules: DB2_RULES },
  { name: 'crypto', scan: scanCrypto, rules: CRYPTO_RULES },
  { name: 'secrets', scan: scanSecrets, rules: SECRETS_RULES },
];

// Re-exported from the kernel's ruleset module, which is where it has to live: this file imports
// every rule set, and every rule set imports that one.
export { toolName };

export const RULE_SETS = REGISTRY.map((s) => s.name);

export const ALL_RULES = Object.assign({}, ...REGISTRY.map((s) => s.rules));

const BY_TOOL = new Map(REGISTRY.map((s) => [toolName(s.name), s.name]));

// What a part's counts are filed under. An unregistered set still fails loudly rather than filing
// under `undefined`, which is the property the ESETNAME throw was added for and the reason this
// function exists instead of a bare lookup.
export function reportKey(tool) {
  const name = BY_TOOL.get(tool);
  if (!name) throw Object.assign(new Error(`rule set ${tool} has no report key`), { code: 'ESETNAME', tool });
  return name;
}

// Rule ids must be unique across sets: ALL_RULES is one flat object, so a duplicate would silently
// take the last definition and a finding would carry another set's severity.
export function duplicateRuleIds() {
  const seen = new Map();
  const dupes = [];
  for (const s of REGISTRY) {
    for (const id of Object.keys(s.rules)) {
      if (seen.has(id)) dupes.push(`${id} is declared by both ${seen.get(id)} and ${s.name}`);
      else seen.set(id, s.name);
    }
  }
  return dupes;
}
