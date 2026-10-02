# Evidence: sealed logs, attestations and the COBOL bill of materials

A specification for what cobolwork records about its own runs and the estates it reads, in a form
a third party can verify: a hash-chained journal of every run, a ledger chaining the runs, seals
signed and anchored outside the writer's reach, in-toto statements for builds and changes, and a
CycloneDX bill of materials for a COBOL estate. The scenarios in §14 are the tests: each
`#### <id>` heading names exactly one test, and `test/evidence.test.mjs` fails if a heading has no
test or a test names a heading that is not here.

Status: proposed, 2026-09-30. ironwork's half is `docs/evidence.md` in ironwork.

---

## 1. Why this exists

Between 2026-07-09 and 2026-07-13 an autonomous agent escaped an evaluation sandbox and worked
inside Hugging Face's production cluster for 4.5 days, about 17,600 actions, entering through a
dataset config whose fsspec `reference://` offset was a Jinja2 template
(huggingface.co/blog/agent-intrusion-technical-timeline). Two things decided what Hugging Face
could say afterwards: the logs it reconstructed the actions from, and the digests it verified
published images against. A log the intruder could have rewritten, or an artefact with no recorded
digest, would have left both questions open.

A COBOL estate has the same questions and fewer answers. Nothing records which copybook a program
was built with, by digest; a copy library is searched by name and the first member found wins. A
baseline suppression is a line in a file anyone with commit access can add. cobolwork's own reports
are written and forgotten. NIST SP 800-53 AU-9 asks that audit information be protected from
unauthorised modification and deletion, and Delegated Regulation (EU) 2024/1774 Article 12 for
"measures to protect logging systems and log information against tampering, deletion, and
unauthorised access".

**cobolwork runs no model and opens no network connection here either.** Sealing, signing and
anchoring use tools the operator already trusts (OpenSSH, cosign, OpenSSL, git), run as separate
programs with an argument vector and no shell. cobolwork verifies what it can verify with Node's
standard library and names the external verifier for the rest. Nothing in this document is new
cryptography.

## 2. Ubiquitous language

| Term | Meaning |
|---|---|
| Evidence directory | Where the journals, the ledger and the seals live. Named by `--evidence <dir>` or `COBOLWORK_EVIDENCE`. Never inside a tree being scanned. |
| Record | One line of JSON in a journal or the ledger, with `prev` and `hash`. |
| Run journal | The records of one invocation, in `runs/<runId>.jsonl`, from `open` to `close`. |
| Ledger | `ledger.jsonl`: one record per run, carrying the run journal's tip. |
| Tip | The `hash` of the last record of a chain. |
| Seal | An in-toto statement whose subject is the ledger's tip, wrapped in a DSSE envelope and signed. |
| Witness | Somewhere a seal is kept that the writer of the evidence directory cannot rewrite: a git repository the operator pushes, an RFC 3161 time-stamping authority, a transparency log. |
| Anchored | The ledger agrees with a seal copy kept in the evidence directory. A consistency check, not evidence: the same writer holds both. |
| Sealed | The ledger agrees with a seal read from a witness, whose signature verifies against an allowed signer. |

## 3. The evidence directory

- **Named, never inferred.** With no `--evidence` and no `COBOLWORK_EVIDENCE`, nothing is written
  and every command behaves as it does today.
- **Refused inside a scanned tree** (exit 2), as `COBOLWORK_WITNESS` is. A repository that shipped
  its own `ledger.jsonl` must not be able to supply the history its review is judged against.
- **Refused through a symbolic link** at the directory or at any file cobolwork writes in it, as
  `baseline` refuses one today. Files are created with mode `0600`, the directory `0700`.
- Layout: `ledger.jsonl`, `runs/<runId>.jsonl`, `seals/<seq>.dsse.json`, `seals/<seq>.tsq` (the RFC 3161
  request last written for that seal), `ledger.lock` while held.
- `runId` is `<UTC yyyymmddThhmmssZ>-<16 hex random>`; the random half comes from
  `crypto.randomBytes`, never from time or pid.

## 4. Records

Every record is one JSON object on one line, UTF-8, `\n`-terminated:

```json
{"v":1,"chain":"<32 hex>","seq":0,"at":"2026-09-30T04:12:09.113Z","kind":"open", ... ,"prev":"<64 hex>","hash":"<64 hex>"}
```

- **Canonical form.** Keys sorted by UTF-16 code unit at every depth, no insignificant whitespace,
  strings escaped as `JSON.stringify` escapes them, integers only (a record holding a non-integer
  number is refused by the writer, so no float ever needs a canonical spelling).
- **The hash.** `hash = SHA-256("cobolwork-evidence/v1\n" || canonical(record minus "hash"))`, full 64
  hex. It binds every field, `prev` and `seq` included; there is no field a later edit can change
  without breaking it.
- **`chain`** is 128 random bits chosen at `open` and repeated on every record. A record lifted from
  another journal fails on `chain` before it fails on `prev`.
- **`prev`** is the previous record's `hash`; the `open` record's `prev` is 64 zeros.
- **`seq`** starts at 0 and increases by one. A gap or a repeat is a break.
- **No secret values, and no source text.** A finding is its fingerprint, rule, tier, file and line.
  A secrets finding carries its fingerprint and never its match. A path is relative to the root it
  was read under. The writer refuses a record with a key it does not know for that kind (§5), so
  a new field is a reviewed change to this document, not a silent addition.

## 5. The run journal

