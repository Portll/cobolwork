# Execution plan

What to do next, in what order, and what each thing unblocks.

[`BACKLOG.md`](../BACKLOG.md) says what is open. This says what to do about it and why in that
order. Where the two disagree, the backlog is the record and this is the opinion.

Written 2026-09-21, after the rule-set contract landed in seventeen commits (`dcba4db`..`9baf642`).
Status of anything below may have moved; the counted claims in the specs are re-derivable by the
script in [`ruleset-contract.md`](spec/ruleset-contract.md) §13.

---

## 0. In flight

**The corpus measurement.** 128 repositories of public COBOL, fetched by
[`diag/fetch-corpus.mjs`](../diag/fetch-corpus.mjs), with the three vendor packs force-loaded:

```sh
node diag/measure-rules.mjs <corpus> --packs broadcom,controlm,connectdirect --out corpus.json
```

This is doing two jobs, and the first matters more than the second.

**It is the acceptance test for the structural work.** Seventeen commits restructured every rule
set, the traversal, the reading, the report shape and the SARIF output. What has verified them so
far is 253 unit tests and 48 synthetic benchmark cases — not one real repository. A regression in
how a rule set reads a tree shows up over 128 real ones or it does not show up at all.

**And it fills `validation.corpus` for three packs that ship unvalidated.** Measuring is how a pack
becomes validated; refusing to measure an unvalidated one would be circular, which is why
`--packs` bypasses the load gate.

**Read it for, in order:** rule sets that threw (`error:<set>:<code>` keys in `byRule`); per-rule
prevalence and repository share; and only then the two pack rules already under suspicion —
`ctm-autoedit-variable-in-command`, which matches any `%%NAME`, and `cd-copy-outbound`, which fires
on every ordinary transfer by design.

---

## 1. Immediately after it, and because of it

| | Work | Why now |
|---|---|---|
| 1.1 | **Act on whatever the corpus says.** A set that threw, a rule whose share jumped, a count that moved against the last run | It is the only evidence that today's refactor did not change behaviour on real source |
| 1.2 | **Fill `validation.corpus` in the three pack files** from the per-pack-rule shares | Three packs cannot load until this exists. It is the gate they were written against |
| 1.3 | **Narrow or demote the two suspect pack rules** if their share says so | A rule firing on a large share of repositories is over-broad whatever its rationale claims |

1.2 and 1.3 are the same reading of the same output and should be one sitting.

---

## 2. Cheap, unblocked, worth doing next

| | Work | Effort | Unblocks |
|---|---|---|---|
| 2.1 | **Programs that cannot compile** — a rule over the parser's existing unresolved references, plus a threshold separating a missing copybook (coverage) from an invented field (defect) | Small–medium | Nothing, but it is the signature of agent-written "modernisation" code nobody compiled, which is the case this tool is most often bought for |
| 2.2 | **A non-production job touching a production prefix** — `lib/site.mjs` supplies the facts and `classifyPath` the decision; the rule is what is missing | Small | Completes the recon set's stated purpose |
| 2.3 | **Advisories for the unsearched products** — OpenText beyond two, CICS TS beyond one, Db2 for z/OS | Small, mostly research | `advisoryCoverage` stops naming them as unsearched |

2.1 is the highest-value single rule left. 2.2 is the smallest. Neither depends on the other.

---

## 3. Decisions, not queued work

These should not be started on momentum. Each deserves a deliberate yes.

### 3.1 Should `parser.mjs` read through the source-tree port?

**Blocks:** a git-ref adapter, which would let `diff` read revisions without materialising them to
temporary directories; a PDS-export adapter; and parsing against an in-memory tree.

**The problem:** `parseSource` reads copybooks from disk *while parsing* (`parser.mjs:578`,
`:1283`) and resolves them with `statSync` (`:520`). Making it read through the port is a
substantial change to the one file that is graded against GnuCOBOL and backed by golden fixtures.

**The specification promised this and was wrong to.** §3 said the port lets `diff` read git blobs;
§10 said `parser.mjs` is out of scope. Both cannot hold.

**Decided: yes, and done (roadmap 3.1, 2026-09-30).** The parser reads copybook text through
`ctx.readText`, which defaults to the disk read it always did. `gitTree` holds a revision in memory
and `diff` reads both sides through it. `build` and `gate` still write revisions to disk, because
the compiler and ironwork read files.

The evidence it was taken on:

