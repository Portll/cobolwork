# Stability

What a cobolwork release keeps from the release before it.

From 0.9.0, the contracts below change only in a major release. Until then a minor release may
change any of them, and its release notes say so.

## The contracts

- **Rule ids.** Each rule a rule set declares, as `cobolwork capabilities` and the SARIF tool
  components list them.
- **The command line.** Each command with its arguments and options, as `cobolwork capabilities`
  lists them under `commands` and `globalOptions`.
- **Exit statuses**, below.
- **Documents and their schemas**, below.
- **The fingerprint, `cobolwork/v1`.** What goes into a finding's fingerprint and pairing keys.
  `test/identity-golden.test.mjs` pins the hashes, so a change to the inputs fails it.

The JavaScript exports of `lib/` are not covered.

## Exit statuses

| Command | Status |
|---|---|
| Every command | 0 done; 2 a usage error, or the command could not run |
| `build` | 0 pass, 1 fail, 3 undecided, 4 the compiler failed after a pass, 2 could not run |
| `gate --exit-code` | 0 pass, 1 fail, 3 undecided, 2 could not run |
| `evidence verify` | 0 verified and sealed, 1 broken or not sealed, 3 undetermined, 2 a usage error |

## Documents

Each JSON document cobolwork writes names itself in `tool` and gives its version in
`schemaVersion`. `cobolwork capabilities` lists both under `documents`.

| Document | Version | Schema |
|---|---|---|
| `cobolwork` (`scan`), `cobolwork-flow`, `cobolwork-inventory`, `cobolwork-diff`, `cobolwork-gate` | 3 | |
| `cobolwork-build`, `cobolwork-build-provenance` | 1 | |
| `cobolwork-capabilities` | 1 | `schema/cobolwork-capabilities.schema.json` |
| `cobolwork-explain` | 1 | `schema/cobolwork-explain.schema.json` |
| `cobolwork-parse` | 1 | `schema/cobolwork-parse.schema.json` |
| `cobolwork-baseline` | 1 | `schema/cobolwork-baseline.schema.json` |
| `cobolwork-evidence` | 1 | `schema/cobolwork-evidence.schema.json` |
| SARIF | 2.1.0 | The coverage property bag: `schema/cobolwork-coverage.schema.json` |
| CycloneDX SBOM | 1.6 | |
| Evidence records | `cobolwork-evidence/v1` | `docs/spec/evidence.md`; record kinds in `test/fixtures/evidence/kinds.tsv` |

The files cobolwork reads:

| File | Version key | Schema |
|---|---|---|
| `cobolwork.site.json` | `version`: 1 | `schema/cobolwork.site.schema.json` |
| Build policy | `policyVersion`: 1 | `schema/cobolwork.policy.schema.json` |
| `cobolwork.baseline.json` | `version`: 1 | `schema/cobolwork.baseline.schema.json` |
| Witness feed (`COBOLWORK_WITNESS`) | `version`: 1 | `schema/cobolwork-witness.schema.json` |
| Reachability extract (`COBOLWORK_REACH`) | `version`: 1 | `schema/cobolwork-reach.schema.json` |
| Execution coverage (`COBOLWORK_EXECUTION`) | ironwork's | `schema/cobolwork-execution.schema.json`, the keys read |

A file of cobolwork's own without its version key is read as version 0, which holds the same keys
as version 1. A newer version than the release reads is refused, and the message names both
versions. A key the site file does not hold is named under `summary.siteWarnings`, and one a witness
feed or reachability extract does not hold under `summary.feedWarnings`.

## How a contract changes

- **Additions** come in a minor release: a rule, a command, an option, or a key in a document
  cobolwork writes. A program that reads cobolwork's documents should ignore keys it does not know.
- **A rename** keeps the old name working as an alias for one major release, and using it warns.
- **A deprecation** warns for at least one minor release before the major release that removes it.
