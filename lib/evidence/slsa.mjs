// SPDX-License-Identifier: AGPL-3.0-or-later
// The build provenance record as an in-toto statement with the SLSA Provenance v1 predicate
// (docs/spec/evidence.md §10). Unsigned: the platform that signs it earns any SLSA level.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { STATEMENT_TYPE } from './seal.mjs';

export const SLSA_PREDICATE = 'https://slsa.dev/provenance/v1';
export const BUILD_TYPE = 'https://github.com/Portll/cobolwork/blob/main/docs/spec/evidence.md#build-v1';
export const LOCAL_BUILDER = 'https://github.com/Portll/cobolwork/local';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// A path under `root` by its relative name, anything else by its base name.
function named(path, root) {
  const abs = resolve(path);
  const r = resolve(root);
  return abs.startsWith(r + sep) ? relative(r, abs).split(sep).join('/') : basename(abs);
}

export function slsaStatement({ provenance, docBytes, root, artifacts = [], runId = null, runTip = null, builderId = null, startedOn = null, finishedOn = null }) {
  const subject = [{ name: 'build.json', digest: { sha256: sha256(docBytes) } },
    ...artifacts.map((p) => ({ name: named(p, root), digest: { sha256: sha256(readFileSync(p)) } }))];

  const resolvedDependencies = (provenance.sources || []).map((s) => ({ uri: `file:${s.path}`, name: s.path, digest: { sha256: s.sha256 } }));
  if (provenance.compiler && provenance.compiler.sha256) {
    const c = provenance.compiler;
    const name = c.tool === 'ironwork' ? 'ironwork' : basename(c.path);
    resolvedDependencies.push({ uri: `file:${basename(c.path)}`, name, digest: { sha256: c.sha256 }, ...(c.version ? { annotations: { version: String(c.version) } } : {}) });
  }
  resolvedDependencies.sort(byName);

  const externalParameters = {
    revisions: provenance.revisions,
    policy: { sha256: provenance.policy.sha256, setBy: provenance.policy.setBy },
    ...(provenance.copylibs && provenance.copylibs.length ? { copylibs: provenance.copylibs.map((d) => basename(d)) } : {}),
    ...(provenance.compiler && provenance.compiler.argv ? { compilerArguments: provenance.compiler.argv } : {}),
  };
  const internalParameters = {
    tool: 'cobolwork', toolVersion: provenance.toolVersion, flowModel: provenance.flowModel,
    ...(provenance.toolRevision ? { toolRevision: provenance.toolRevision } : {}),
    verdict: provenance.verdict, relaxed: provenance.relaxed,
  };
  const metadata = {
    ...(runId ? { invocationId: runId } : {}),
    ...(startedOn ? { startedOn } : {}),
    ...(finishedOn ? { finishedOn } : {}),
  };
  return {
    _type: STATEMENT_TYPE,
    subject,
    predicateType: SLSA_PREDICATE,
    predicate: {
      buildDefinition: { buildType: BUILD_TYPE, externalParameters, internalParameters, resolvedDependencies },
      runDetails: {
        builder: { id: builderId || LOCAL_BUILDER },
        metadata,
        byproducts: runTip ? [{ name: `evidence:run:${runId}`, digest: { sha256: runTip } }] : [],
      },
    },
  };
}