| kind | fields | written |
|---|---|---|
| `open` | `tool`, `toolVersion`, `toolRevision`, `command`, `argv` (option names and values, values of `--copylib` and paths relative), `node`, `platform` | first |
| `input` | `root` (index into `open.roots`), `path`, `sha256`, `bytes` | once per file the run read |
| `finding` | `fingerprint`, `rule`, `tier`, `path`, `line` | once per finding reported |
| `suppressed` | `fingerprint`, `by` (`baseline` or `waiver`), `who`, `expires`, `reasonSha256` | once per finding a baseline or waiver removed |
| `baseline-write` | `added[]`, `removed[]` (fingerprints), `who`, `expires`, `reasonSha256`, `path`, `sha256` | when `baseline` writes |
| `witness` | `fingerprint`, `outcome`, `who`, `when`, `system`, `sourceSha256` | once per witness entry applied |
| `verdict` | `verdict`, `checks`, `relaxed`, `exit` | build and gate |
| `output` | `name` (`report`, `sarif`, `provenance`, `sbom`, `baseline`), `sha256`, `bytes`, `path` or `stdout` | once per document written |
| `close` | `exit`, `counts` (`input`, `finding`, `suppressed`, ...), `durationMs` | last |

ironwork writes its run journal in this format (ironwork `crates/rt/src/evidence.rs`), with `tool`
`ironwork` and three kinds of its own, so `evidence verify` reads both tools' journals:

| kind | fields | written |
|---|---|---|
| `dd` | `dd`, `event` (`open`, `close`, `end`), `mode`, `sha256`, `bytes` | a file's digest before it is opened, after it is closed, and as the run left it |
| `call` | `program`, `from`, `sha256` | a program CALL loaded from a library, with its source's digest |
| `abend` | `code`, `file`, `line` | the abend a run ended with |
| `step` | `step`, `pgm`, `outcome` | a job step ironwork ran or bypassed, and how it ended (`RC=0004`, `ABEND S0C7: …`, `BYPASSED: …`, `JCL ERROR: …`) |
| `sink` | `sink`, `file`, `line`, `marker`, `reached` | an operation an ironwork run with `--trace-marker` reached (ironwork `docs/evidence.md` §1.1): the sink kind as `lib/dataflow.mjs` names it, where it is, the marker, and whether the marker was in its operand; once reached and once not, never the operand |

A reason is recorded as its digest, not its text: a reason is free prose, and free prose is where a
secret or a person's name ends up.

A run that dies before `close` leaves a journal with no `close`. `verify` reports it as `open`,
never as broken and never as complete.

## 6. The ledger

One record per closed run: `{"v":1,"chain":<ledger chain>,"seq":n,"at":...,"kind":"run","run":"<runId>","runChain":"<chain>","runLength":n,"runTip":"<hash>","prev":...,"hash":...}`.

