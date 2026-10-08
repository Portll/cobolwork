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
- **The library**, from the first release after 0.9.0: the names `@portll/cobolwork` exports,
  below.

## Exit statuses

| Command | Status |
|---|---|
| Every command | 0 done; 2 a usage error, or the command could not run |
| `build` | 0 pass, 1 fail, 3 undecided, 4 the compiler failed after a pass, 2 could not run |
| `gate --exit-code` | 0 pass, 1 fail, 3 undecided, 2 could not run |
| `evidence verify` | 0 verified and sealed, 1 broken or not sealed, 3 undetermined, 2 a usage error |

## Documents

Each JSON document cobolwork writes names itself in `tool` and gives its version in
`schemaVersion`. `cobolwork capabilities` lists both under `documents`. Each schema describes every
key its document carries at the top level, the scan, flow and diff schemas every key in `summary` and
in each finding too, and a test holds the documents cobolwork writes to them.

| Document | Version | Schema |
|---|---|---|
| `cobolwork` (`scan`) | 3 | `schema/cobolwork-report.schema.json`, each finding `schema/cobolwork-finding.schema.json` |
| `cobolwork-flow` | 3 | `schema/cobolwork-flow.schema.json` |
| `cobolwork-inventory` | 3 | `schema/cobolwork-inventory.schema.json` |
| `cobolwork-diff` | 3 | `schema/cobolwork-diff.schema.json` |
| `cobolwork-gate` | 3 | `schema/cobolwork-gate.schema.json` |
| `cobolwork-build` | 1 | `schema/cobolwork-build.schema.json` |
| `cobolwork-build-provenance` | 1 | `schema/cobolwork-build-provenance.schema.json` |
| `cobolwork-capabilities` | 1 | `schema/cobolwork-capabilities.schema.json` |
| `cobolwork-explain` | 1 | `schema/cobolwork-explain.schema.json` |
| `cobolwork-parse` | 1 | `schema/cobolwork-parse.schema.json` |
| `cobolwork-baseline` | 1 | `schema/cobolwork-baseline.schema.json` |
| `cobolwork-evidence` | 1 | `schema/cobolwork-evidence.schema.json` |
| `cobolwork-advice` | 1 | `schema/cobolwork-advice.schema.json` |
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

## The library

`package.json` exports one entry point, `lib/index.mjs`, and Node refuses an import of any other
file in the package. Each name below keeps its name and kind until a major release.
`test/library-exports.test.mjs` lists them and fails when an export is added, removed, renamed or
changes kind, until its list and this table agree.

| Name | Kind | What it is for |
|---|---|---|
| `scan` | function | `scan(root, options)` runs the flow rule set over a directory and returns its `cobolwork-flow` report: what `cobolwork flow` writes before it adds fingerprints and estate facts and applies the baseline. |
| `RULES` | object | The flow rule set's rules by rule id, each with its severity, CWE and description. |
| `analyze` | function | `analyze(root, options)` is the cross-program data flow under `scan`: each route from a source to a sink with its hops and checks, and counts of what the analysis read. |
| `inventory` | function | `inventory(root, options)` returns the `cobolwork-inventory` document `cobolwork inventory` writes: counts of the programs, copybooks and JCL found, and the copybooks and files that could not be read. |
| `toSarif` | function | `toSarif(report, { toolVersion })` turns a scan or flow report into SARIF 2.1.0. `toolVersion` defaults to this package's version. |
| `parseFile` | function | `parseFile(file, options)` reads a COBOL source file and parses it with its copybooks expanded. |
| `parseSource` | function | `parseSource(text, file, options)` parses source text already read, as `parseFile` does. |
| `detectFormat` | function | `detectFormat(text)` names the reference format the source is in: `fixed`, `free`, `variable` or `terminal`. |
| `normalize` | function | `normalize(text, format, defines, std)` keeps each line's program text by line number, without comments or the sequence area, and applies the `>>` directives with the `defines` Map. |
| `tokenize` | function | `tokenize(normalized, file)` splits what `normalize` returns into tokens, with its diagnostics. |
| `buildFileIndex` | function | `buildFileIndex(root)` lists a directory's files as every rule set walks it, with the directories it could not list and the symbolic links it did not follow. |

What `scan` and `inventory` return follows their schemas under Documents. What `analyze`, the
parser functions and `buildFileIndex` return, and what `RULES` holds beyond its rule ids, can change
in a minor release, and the release notes say so.

## How a contract changes

- **Additions** come in a minor release: a rule, a command, an option, a key in a document cobolwork
  writes, or a name the library exports. A program that reads cobolwork's documents should ignore
  keys it does not know.
- **A rename** keeps the old name working as an alias for one major release, and using it warns.
- **A deprecation** warns for at least one minor release before the major release that removes it.