- **Same answers.** Over 150 corpus repositories, each given one commit that widens a copybook's
  first `PIC X(n)`, `diff` read out of git reported what it reported from revisions on disk in 37 of
  37 that had such a copybook. Three repositories over 48 MB were left out; 110 had no copybook to
  widen. Parsed program by program over 400 repositories, 7,390 of 7,398 programs with an extension
  came out identical. The 8 that differ have names that differ only in case, which macOS's filesystem
  merges into one file on disk; the git tree keeps both. Run again after the fix below, with
  extensionless programs counted, 7,576 of 7,584 came out identical, and the same 8 differ.
- **One defect found by it.** Files with no extension, which is how PDS members arrive, were
  classified by opening them on disk, so a git tree lost them. They are now classified from the
  tree's own bytes.
- **Cost.** On OCamlPro_gnucobol-contrib (3,223 files, 152 MB, 1,275 programs compared), diff took
  23.0 s and 24.9 s read from git against 30.3 s and 26.7 s written to disk. Peak memory was
  846–935 MB against 561–739 MB, because both revisions are held. Nothing is written to disk.
- **A failure it removes.** The old materialiser read blobs in batches of 500 into a 256 MB
  buffer, so a repository with large programs failed at `git cat-file`. Batches are now sized by
  bytes.

The graded parser's golden fixtures and the full suite pass unchanged.

### 3.2 Should the five languages be built?

[`language-coverage.md`](spec/language-coverage.md): BMS, IMS DBD/PSB, DB2 DDL, HLASM, PL/I.
9 rule sets to 14. **112–160 hours, against roughly 14 for the engine as it stands** — eight to
eleven times the existing tool.

Its Phase 0 gate was the rule-set contract, which is now passed. Its three extractions are not
built, and are the honest first cost:

| Extract | From | Callers | Why it cannot wait |
|---|---|---|---|
| `lib/cards.mjs` | `lib/jcl.mjs` | JCL, HLASM, BMS, IMS DBD, IMS PSB | Five callers, one implementation — or five drifting copies |
| `lib/layout.mjs` | `lib/parser.mjs` | COBOL, PL/I, BMS symbolic maps, IMS segments | **The one that matters.** It is the graded part of the parser; a second implementation would be a second thing to grade against nothing |
| `lib/embedded-sql.mjs` | `lib/dataflow.mjs` | COBOL, PL/I | PL/I embeds `EXEC SQL` identically |

**If yes:** do the three extractions first, then BMS (highest value per hour, and it improves an
existing rule set rather than adding an isolated one), then measure and decide again before IMS.
Ship after each phase.

**Settled while it was written:** z390 ships neither IBM's `DFH` nor its IMS macro libraries, so BMS
and IMS have **no external oracle** and fall back to round-trip and `BYTES=` self-consistency.
HLASM keeps z390 and is the only one of the five that does. That raises the fixture cost of phases
1 and 2 and should be part of the decision.

### 3.3 The CI budget

Every job ends in seconds with *"the job was not started because an Actions budget is preventing
further use"*. **None of the seventeen structural commits has been through CI.** Everything is
verified locally, on one machine.

This is an account decision, not an engineering one. Worth knowing: the memory-flake fix was aimed
at exactly the constrained runner that is not currently running, so the fix is unproven where it
matters most.

---

## 4. Blocked on something else

| | Work | Blocked on |
|---|---|---|
| 4.1 | Attributing a dataset flow to the program that moved it | The utility knowledge base (4.2) — they are the same missing table |
| 4.2 | Utility knowledge base: `feed/worklists/utility.json` holds 34 targets, no rows generated, `feed/generate.mjs` never run against a real model | Running the generator |
| 4.3 | The recon production-name rule's false-positive rate | A real estate. A public corpus has no site file, so only the address rule can fire, and no public measurement will substitute |
| 4.4 | PCI DSS and COBIT mappings | A question to the PCI Council about non-commercial permitted use; ISACA's terms unverified |

4.3 is worth stating plainly in any precision claim rather than waiting for: the number cannot be
obtained from public source, and saying so is more honest than an unqualified figure.

---

## 5. Integration, when the above settles

- `cobolwork diff` reviews a change rather than a snapshot, so it belongs where pull requests are
  reviewed.
- Three mainframe credential rules are offered to Betterleaks in a pull request awaiting review
  (betterleaks/betterleaks#379, issue #378).

---

## What to do

Superseded on 2026-09-24 by the order in [`handoff.md`](handoff.md#what-to-do-next), which was
written after the vulnerability work landed and its rules were measured. In short: push and decide
the CI budget; build the labelling tools and label; write the numeric-input rule; add entry points
from the CSD; then a BMS reader, which is now the first language with a rule waiting for it. The
decision this file recorded as open - whether `parser.mjs` may change - was taken: it gained
additive fields, re-grading against GnuCOBOL is still owed, and the languages are still undecided.

And say, in anything that reports this work, that it has not been through CI.