- Appended under `ledger.lock`, taken with `open(O_CREAT|O_EXCL)`, then given the holder's pid and
  time. A lock older than 60 seconds whose holder pid is not alive is stale and is broken, and the
  break is itself a ledger record (`kind: lock-broken`, the holder's pid and age). A lock whose pid
  or time cannot be read was left by a writer that died before writing them: it is aged from its
  modification time, and broken with a `holderPid` of null. The wait is bounded at 5 seconds.
- If the lock cannot be had, the run journal stays where it is, its `close` record says
  `ledger: "unrecorded"`, the command's exit status is unchanged, and standard error says so. A
  lost ledger line is reported by `verify` as `unrecorded`; losing the run's own record would not be.
- The ledger's first record is `kind: genesis` with its `chain` and `createdAt`. A ledger is one
  file for its whole life: `verify` reads every record and every run journal a record names, so
  splitting the file would not shorten a verification.

## 7. Seals

`cobolwork evidence seal --evidence <dir> [--ssh-key <file> | --signer <program>] [--out <file>]`

1. Read the ledger to its tip under the lock.
2. Build the statement:

   ```json
   {"_type":"https://in-toto.io/Statement/v1",
    "subject":[{"name":"ledger:<chain>","digest":{"sha256":"<tip>"}}],
    "predicateType":"https://github.com/Portll/cobolwork/blob/main/docs/spec/evidence.md#seal-v1",
    "predicate":{"ledgerLength":n,"sealedAt":"...","previousSeal":{"sha256":"<digest of the last seal's envelope>"}|null,
                 "tool":{"name":"cobolwork","version":"..."}}}
   ```

3. Wrap it in a DSSE envelope, `payloadType: application/vnd.in-toto+json`, and sign the DSSE
   pre-authentication encoding (PAE): `"DSSEv1" SP len(type) SP type SP len(body) SP body`.
4. Signers:
   - `--ssh-key <file>`: `ssh-keygen -Y sign -f <file> -n cobolwork-evidence` over the PAE on
     standard input. The SSHSIG blob, base64, is the envelope's `sig`; `keyid` is the key's `SHA256:`
     fingerprint.
   - `--signer <program>`: runs the program with the single argument `cobolwork-evidence` (the
     namespace), PAE on standard input, and takes an armoured SSHSIG from standard output, as
     `ssh-keygen -Y sign` writes one. A KMS or HSM is reached through a program that signs as
     `ssh-keygen` does (an ssh-agent backed by PKCS#11 is one), so every signature verifies one way.
   - Keyless signing (Sigstore) is the pipeline's, over the statement, and is checked by §8's cosign
     witness, not by this field.
   - Neither: the envelope is written with `signatures: []`, which `verify` reports as unsigned.
5. Write `seals/<seq>.dsse.json` and, with `--out`, a copy for the pipeline to hand to a witness.

A seal chains to the one before it through `previousSeal`, so a deleted seal is a break in the
seal chain, not an absence.

**Private keys never pass through cobolwork**: it names a key file to `ssh-keygen`, which reads it.

## 8. Witnesses

cobolwork writes what a witness needs and reads what a witness returns. Its one transport is the
git push `evidence anchor --anchor-git <repo> --push` makes when the operator asks for it; an RFC
3161 request and a transparency-log entry travel by the operator's own tools.

| Witness | Writing | Reading, in `verify` |
|---|---|---|
| git | `evidence anchor --anchor-git <repo>` copies the envelope to `<repo>/<ledger chain>/<seq>.dsse.json` and commits it there with `git` plumbing (argv, bounded). `--push` pushes the current branch and reports "committed, not pushed" on failure or timeout. | `--anchor-git <repo> [--ref <ref>] [--anchor-pin <commit>]` reads `git show <ref>:<path>` for every seal; default ref `@{upstream}`, so a seal nobody pushed does not count. `--anchor-pin` names the commit an earlier verification accepted (`witnessCommit`, kept by the pipeline outside the evidence directory): it must be in the ref's history, and every seal it held must be at the ref unchanged, or `sealed` is false. |
| RFC 3161 | `evidence anchor --tsq <file>` writes a DER `TimeStampReq` over SHA-256 of the envelope, with a random nonce and `certReq` true, and keeps a copy as `seals/<seq>.tsq`. The operator posts it (`curl --data-binary @req.tsq -H 'Content-Type: application/timestamp-query' <tsa>`). | `--tsr <file> --tsa-ca <file>`: cobolwork reads the response itself, finds the seal its `messageImprint` names and checks the nonce against the kept request, then has OpenSSL check the authority's signature: `openssl ts -verify -in <tsr> -data <envelope> -CAfile <ca>`. An imprint that names no seal, another nonce or a signature OpenSSL refuses is `false`; no `--tsa-ca`, no kept request, or no OpenSSL on `PATH` is `null` with that reason. |
| Transparency log | The pipeline runs `cosign sign-blob --bundle` on the seal envelope (`seal --out`). | `--cosign-bundle <file>` with `--certificate-identity` and `--certificate-oidc-issuer`, or `--cosign-key <file>` for a key-signed bundle: `cosign verify-blob` against each seal, newest first; `--trusted-root <file>` keeps cosign from fetching Sigstore's root, and `--insecure-ignore-tlog` accepts a bundle with no log entry, which the verdict reports. A bundle that verifies against no seal is `false`. Keyless verification is never reimplemented here. |

Only the digest of an envelope leaves the evidence directory for an RFC 3161 authority or a
transparency log; the envelope itself names a ledger chain and a length, nothing about the estate.

A git witness is only as fixed as its branch. The anchor repository's branch must refuse force
pushes and deletion (branch protection on the host), or whoever can push can rewrite it to match a
cut ledger. A later commit that deletes seals needs no force push, so a pipeline also keeps
`witnessCommit` from each verification and passes it back as `--anchor-pin`.

## 9. Verify

`cobolwork evidence verify --evidence <dir> [--allowed-signers <file>] [witness options]`

The verdict reports these separately and never merges them:

| Field | Meaning |
|---|---|
| `verified` | Every record in the ledger and every run journal it names hashes as written and links to its predecessor. |
| `broken` | Each record that does not: file, line, and which check failed (`hash`, `prev`, `seq`, `chain`, `canonical`). |
| `unrecorded` | Run journals in `runs/` no ledger record names. |
| `open` | Run journals with no `close`. |
| `anchored` | The newest seal in `seals/` names the ledger at a length and tip the ledger has. `null` with no seal. |
| `sealed` | `true`: a seal read from a witness names a ledger state this ledger contains, and its signature verifies against `--allowed-signers`. `false`: a witness contradicts the ledger. `null`: undetermined, with the reason. `null` never counts as a pass. With several witnesses, one that contradicts makes it `false`; otherwise one that confirms makes it `true`, and the newest seal any of them confirms sets `unsealedTail`. |
| `unsealedTail` | Ledger records after the newest witnessed seal. |
| `witnessCommit` | The commit the git witness's ref resolved to, for the next verification's `--anchor-pin`. |
| `timeStamp`, `transparencyLog` | The seal an RFC 3161 response or a cosign bundle names, with the response's `genTime`, or whether the log entry was checked. |
| `signatures` | Per seal: `keyid`, principal matched in allowed signers, `valid`. |

SSHSIG verification (`ssh-ed25519`, `ecdsa-sha2-nistp256`) is done here with `node:crypto`
against an OpenSSH `allowed_signers` file, honouring a line's `namespaces=` option. Any other key
type, the hardware-backed `sk-` forms included, leaves `valid: null` and names the type, until a
test key of that type is in the suite.

Exit: 0 when `verified` and `sealed` is `true` and `unsealedTail` is within `--max-unsealed`
(default 0); 1 when anything is `broken` or `sealed` is `false`; 3 when undetermined; 2 for usage.

**What a chain does not prove.** A chain proves continuity from its first record. Rewriting a whole
ledger from genesis produces a chain that verifies; only a witnessed seal catches it, which is why
`sealed` and `verified` are separate fields. A truncated tail verifies too, and is caught the same
way, and by `unsealedTail` against a policy that says how often seals are due.

## 10. Build provenance as SLSA

`cobolwork build ... --provenance <file> --provenance-format slsa` writes an in-toto statement
(the existing record stays the default, `--provenance-format cobolwork`):

- `predicateType`: `https://slsa.dev/provenance/v1`.
- `subject`: the build document (`name: build.json`) and, for each `--artifact <path>` the pipeline
  names, that file. cobolwork does not guess what a compiler produced.
- `buildDefinition.buildType`: `https://github.com/Portll/cobolwork/blob/main/docs/spec/evidence.md#build-v1`.
- `externalParameters`: revisions, the canonical policy and its digest, copylibs, and the compiler's
  arguments with every value replaced by `<value>` (option names kept, as `-DKEY=<value>`), beside
  `compilerArgumentsSha256`, the digest of the arguments as run joined by NUL: a path or a secret on
  the command line is not published, and a holder of the arguments can still check them.
- `resolvedDependencies`: every source read (`uri: file:<relative path>`, `digest.sha256`), every
  copy library member resolved, the compiler binary, ironwork with its version.
- `runDetails.builder.id`: `COBOLWORK_BUILDER_ID` when a pipeline sets it, else
  `https://github.com/Portll/cobolwork/local`; `metadata.invocationId` is the run journal's `runId`;
  `byproducts` holds the run journal's tip.

The statement is unsigned. Signed by a hosted build platform's identity it can support SLSA Build
L2; cobolwork makes no level claim, and the document says which fields a verifier must check.

## 11. The COBOL bill of materials

`cobolwork sbom <root> [--out <file>]` writes CycloneDX 1.6 JSON.

- `metadata.component`: the estate, `type: application`, named by `--name` or the root's directory. In
  a git repository its `version` is the commit read, with `cobolwork:dirty` saying whether the tree
  differed from it.
- `components`: one per file cobolwork reads, `type: file`, `hashes: [{alg: SHA-256, content}]` over the file's bytes,
  `properties` `cobolwork:kind` = `program`, `copybook`, `jcl`, `proc`, `csd`, `bms`, `ddl`, and for
  programs `cobolwork:program-id`, `cobolwork:format` (the reference format read), and `cobolwork:options` (the `CBL`/`PROCESS`
  options in force).
- Platforms a program uses (CICS, Db2, IMS, MQ, LE) as `type: platform` components, named, with no
  version: the source does not say which release it runs on, and a guessed version would feed a
  vulnerability matcher a claim nobody made.
- A program the estate does not hold, named by a job step, a literal `CALL`, `LINK` or `XCTL`, is a
  `type: application` component `program:NAME`, `cobolwork:kind` = `system-program` for IBM's
  utilities and subsystem programs (IDCAMS, SORT, IKJEFT01, DFSRRC00, the compilers and binders) and
  `external-program` otherwise. A routine a platform provides (`CEE…`, `CBLTDLI`, `MQ…`) is its
  platform, not a program.
- `dependencies`: program → copybooks it copies (resolved path), program → programs it calls
  statically or links or transfers to by literal, program → the BMS mapset a `SEND MAP` or
  `RECEIVE MAP` names, job → programs its steps run, including the program a TSO batch step's
  `DSN RUN PROGRAM(...)` runs and the application program an IMS region's `PARM='BMP,PGM,PSB'`
  names, job → procedures its steps call, program → platforms. A dynamic `CALL`, `LINK` or `XCTL`
  through a field is a property `cobolwork:unresolved-call` on the caller, never an edge; a
  procedure the estate does not hold is `cobolwork:unresolved-proc` on the job. A PROGRAM-ID two
  files hold is an edge to each (which one a run loads is the load library's order), and each carries
  `cobolwork:program-id-also-in`. A source whose text cannot be decoded is still a component with its
  digest, marked `cobolwork:undecodable`; a copy library member gone since the parse read it is
  `cobolwork:unread` and has no hash; members of one name in two copy libraries are two components,
  the second named with its directory's digest.
- `serialNumber` is a UUID version 5 over the sorted component digests, and `metadata.timestamp`
  comes from `SOURCE_DATE_EPOCH` or is omitted, so the same tree gives the same bytes.

## 12. Change assurance

A change to a COBOL program, by a person, a code assistant or a translation to another language,
reaches production today on a reviewer's reading and a parallel run someone compared by eye. The
design below makes the comparison mechanical, bounded by what it measured, and part of the
evidence.

1. **Static.** `cobolwork build --base --head` already blocks a change that adds a finding or drops a
   run-time check. It gains `option-changed` (§13.4): a `CBL` or `PROCESS` card that changes TRUNC,
   ARITH, NUMPROC, NUMCHECK, SSRANGE, CODEPAGE or INTDATE changes arithmetic, validation or collation
   for the whole program without touching a statement.
2. **Behavioural.** `ironwork compare` runs the base and head programs on the same recorded inputs
   (DD files, SYSIN, a fixed clock, a strict SQL recording) in separate directories and compares
   every output byte, the RETURN-CODE, the abend, and the SQL each issued. Its result is an in-toto
   statement, `predicateType ...ironwork/docs/evidence.md#equivalence-v1`, whose subjects are the
   base and head sources by digest, and whose verdict is `equivalent`, `diverged` or `inconclusive`.
   A program that prints through CALL 'SYSTEM' with lp or lpr is compared with `--dd PRINTER=<file>`:
   ironwork's virtual printer takes the print in place of the host, so a change that stops the
   program printing diverges, and one that keeps the print is compared past it.
3. **Coverage decides inconclusive.** A comparison whose inputs never reached a changed paragraph
   proves nothing about it; ironwork's coverage (E9) names the changed paragraphs the runs reached,
   and one left unreached makes the verdict `inconclusive`, never `equivalent`.
4. **Intended changes are declared.** A change manifest lists the divergences the change means to
   make (DD, record range, and why); `diverged` with every divergence declared is `equivalent-as-declared`.
5. **Recorded production inputs are masked before they leave production**: `ironwork mask` rewrites
   the fields a copybook names with a keyed, format-preserving transform (the key stays with the
   owner), and both versions read the same masked bytes.
6. **Policy.** `cobolwork build --base --head --equivalence <statement>[,...]` matches each statement to
   a program the change edits by the digests of its `base:` and `head:` subjects; a statement that
   matches no edited program fails the build. A program's statement satisfies the check when its
   verdict is `equivalent` or `equivalent-as-declared`, its coverage was measured and reached every
   changed paragraph, and it is signed by one of `--allowed-signers` (`cobolwork evidence sign
   <statement> --ssh-key <file>` wraps a statement in a DSSE envelope as seals are signed). Where
   equivalence may be required, a build with no `--allowed-signers` fails the check, since a
   statement nobody signed could have been written by anyone who can commit; and the signers file,
   like the policy floor, is refused inside the repository. The policy
   key `requireEquivalence` (`never`, `machineAuthored`, `always`; the stricter of floor and
   repository wins) says when every edited program needs one. `machineAuthored` reads the commits in
   `base..head`: an author, committer or `Co-authored-by`/`Generated-by` trailer naming a code
   assistant or bot makes the change machine-authored; commits that cannot be read leave the check
   undecided. A statement with `coverage: null` (the head did not run), or whose `coverage.unreached`
   is not a list of paragraph names, is inconclusive under this check. cobolwork reads the base and
   head itself for paragraphs whose own statements changed, positions left out as ironwork leaves
   them out, and each must be in the statement's `coverage.changed`: a statement that leaves an
   edited paragraph out of its scope has not held it to coverage. A program whose bytes are
   unchanged but whose copybooks the change edits counts as edited, and its statement's
   `closure.head` must hold each edited copybook's digest, so the statement shows the head run read
   the new copybook. A program the change deletes fails where equivalence is required: no statement
   can show what its callers do now. Where several statements name one program, each must pass.
7. **Translations.** For COBOL translated to Java, `ironwork run` of the original produces the
   expected outputs and a statement over them; the translation's own run is compared with
   `ironwork compare --expected`.

**Limit, stated in every statement:** equivalence is under ironwork's model of Enterprise COBOL.
Until ironwork's oracle holds Enterprise COBOL goldens, the claim is that the two versions agree
with each other under that model.

## 13. Lanes

### 13.1 Zowe and agent configuration

Read: `zowe.config.json`, `zowe.config.user.json` (Zowe team configuration), MCP client
configuration (`.mcp.json`, `.vscode/mcp.json`, `.cursor/mcp.json`, `.claude/settings.json`,
`.claude/settings.local.json`, `claude_desktop_config.json`, `.gemini/settings.json`), VS Code
settings (`.vscode/settings.json`), and the Zowe MCP server's `native-config.json` and mock
`systems.json`.

| Rule | Sev | CWE | Fires on |
|---|---|---|---|
| `zowe-config-secret-in-clear` | high | 256 | a profile's `properties.password`, `tokenValue` or `authToken` present in a team configuration and not listed in that profile's `secure` array, or a literal `password` anywhere in `native-config.json` |
| `zowe-config-tls-verify-off` | med | 295 | `rejectUnauthorized: false` in a profile or in `defaults`, or anywhere in `native-config.json` |
| `zowe-config-cleartext` | med | 319 | `protocol: "http"` on a z/OSMF, API ML or RSE profile |
| `zowe-mcp-password-in-config` | high | 798 | an MCP server entry whose `env` sets `ZOWE_MCP_PASSWORD_*`, `ZOWE_MCP_CREDENTIALS` or `ZOWE_MCP_KEY_PASSPHRASE_*` to a literal |
| `zowe-mcp-tier-writes` | med | 250 | the capability tier (`--capability-tier`, `ZOWE_MCP_CAPABILITY_TIER`, `zoweMCP.capabilityTier`) is `update` or `delete` |
| `zowe-mcp-tier-full` | high | 250 | the capability tier is `full`, which lets the agent submit jobs and run commands as the user it logs on as |
| `zowe-mcp-data-marking-off` | med | 1427 | `ZOWE_MCP_DATA_MARKING=0`, which drops the untrusted-data marking on what the agent reads from the mainframe |
| `zowe-mcp-unpinned` | low | 829 | the server launched by `npx`, `bunx`, `pnpx`, `pnpm`, `yarn` or `npm` from `@zowe/mcp-server` with no version, or `@latest` |
| `zowe-mock-credentials` | med | 798 | a `systems.json` under a mock directory holding a password |

A server entry is the Zowe MCP server when its command or arguments name `@zowe/mcp-server` or
`zowe-mcp`, or its `env` sets a `ZOWE_MCP_` variable. `native-config.json` is read without assuming
its layout. A finding names the file, the profile or server, and the key; never the value.

### 13.2 Control cards that execute

A utility that runs commands it reads from a data set runs whatever that data set says on the day
the job runs; the JCL a reviewer approved does not decide it. BPXBATCH running a shell is already `job-reaches-unix-system-services` in the privilege set. For
IKJEFT01/IKJEFT1A/IKJEFT1B `SYSTSIN`, BPXBATCH `STDPARM`, IDCAMS `SYSIN`, DFSORT and ICETOOL `SYSIN`/`DFSPARM`/
`TOOLIN`, and DSNTEP2/DSNTIAD `SYSIN` (FTP subcommands kept in a data set are already named by the FTP rules):

| Rule | Sev | CWE | Fires on |
|---|---|---|---|
| `control-cards-from-dataset` | low | 829 | the command DD names a cataloged data set rather than in-stream data, so the commands are outside the reviewed source; low because control-card libraries are ordinary practice, and the finding names the data set whose write access decides the risk |
| `sort-exit-named` | med | 829 | DFSORT `MODS` naming E15/E35 (or any Exx) exit routines: load modules the sort loads and runs |
| `tso-batch-runs-program` | low | 78 | in-stream `SYSTSIN` with `CALL`, `EXEC`, `SUBMIT` or `ISPSTART`, reported with the command so the review sees it |

### 13.3 Copy members found twice

The copybook set already reports a name found twice: `copybook-shadowed` (two copybooks with
different layouts answer to one name) and `copybook-shadows-system` (a repository copybook takes a
system copybook's name). What this document adds is the other half: the SBOM (§11) and the build
provenance (§10) record the digest of the member each `COPY` resolved to, so a build can show which
one it got, and a rebuild that resolves a different member is visible as a changed dependency.

### 13.4 Option changes

In `build --base --head`, each program present on both sides is compared for the options in force
from its `CBL` and `PROCESS` cards, in the families TRUNC, ARITH, NUMPROC, NUMCHECK, SSRANGE, CODEPAGE
and INTDATE. Spellings come from IBM's option table (`lib/enterprise-options.mjs`), so `AR(C)` and
`ARITH(COMPAT)` are one setting, and a later card overrides an earlier one. The build document lists
each change in `optionsChanged` (`path`, `option`, `base`, `head`, `line`) and says it in `reasons`.
It is advisory: a change that drops a run-time check the policy requires already fails the build
(§7 of `build-gate.md`); a policy key that blocks on any watched change is a follow-up.

### 13.5 Execution coverage

`COBOLWORK_EXECUTION` names reports `ironwork run --coverage` wrote (several, separated as `PATH`
is), from runs of the estate's own tests. A finding inside a paragraph of a program a report covers
carries `executed: { paragraph, entered }`: the paragraph it is in, by the report's line for each
paragraph, and how often the runs entered it, summed over the reports. The summary counts
`byExecution` (`entered`, `never-entered`) and names the reports in `executionFeeds`; a report that
cannot be read is in `executionFeedProblems`. A finding before a program's first paragraph, or in a
program no report covers, has no `executed`. The program a finding is in is the last PROGRAM-ID at
or before its line. It annotates and does not re-rank: a paragraph the tests never enter is code
nobody has seen run, and one they enter is code whose behaviour a change to it would show.

### 13.6 Abends from fuzzing

`COBOLWORK_ABENDS` names fuzz runs ironwork's harness wrote (several, separated as `PATH` is). A run
is a directory: `manifest.json` (`tool: "ironwork-fuzz"`) names the program by its path in the scanned
tree, the inputs, and each run that ended in an abend with `{ code, file, line, message }` and the
journal that recorded it; `evidence/` holds those journals and their ledger. The `abend` set reports
one finding per rule, file and line, with the smallest input that produced it, and only where the
evidence directory verifies (§9) and the run's own journal records the abend code the manifest gives.
Where the journal also records the abend's file and line, the finding is placed there, and a manifest
that places it elsewhere is not believed. The file is named relative to the directory the run read
it from. Where the manifest lists those directories (`roots`: the program's directory, then each
library, by path in the scanned tree, numbered as the journal's `input` records number them), the
finding goes under the one the journal's `input` record for that file names. A CALLed program's
source has a `call` record instead, naming it by path and digest without its root: the finding goes
under the root where the scanned tree holds that file with that digest, or the one root holding it
at all. Without `roots` or either record, it goes under the program's directory. A file whose root
cannot be told, or lies outside the scanned tree, is in `abendRunProblems`.
Its rules are `execution` evidence: a run of the program on that input ended this way.

| Rule | Severity | When |
|---|---|---|
| `input-causes-abend-s0c7` | med | the abend is S0C7, a data exception |
| `input-causes-abend-s0c4` | high | the abend is S0C4, a protection exception |
| `input-causes-abend-subscript-range` | high | the message starts with IGZ0006S, IGZ0007S, IGZ0072S, IGZ0073S or IGZ0074S: a subscript, index, OCCURS DEPENDING ON object or reference modification SSRANGE caught out of range |
| `input-causes-abend` | med | any other abend |

An abend with code `IRONWORK` is something ironwork does not run, counted as `notModelled` and never a
finding. A manifest that cannot be read, evidence that does not verify, or a journal that does not
record the claimed abend is in `abendRunProblems` and leaves the set incomplete. A program outside
the scanned tree is refused, and a finding in a file the scanned tree does not hold is listed in
`abendRunsElsewhere` instead of reported.

## 14. Specification (BDD)

### V1 - Records and journals

#### V1.1 Without an evidence directory nothing is written
    When  a scan runs with no --evidence and no COBOLWORK_EVIDENCE
    Then  no file is created and the report is byte-identical to today's

#### V1.2 A run journal opens, records inputs and findings, and closes
    When  a scan runs with --evidence
    Then  runs/<runId>.jsonl holds open, one input per file, one finding per finding, output and close, in that order

#### V1.3 Every record hashes over its canonical form
    Then  recomputing SHA-256 of the domain tag and the canonical record without hash gives hash, for every record

#### V1.4 A record carries no source text and no secret value
    Given a program with a hard-coded RACF password
    Then  no journal line contains the password or any source line

#### V1.5 An evidence directory inside the scanned tree is refused
    When  --evidence names a directory under the root being scanned
    Then  the command exits 2 and writes nothing

#### V1.6 An evidence file reached through a symbolic link is refused
    When  ledger.jsonl is a symbolic link
    Then  the command exits 2 and the link's target is unchanged

#### V1.7 A record with an unknown key is refused by the writer
    When  the writer is handed a finding record with a field §5 does not list
    Then  it throws, and nothing is appended

#### V1.8 A non-integer number is refused by the writer
    When  a record holds 1.5
    Then  it throws

#### V1.9 An ironwork run journal verifies with the same verifier
    Given a journal of ironwork's open, input, dd, call, abend and close records
    Then  verify reports it verified, and a dd record with an event it does not know as broken

### V2 - The ledger

#### V2.1 Each closed run adds one ledger record carrying its tip
    Then  the ledger's last record names the run, its length and its tip

#### V2.2 A held lock leaves the run unrecorded, not lost
    Given ledger.lock held by a live process
    Then  the run journal is complete, its close says unrecorded, and the exit status is the scan's own

#### V2.3 A stale lock is broken and the break is recorded
    Given ledger.lock older than 60 seconds whose pid is not running
    Then  the run is recorded and a lock-broken record precedes it

#### V2.4 A ledger whose last line is no record is not extended
    Given ledger.jsonl whose last line lacks a chain, or whose hash does not hold
    Then  the run is unrecorded and the ledger is unchanged

#### V2.5 An empty lock is aged from its modification time
    Given ledger.lock empty and last modified more than 60 seconds ago
    Then  the run is recorded after a lock-broken record whose holderPid is null, and a fresh empty lock is waited for

### V3 - Verify

#### V3.1 An untouched evidence directory verifies
    Then  verified is true and broken is empty

#### V3.2 An edited field breaks the chain at that record
    When  one finding's line number is changed in a run journal
    Then  broken names that file and line with check hash

#### V3.3 A deleted record breaks the chain at the next one
    Then  broken names the next record with check prev or seq

#### V3.4 A record spliced from another journal is caught by chain
    Then  broken names it with check chain

#### V3.5 A run journal the ledger does not name is unrecorded
    Then  unrecorded lists its runId and verified stays true

#### V3.6 A journal with no close is open, not broken
    Then  open lists it

#### V3.7 A ledger rewritten from genesis verifies but is not sealed
    Given a sealed ledger, then every file rewritten consistently with one run removed
    Then  verified is true, sealed is false against the witness, and the exit status is 1

#### V3.8 A truncated ledger is caught by the seal
    When  the last run's ledger record is removed after sealing
    Then  sealed is false

#### V3.9 No witness leaves sealed null and the exit status 3
    Then  sealed is null with a reason, and the exit status is 3

### V4 - Seals and signatures

#### V4.1 A seal is an in-toto statement over the ledger tip in a DSSE envelope
    Then  the payload decodes to a Statement v1 whose subject digest is the tip

#### V4.2 A seal names the seal before it
    Then  the second seal's previousSeal is the digest of the first envelope

#### V4.3 An SSH-signed seal verifies against allowed signers
    Given an ed25519 key and an allowed_signers line for namespace cobolwork-evidence
    Then  signatures[0].valid is true and names the principal

#### V4.4 A signature over a different ledger does not verify
    When  the envelope's payload is replaced
    Then  valid is false

#### V4.5 A signer outside allowed signers does not seal
    Then  valid is false and sealed is not true

#### V4.6 A signer program is run with the PAE on standard input
    Given --signer naming a program that signs with a test key
    Then  the envelope holds its signature and it verifies

#### V4.7 A deleted seal breaks the seal chain
    Then  verify names the seal whose previousSeal is missing

### V5 - Witnesses

#### V5.1 A git anchor commits the envelope to the anchor repository
    Then  git show HEAD:<chain>/<seq>.dsse.json in the anchor repository gives the envelope

#### V5.2 An anchor not pushed does not seal
    Given a git anchor committed and not pushed, and --ref naming the upstream
    Then  sealed is null with "not on <ref>"

#### V5.3 An RFC 3161 request is DER over the envelope digest
    Then  the TimeStampReq decodes with version 1, SHA-256, the envelope digest, a nonce and certReq true

#### V5.4 A time-stamp response for another digest does not seal
    Then  sealed is false and the reason names the message imprint

#### V5.7 A time-stamp response for the seal and the nonce of its kept request seals
    Given anchor --tsq, the authority's reply, and its CA certificate
    Then  sealed is true and timeStamp names the seal; without --tsa-ca it is null, and with another CA false

#### V5.8 A cosign bundle over a seal seals
    Given a key-signed bundle over the seal envelope
    Then  sealed is true and transparencyLog names the seal; a bundle over other bytes leaves sealed false

#### V5.5 A witness rewritten past its pinned commit does not seal
    Given two witnessed seals, the witness reset to drop the newer, and the ledger cut to the older
    Then  sealed is true without --anchor-pin, and false with the commit that held both

#### V5.6 A seal deleted from the witness after its pinned commit does not seal
    Given a commit on top of the pinned one that removes the newer seal
    Then  sealed is false and the reason names the seal

### V6 - Provenance

#### V6.1 SLSA provenance is a Statement v1 with the SLSA v1 predicate
    Then  predicateType is https://slsa.dev/provenance/v1 and the build document is a subject

#### V6.2 Every source read is a resolved dependency with its digest
    Then  resolvedDependencies holds one entry per hashed source, matching the build's hashes

#### V6.3 The run journal's tip is a byproduct
    Then  byproducts names the run journal and its tip

#### V6.4 The default provenance record is unchanged
    Then  --provenance without --provenance-format writes today's record

### V7 - The bill of materials

#### V6.5 The compiler arguments are recorded without their values
    Then  compilerArguments keeps each option's name with <value> for its value, and compilerArgumentsSha256 is the digest of the arguments as run

#### V7.1 The SBOM is CycloneDX 1.6 with one file component per source
    Then  bomFormat is CycloneDX, specVersion 1.6, and every program, copybook and JCL member has a SHA-256

#### V7.2 A COPY is a dependency from the program to the copybook it resolved to
    Then  the program's dependsOn holds the copybook's bom-ref

#### V7.3 A dynamic CALL is a property, not a dependency
    Then  cobolwork:unresolved-call names the field and no edge is invented

#### V7.4 The same tree gives the same SBOM bytes
    Given SOURCE_DATE_EPOCH set
    Then  two runs write identical files

#### V7.5 A platform has no version
    Then  a CICS program depends on a platform component named CICS with no version field

#### V7.6 A job depends on the program a TSO batch step or an IMS region runs, and on the procedure it calls
    Then  DSN RUN PROGRAM and PARM='BMP,PGM,PSB' are edges to the programs, EXEC PROC an edge to the procedure, and a missing procedure is cobolwork:unresolved-proc

#### V7.7 A program outside the estate is a component, marked system or external; a platform routine is not
    Then  IDCAMS is a system-program, a literal CALL to a program not held is an external-program, and MQPUT1 is the MQ platform

#### V7.8 CICS XCTL and LINK by literal are edges, through a field a property; SEND MAP depends on its mapset
    Then  XCTL PROGRAM('X') is an edge, LINK PROGRAM(field) is cobolwork:unresolved-call, and SEND MAP MAPSET('S') depends on the BMS file that defines S

#### V7.9 The estate carries the commit it was read at, and no version outside a repository
    Then  metadata.component.version is HEAD with cobolwork:dirty, and absent where the root is not in a repository

#### V7.10 A PROGRAM-ID two files hold is an edge to each, and each says where the other is
    Then  the caller depends on both files and each carries cobolwork:program-id-also-in

### V8 - Zowe and agent configuration

#### V8.1 A team-config password outside secure is reported and not echoed
    Then  zowe-config-secret-in-clear names the profile and key, and the value appears nowhere

#### V8.2 A password listed in secure is not reported
    Then  nothing fires

#### V8.3 rejectUnauthorized false is reported
    Then  zowe-config-tls-verify-off fires

#### V8.4 A Zowe MCP password in an MCP client env block is reported
    Then  zowe-mcp-password-in-config names the server and the variable

#### V8.5 A capability tier of full is high
    Then  zowe-mcp-tier-writes fires at high

#### V8.6 read-strict and read are not reported
    Then  nothing fires

#### V8.7 Data marking turned off is reported
    Then  zowe-mcp-data-marking-off fires

#### V8.8 An unpinned npx launch is reported
    Then  zowe-mcp-unpinned fires, and a pinned version does not

#### V8.9 A comment after a trailing comma does not hide the file
    Given an MCP client configuration whose last server is followed by a comma and a comment
    Then  the configuration is read and its findings are reported

#### V8.10 The server is known by its ZOWE_MCP_ variables and by any registry runner
    Given a server launched from a local path whose env sets ZOWE_MCP_ variables, and one run by bunx unpinned
    Then  the first's findings and the second's zowe-mcp-unpinned are reported

#### V8.11 native-config.json is read for passwords and TLS verification
    Given a native-config.json holding a literal password and rejectUnauthorized false
    Then  zowe-config-secret-in-clear and zowe-config-tls-verify-off are reported, and not the password

### V9 - Control cards, shadowing and options

#### V9.1 SYSTSIN from a cataloged data set is reported
    Then  control-cards-from-dataset names the step, the DD and the data set

#### V9.2 In-stream SYSTSIN is not control-cards-from-dataset
    Then  that rule does not fire

#### V9.3 A DFSORT MODS statement naming an exit is reported
    Then  sort-exit-named names the exit and its module

#### V9.4 A copybook in two copy directories is shadowed
    Then  copybook-shadowed names both places, and the SBOM names the one each program resolved

#### V9.5 An option card changing TRUNC between base and head is reported
    Then  option-changed names TRUNC, the base value and the head value

#### V9.6 A change that leaves the options alone reports nothing
    Then  option-changed does not fire

### V10 - Change assurance in the build

#### V10.1 An equivalence statement for other sources is refused
    When  --equivalence names a statement whose head subject digest is not the head's
    Then  the build fails with the mismatch named

#### V10.2 An inconclusive statement does not satisfy requireEquivalence always
    Then  the build fails, naming the unreached paragraphs the statement lists

#### V10.3 An equivalent, signed statement satisfies requireEquivalence always
    Then  the build passes on that check

#### V10.4 A change to a copybook alone needs a statement for each program that copies it
    Given requireEquivalence always and a change that edits only a copybook
    Then  the build fails on equivalence, naming the program and the copybook

#### V10.5 A change that deletes a program fails requireEquivalence always
    Then  the program is listed as deleted and the build fails on equivalence

#### V10.6 A commit message holding a record separator still shows its trailers
    Given a commit whose message has the byte 0x1E before a Co-authored-by trailer
    Then  machineAuthored names the commit

#### V10.7 Coverage whose unreached is not a list of names is inconclusive
    Then  the program fails as measuring no coverage

#### V10.8 Every statement naming a program must pass
    Given two statements for one change, one equivalent and one diverged, in either order
    Then  the build fails on equivalence, naming the diverged verdict

#### V10.9 Without allowed signers a required statement does not pass
    Given requireEquivalence always and an equivalent, measured statement, and no --allowed-signers
    Then  the build fails on equivalence, saying nothing shows who wrote the statement

#### V10.10 An allowed-signers file inside the repository is refused
    When  --allowed-signers names a file in the repository being built
    Then  the build exits 2

#### V10.11 A statement whose coverage leaves out an edited paragraph does not pass
    Given a change to the statements of paragraph CALC and a statement whose coverage.changed lists only REPORT
    Then  the build fails on equivalence, naming CALC; listing CALC passes

### V11 - Execution coverage

#### V11.1 A finding in a paragraph the runs entered says so
    Given COBOLWORK_EXECUTION naming an ironwork coverage report of the program
    Then  the finding carries executed with its paragraph and entered above zero

#### V11.2 A finding in a paragraph no run entered says never entered
    Then  executed.entered is 0 and byExecution counts it as never-entered

#### V11.3 A report not written by ironwork is named, and no finding changes
    Given COBOLWORK_EXECUTION naming a file that is not a coverage report
    Then  executionFeedProblems names it and no finding carries executed

## 15. Out of scope, deliberately

- Transporting to an RFC 3161 authority or a transparency log. cobolwork writes requests and reads
  responses; the git push of `anchor --push` is the one transport it makes, and only when asked.
- Keyless (Fulcio, Rekor) verification in-process. `cosign verify-blob` does it and is named.
- Encrypting the evidence directory. Its records hold digests, fingerprints and paths; the reports
  it digests are the pipeline's to protect, as they are today.
- A level claim under SLSA. The statement says what was recorded; the platform that signs it
  earns the level.

## 16. Execution plan

| Step | Work | Needs |
|---|---|---|
| 1 | `lib/evidence/record.mjs`, `lib/evidence/journal.mjs`, `lib/evidence/ledger.mjs`; V1, V2 | - |
| 2 | `lib/evidence/verify.mjs`, `lib/evidence/sshsig.mjs`, `evidence verify`; V3 | 1 |
| 3 | `lib/evidence/seal.mjs`, `evidence seal`, signers; V4 | 2 |
| 4 | Witnesses: git anchor, RFC 3161 DER, cosign delegation; V5 | 3 |
| 5 | Journals wired into scan, flow, diff, build, gate, baseline, sbom | 1 |
| 6 | SLSA statement; V6 | 1 |
| 7 | `cobolwork sbom`; V7 | - |
| 8 | Lanes 13.1-13.4; V8, V9 | - |
| 9 | `--equivalence` and `requireEquivalence`; V10 | ironwork compare |
| 10 | Execution coverage, §13.5; V11 | ironwork run --coverage |
