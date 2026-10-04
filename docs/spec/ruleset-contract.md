# The rule-set contract

A specification for making "rule set" an explicit thing the code enforces, rather than a naming
convention the code hopes for.

Status: proposed, 2026-09-20 (revision 3 — re-lensed through ports and adapters, then reconciled
with the language-coverage plan).
Measured against the working tree at that date: 9 rule sets, 79 rules, 206 tests — passing under
`npm test` on one machine with 502 MB free, and failing 17 on another with 330 MB free, at the same
commit. That is a defect in the tests rather than in the tool; §13 records why and what fixes it.

**Depended on by:** [`language-coverage.md`](language-coverage.md), which specifies five more
languages — BMS, IMS, DB2 DDL, HLASM and PL/I — and names this document its Phase 0 gate. Its
judgement is blunt and correct: *"land the rule-set contract before the language work, or land the
language work as adapters on it. Building five more pre-contract rule sets means rewriting five
instead of zero."* See §14 for what that adds to this specification's scope.

---

## What has landed

| Group | Status | Evidence |
|---|---|---|
| **F1 canonical findings** | **LANDED** | `lib/findings.mjs`. 12 comparator copies → 1, 13 sort sites → 3, 4 of 9 bare summaries → 0. `ERULEID` refuses an undeclared rule id. `test/findings.test.mjs` |
| **F2 guarded traversal** | **LANDED** | All 9 sets walk inside `eachWithinMemory`. Dead imports 3 → 0, enforced by `test/rails.test.mjs` |
| **F0 source-tree port** | **PARTLY LANDED** | `lib/source-tree.mjs`. Ten tree walks per scan → one. All nine sets take a tree and read through it. `GitRefTree` is **blocked** — see below |
| **F3 rule-set contract** | **LANDED, reduced** | `lib/kernel/ruleset.mjs` owns the closing assembly: 8 plumbing blocks and 9 return shapes → 0. `test/ruleset-conformance.test.mjs` asserts I1–I5 over the registry. The `perFile`/`finish` inversion and `ETREELEAK` were **not built** — see below |
| **F4 registry** | **LANDED** | `lib/registry.mjs`. Adding a rule set: **9 edits across 4 files → 2 lines in 1**. `SET_NAME` and the hand-enumerated `bySet` key list are deleted; `ESETNAME` survives as `reportKey`. `test/registry.test.mjs` |
| **F5 coverage + SARIF** | **LANDED** | `bySet` carries `filesNotRead`/`stoppedBy`/`notRead`; `setsIncomplete` keyed off both flags. SARIF gains `tool.extensions[]` per rule set and `toolExecutionNotifications`. `schema/cobolwork-coverage.schema.json` published. `test/sarif.test.mjs` |
| **F6 directory move** | **LANDED** | `lib/kernel/` (the rails) and `lib/sets/` (the slices). Flat `lib/` went 22 files to 17 + 2 directories. Pure move; the import rewrite is the only edit |

The three sort sites that remain are deliberate: `findings.mjs` defines the canonical one, and
`dataflow.mjs` and `diff.mjs` order findings that are located by source-and-sink and by program
rather than by path and line. Both use the shared text comparison underneath.

### What F0 delivered, and the one thing it cannot

Landed, at strict parity with the containment tests as the gate rather than the regression net:

- `lib/source-tree.mjs` with `directoryTree`, `memoryTree` and `validateTree`.
- **Ten tree walks per scan became one.** Every rule set called `buildFileIndex(root)` for itself,
  so a scan resolved every symlink and read every directory entry nine times over, and added a
  tenth walk each time a set was added. A scan of `bench/cases` went 321 ms to ~240 ms; the saving
  scales with the tree, not with the finding count.
- All nine sets take a tree and read through it. No rule set calls `readFileSync` or `readSource`
  directly any more.
- The five copies of the `parseSource` options literal became one, which **retires the
  `systemDirs` question** revision 2 left open. `lib/diff.mjs` passed `systemDirs: []` where every
  other caller passed the caller's, so `diff` could not resolve a system copybook that `scan`
  could — a layout change inside one was invisible to the command whose whole job is what a change
  reaches. Both sides now take the same configuration. For a caller passing no `systemDirs`, which
  is every caller today, it is exactly the old behaviour.
- All six containment tests pass **unweakened**. `DirectoryTree` does not reimplement containment;
  it delegates to the same `buildFileIndex`, so the guarantee is the one the tests already pinned.

**`gitTree` is built (2026-09-30, cobolwork-roadmap 3.1).** It needed `parser.mjs` to read through
the port, which this specification had said the parser would not do: `parseSource` read copybooks
from disk while parsing. The change is one reader in the parse context, `readText`, used by the
three places that read a copybook's text. A parse over a directory passes none and reads from disk
exactly as before. A held tree, a git revision or a memory tree, passes its own. Copybook resolution
inside a tree already went through the tree's index, and only a declared library outside the tree
(the system copybooks, COBCPY) is looked for on disk, as the containment rules allow.

`memoryTree` parses the same way. It no longer refuses with `ETREEPARSE`.

The evidence the change was taken on is in `diag/git-tree-equivalence.mjs`: every program in a
sample of the 3185-repository corpus, parsed out of git and from the same revision written to disk,
and `diff` read both ways. The results are recorded in `docs/execution-plan.md` §3.1.

`diff` reads revisions with `gitTree` and writes nothing. `build` and `gate` still write them out:
they hand the tree to a compiler, `cobc` or ironwork, which reads files.

**`pdsExportTree` is built (2026-09-30, cobolwork-roadmap 3.2), and `scan --pds-export` uses it.**
It reads what exists: no repository in the 3,185-repository corpus or the random and active samples
holds an XMIT or IEBCOPY unload file, while 89 hold extensionless members, many in a directory
named for the data set (`COBOL.TESTE`, `HERC01.DLONG.COBLIB`). The goldens route downloads through
Zowe, and `zowe zos-files download all-members` writes `ibmuser/new/cntl/member.txt`, lower-cased,
which a directory scan reads as nothing at all. The adapter takes both layouts, and text, `--binary`
and `--record` downloads. Each member is held as `DATA.SET/MEMBER` under a root beside the export
that does not exist, so a finding names the member as z/OS does. Members are read from disk when
asked for, with no link followed at read time. A file whose path is not a data set and member name,
or that names a member already held, is counted in `summary.pdsExport` and not read.

An XMIT file (TSO TRANSMIT) or an IEBCOPY unload in the export is read into its data set, whatever
the file is called: the transmission's INMR02 names the data set, and an unload alone is named by its
file without the last extension. A partitioned data set's members are held under that name, each
placed by its directory entry's TTR, which a member block's MBBCCHHR gives through COPYR2's extents
and COPYR1's tracks per cylinder; an alias is counted, not held twice. A sequential data set is one
file named by the data set. An unload with a BDW and SDW, with an RDW, or with neither is read. A
PDSE unload, one IEBCOPY marked in error, a transmission of more than one file or one cut short is
counted in `summary.pdsExport.archives` with the reason, and not read. The layouts are IBM's (z/OS
TSO/E Customization, "Format of transmitted data"; DFSMSdfp Utilities, "Unload partitioned data set
format"), and the test fixtures are built from them byte by byte, since no corpus holds one.

`diff --pds-export` reads each side as a PDS export: a revision through `pdsExportRevision`, the same
naming over the revision's blobs in memory, and the working tree through `pdsExportTree`, limited to
the members whose files git tracks or would track. A finding names the member on both sides, so a
copybook changed in one data set is a layout change in the programs of another that copy it.
`summary.pdsExport` holds each side's counts.

One near-miss worth recording. Routing reads through the tree broke `programIds()` in the JCL set —
a module-level helper with no tree in scope — and its `catch { continue }` **swallowed the
ReferenceError**, so the set silently returned an empty program list and four tests failed with no
error text. That is blind spot 7 from the Breakers audit (thirteen catch sites that discard the
error entirely) biting the person who wrote it down.

**The compound finding the Breakers audit called severity laundering is closed.** A
`jcl-instream-credential` finding — crit, CWE-798, a password in job data — used to export to SARIF
as `warning` whenever anything but `scanAll` produced it, because severity was imputed during the
merge and `toSarif` maps an absent severity to `warning`. Severity now belongs to the rule table
that declares the rule, and the finding exports as `error`.

Two defects were found by the new tests rather than by reading:

- `rules-vendor.mjs` had a **second return site** — the early return when no pack is loaded — that
  bypassed the shared stamping and returned a different summary shape. Caught by the conformance
  assertion in `test/findings.test.mjs`.
- The rails test's first version checked whether an import was *called* and produced nine false
  positives, every one a predicate passed to `filter`. It checks use, not invocation.

---

## 0. What the revisions changed

### Revision 3 — reconciled with the language plan

[`language-coverage.md`](language-coverage.md) landed naming this document its Phase 0 gate. It
adds three extractions to this scope (`lib/cards.mjs`, `lib/layout.mjs`, `lib/embedded-sql.mjs`),
one invariant (I9, one implementation per concept), and turns the duplication argument from a
present-tense count into a forward projection: roughly twenty helpers, written five more times
each, if the languages land before the contract. §14 reconciles the two.

It also confirms that F0's containment work is load-bearing for five languages rather than one
refactor — which raises the stakes on F0's stop condition rather than lowering them.

### Revision 2 — ports and adapters

Revision 1 treated the shared machinery as *boilerplate to extract*. Under a ports-and-adapters
lens it is something more specific: **the rule sets do their own I/O**, and every duplicated helper
is a symptom of that. The correction changes three conclusions:

1. **`diff.mjs` is no longer excluded.** Revision 1 called it "a different bounded context." It is
   not. It is a *driving use case* that instantiates two source-tree adapters over the same domain
   core. Admitting it removes the temp-directory machinery entirely and dissolves the
   `systemDirs: []` divergence rather than leaving it as an open question.
2. **The unit of extraction is a port, not a helper module.** `lib/findings.mjs` would have been
   twelve call sites sharing a comparator. `SourceTree` is a seam that makes nine rule sets
   testable without a filesystem — and, less comfortably, it is the one seam where a mistake is a
   vulnerability rather than a regression (§3).
3. **The contract's vocabulary should be SARIF's, not one we invent.** See §7.

What revision 1 got right and revision 2 keeps: the invariants (§4), the two-phase requirement
(§5), and the observation that `lib/memory.mjs` is the precedent for all of it.

### One thing the generic pitch oversells, honestly

The usual argument for hexagonal architecture is "your execution loop gets fast because you stop
booting frameworks and databases." **cobolwork has no framework and no database.** It has zero
runtime dependencies by design. The test suite already runs 206 tests in under 5 seconds, and the
slowest tests are process spawns and `git` invocations — genuine adapter tests you would keep under
any architecture. (Fast, but not yet *reliable* — see §13 on the machine-dependent failures. That
is a separate defect, and fixing it is not what this specification is for.)

So the speed argument is weak here. The argument that *does* hold is **reach**: a `SourceTree` port
lets `diff` read git blobs without materialising them, lets a PDS export be an adapter instead of a
special case in `sources.mjs`, and lets a rule set be tested against a tree that never existed on
disk. Adopt the pattern for reach and testability. Do not adopt it expecting a speed win that is
already banked.

---

## 1. Why this exists

`lib/memory.mjs` already argues the case, in its own words:

> The loop every rule set uses instead of `for (const f of files)`. […] Written here so every rule
> set says it the same way.

That module is the precedent: one cross-cutting concern, one home, one vocabulary, one report
sentence. This specification does the same for the concerns that every rule set still solves
privately.

**Measured on the working tree, 2026-09-20.** The tree moved three times during drafting — the
`opaque` rule set and content-sniffing in `sources.mjs` both landed mid-specification — so these
are a snapshot, and the reconciliation script in §13 re-derives them rather than trusting this
table.

| Symptom | Count |
|---|---|
| Copies of the `byText` comparator | 12 |
| `findings.sort` sites, in 5 different variants | 13 |
| `try { … } catch { filesUnreadable++ }` sites | 15 |
| Rule sets returning a summary with no `byRule`/`findings`/`nosrc` | 4 of 9 (`build`, `jcl`, `recon`, `vendor`) |
| Modules importing `eachWithinMemory` without calling it | 3 |
| Rule sets returning `sev: undefined` when called outside `scanAll` | 3 (verified by execution) |
| Filesystem call sites inside `lib/` | 33, across 10 modules |
| Registration edits to add one rule set | **9, across 4 files** |

Note that `vendor` has two bare-`stats` return sites, not one — an early return when no pack
loaded, plus the final return. Counting return statements gives five; counting rule sets gives
four. The invariant in §4 is about sets.

The last row was confirmed in real time: the `opaque` rule set landed during this specification's
drafting and took nine edits — five in `lib/scan.mjs` (import, `ALL_RULES`, `RULE_SETS`, an
`if (only.includes())` branch, `SET_NAME`), two in `feed/catalogue.mjs`, one in the CLI usage
string, and one in `test/cli.test.mjs`, which asserts the exact key set of `summary.bySet`.

### Severity is not a property of a rule set today

The mechanism behind the `sev: undefined` row is worth stating exactly, because it is the clearest
single argument for the contract. `lib/scan.mjs:103` imputes severity while merging:

```js
findings.push({ ...f,
  cwe: f.cwe || (ALL_RULES[f.rule] || {}).cwe || null,
  sev: f.sev || (ALL_RULES[f.rule] || {}).sev || 'med' });
```

Severity therefore belongs to `scanAll`, not to the rule that declares it. Three consequences: a
set called directly returns findings with no severity at all; a finding naming a rule id absent
from every table silently becomes `med`; and a rule shipped with no declared severity becomes
`med` without anyone being told.

---

## 2. Ubiquitous language

| Term | Meaning |
|---|---|
| **Estate** | A customer's installation. What `cobolwork.site.json` describes. Facts no parser can derive. |
| **Source tree** | A set of source artifacts addressable by path. A directory, a git revision, a PDS export, or a fixture in memory. **Not necessarily a directory.** |
| **Source artifact** | One file: a *program*, a *copybook*, a *job*, or a *build file*. |
| **Rule** | An identifier, a severity, a CWE, and a sentence. Defined in exactly one rule table. |
| **Rule set** | A cohesive family of rules sharing one reading of a source tree. |
| **Finding** | A located claim that a rule is answered by a place in a tree. |
| **Coverage** | What a scan read, and — load-bearing — what it did not. |
| **Report** | Findings, coverage, and rule metadata, for one tree or several. |

### Ambiguity to retire

`filesScanned` means three different things. In `hidden` it counts every source artifact read; in
`copybook` it counts copybooks *and* programs, so one file can increment it twice; in `cics` it
counts only files surviving a CICS pre-filter. `scan.mjs` then takes `Math.max(...)` across these
incommensurable counters and publishes the result as the number of files scanned.

Split the word:

- **`filesConsidered`** — artifacts the set's file filter selected.
- **`filesRead`** — artifacts whose bytes were actually read.
- **`filesNotRead`** — artifacts selected but never opened, because the set stopped early.

`filesConsidered = filesRead + filesNotRead + filesUnreadable` is an invariant, not a hope.

---

## 3. Ports and adapters

```
        DRIVING (primary)                                    DRIVEN (secondary)

   bin/cobolwork.mjs  ─┐                              ┌─  DirectoryTree   (node:fs)
   lib/index.mjs      ─┤                              ├─  GitRefTree      (git cat-file)
   diff use case      ─┼──>  ┌──────────────────┐  ───┤   PdsExportTree
   commitwork lane    ─┘     │   Application    │     └─  InMemoryTree    (tests)
                             │  ┌────────────┐  │              SourceTree port
                             │  │  Analysis  │  │
                             │  │   (rules,  │  │     ┌─  SiteFileConfig
                             │  │  findings, │  │  ───┤   PackConfig
                             │  │  severity) │  │     └─  InMemoryConfig  (tests)
                             │  └────────────┘  │              EstateConfig port
                             └──────────────────┘
                                                      ┌─  JsonReport
                                                   ───┤   SarifReport
                                                      └─  StderrCoverage
                                                               ReportSink port
```

### The three driven ports

**`SourceTree`** — the one that matters. Four methods:

```js
{
  list(),                  // -> artifact paths, POSIX-shaped, sorted
  bytes(path),             // -> Buffer
  text(path),              // -> { text, encoding }  (EBCDIC decoded once, here)
  contains(path),          // -> boolean. Containment, made explicit. See below.
}
```

The fourth is the one to read carefully. Today containment is an emergent property of `node:fs`
and `realpathSync`; behind a port it has to become a decision the adapter makes and states.

Today 9 rule sets reach `buildFileIndex(root)` and `readSource(f)` directly. Four adapters fall out
of the port for free:

| Adapter | Replaces | Win |
|---|---|---|
| `DirectoryTree` | today's behaviour | none — parity |
| `GitRefTree` | `mkdtempSync` + `git archive` + `rmSync` in `diff.mjs` | **no temp dirs, no cleanup, no export-ignore workaround** |
| `PdsExportTree` | the extension-sniffing cache now in `sources.mjs` | sniffing becomes an adapter concern, not a global |
| `InMemoryTree` | on-disk test fixtures | a rule set testable against a tree that never existed |

**`EstateConfig`** — `site.mjs`, `packs.mjs`, `advisories.mjs`, `kev.mjs`. Medium value: makes
`recon`, `vendor` and `build` testable without planting JSON on disk. Note these read *fixed
configuration files*, not the tree, so they are a genuinely separate port.

**`ReportSink`** — already close. `sarif.mjs` is a clean adapter; `emit()` in the CLI is the JSON
one; `warnCoverage` is the stderr one.

### Why `diff` belongs inside, not outside

`lib/diff.mjs` read each revision by writing it to a temporary directory, only because the rule
sets demanded a real path. The domain does not need a directory; it needs artifacts. `gitTree`
(`lib/kernel/source-tree.mjs`) now reads the revision into memory with `git ls-tree` and
`git cat-file --batch`, which `lib/kernel/git.mjs` shares with the writer `build` and `gate` still use.

**It does not use `git archive`, and that is deliberate.** The comment at `lib/diff.mjs:26`
records the reason: `git archive` applies `export-ignore` and `export-subst`, so a file marked
`export-ignore` would vanish from the base and read as *added*. `read-tree` into a private index
followed by `checkout-index` touches neither the repository's index nor its working tree, and
preserves the commit exactly. `test/sources.test.mjs:144` pins it — *"diff reads the committed
tree, not an export."*

Any adapter replacing this must preserve that property. `git cat-file` does, because reading blobs
bypasses archive's filtering the same way `read-tree` does — but **the reason must travel with the
change**, or the next person reaches for `archive` because it looks like the obvious tool. It is a
trap, and the codebase already paid to learn that.

Two consequences a naive port would get wrong:

- **Line endings flip direction.** `checkout-index` applies smudge filters and `autocrlf`, so on
  Windows the materialised base arrives as CRLF. `cat-file blob` returns bytes as stored — always
  LF, no filters. That is more deterministic and arguably better, but it moves which side of the
  comparison needs normalising. `diff.mjs:53` (`norm`/`sameSource`) and
  `test/review.test.mjs:114` encode the current assumption, and the bug they guard against once
  silently killed *diff-layout-changed-unedited-program*. **Re-derive it; do not assume it carries.**
- **Spawn count.** `checkout-index` is one spawn for the whole tree — constant in file count.
  Per-file `cat-file` is N spawns. The adapter must use `git cat-file --batch`, or it trades a
  constant cost for a linear one.

It also dissolves an open question from revision 1. `diff.mjs:70` passes `systemDirs: []` where
every other parse site passes `opts.systemDirs || []`, so `diff` cannot resolve system copybooks
that `scan` resolves. Revision 1 left this as a maintainer decision. Under one parse configuration
behind one port, the divergence has nowhere to live. **It still changes `diff` output, so it stays
a decision — but it becomes a deliberate one rather than a copy-paste artefact.**

### Containment is the port's hardest requirement

**This is the one abstraction boundary in the codebase where an ordinary refactoring bug is a
vulnerability rather than a regression.**

Containment — the guarantee that cobolwork never reads outside the tree it was pointed at — is
currently a *filesystem* fact, enforced by the operating system through resolved paths:

| Site | Mechanism |
|---|---|
| `lib/parser.mjs:322` | `top = realpathSync(root)` — the containment anchor |
| `lib/parser.mjs:345` | `if (!inside(target))` on a `realpathSync`'d symlink target; escaping links counted and refused |
| `lib/parser.mjs:448` | `p === top \|\| p.startsWith(top + sep) ? null : 'refused-outside'` — the COPY refusal |

A `SourceTree` port takes the OS out of that loop. Whatever implements the port must reimplement
symlink resolution and prefix containment itself — and an in-memory or git-blob adapter has no
`realpathSync` to lean on.

`SECURITY.md:22` names this first among in-scope vulnerability classes:

> **Reading outside the tree.** A `COPY` that resolves outside the scanned directory, a symlink
> that escapes it, a path in a report that points somewhere it should not. Reaching outside the
> tree is refused and reported by design; a way around that refusal is a vulnerability.

This is not an argument against the port. It is an argument that **the existing containment tests
are F0's acceptance criteria, not an afterthought.** The port is faithful only if all six stay
green:

| Test | Property |
|---|---|
| `test/sources.test.mjs:44` | symlinks followed inside, refused outside, a loop walked once |
| `test/sources.test.mjs:63` | COPY refused outside the tree, with `COBCPY` as a declared exception |
| `test/sources.test.mjs:88` | a relative COPY climbing to a sibling directory *inside* the tree |
| `test/sources.test.mjs:101` | the 150th include directory resolves |
| `test/sources.test.mjs:144` | diff reads the committed tree, not an export |
| `test/review.test.mjs:114` | copybook edit attributed correctly when checked out as CRLF |

Accordingly the port carries a seventh method, and containment becomes an explicit contract rather
than an emergent property of `node:fs`:

```js
{
  list(), bytes(path), text(path),
  contains(path),        // -> boolean. The adapter's own containment decision.
}
```

`DirectoryTree.contains` keeps today's `realpathSync` behaviour exactly. `InMemoryTree.contains`
is key membership. `GitRefTree.contains` is "this path is in the tree object" — which is
containment by construction, since a git tree cannot name a path outside itself.

### A report that overstates coverage is also a security bug

`SECURITY.md:30` puts the coverage promise in the same list:

> **A report that overstates coverage.** A file that cobolwork fails to read while still reporting
> `coverageIncomplete: false`. Silence that reads as a clean result is the failure this tool exists
> to prevent, so it is treated as a security bug rather than a defect.

This raises the stakes on §7's SARIF mapping and on I4. `coverageIncomplete` is not a nicety to be
mapped wherever the standard happens to have room — **under this project's own threat model,
degrading it is a security regression.**

### Which threat class the unguarded sets fall under

It is tempting to file the three unguarded sets (I7) here, under overstatement. **That is wrong,
and the distinction changes both the severity and the fix.**

`build`, `recon` and `vendor` already account for every failed read —
`lib/rules-build.mjs:91`, `lib/rules-recon.mjs:109`, and `lib/rules-vendor.mjs:45` and `:47` each
catch and increment `filesUnreadable`. That accounting reaches the verdict: `lib/scan.mjs:101`
derives `unreadInSomeSet` from `filesUnreadable > 0`, and `:138` ORs it into `coverageIncomplete`.
An unreadable file in any of the three does set the flag. **Nothing silently reads as clean.**

What they lack is the memory budget, and the failure mode of not having one is the *opposite* of
silence. `eachWithinMemory` stops and records `skipped`, `stoppedBy` and a `note`; a set that does
not use it simply keeps going. Under memory pressure these three cannot under-report coverage —
they never skip — they exhaust the heap and take the process down.

That is `SECURITY.md`'s **third** class, *"Resource exhaustion from a crafted source file"*, not
its fourth. An OOM is loud; a false clean is silent. They warrant different severities and
different fixes, and calling these three an overstatement risk implies the fix is accounting when
the fix is wrapping their file loops in the helper that already exists.

**The conditional constraint, which F3 and F4 must carry:**

> Any rule set that gains the ability to skip files must surface `skipped` / `setIncomplete`, or it
> converts an exhaustion risk into an overstatement one.

This is a live trap rather than a hypothetical. A contract that standardises iteration is exactly
where skipping gets introduced, and a set that skips without reporting moves from SECURITY.md's
third class to its fourth — from loud to silent — while looking tidier than it did before.

### The unused imports are themselves the evidence

Three modules import `eachWithinMemory` and never call it. Someone intended to guard all three and
stopped halfway, **and nothing failed, because an unused import is invisible.** That is the whole
argument for §13's runnable claims in miniature: an import-without-call check over the rule sets is
a handful of lines and would have caught it the day it happened.

### Module-level state is a port violation

Three modules hold mutable state outside any port:

| Module | State | Consequence |
|---|---|---|
| `sources.mjs` | `const sniffed = new Map()` | Unbounded, never evicted, never reset. Keyed by absolute path, so it grows by one entry per extensionless file **for the life of the process** |
| `compliance.mjs` | `const byRule = new Map()` | Load-once cache; benign |
| `memory.mjs` | `let override` | Deliberate test seam, with `setAvailableMemory(null)` to reset |

The `sniffed` cache deserves attention. It exists for a good reason — a PDS export has no file
extensions, and reading by extension alone would open none of it. But an estate exported from a PDS
is *entirely* extensionless, so on the 100,000-program repository the module holds 100,000 map
entries **that `eachWithinMemory` does not account for**. The memory guard measures the heap; this
cache grows inside it, unmeasured and unbounded. `sniffedCount()` is likewise a process-global
monotonic counter: under `--repos` it would report the cumulative total across every repository
rather than the one being reported on.

Under the port, sniffing belongs to the adapter that needs it, with a lifetime bounded by the scan.

**Done (cobolwork-roadmap 3.2).** Each tree classifies its own paths and keeps the answers for as
long as it lives: a directory tree sniffs from disk once per path, a held tree from the bytes it
holds, and a PDS export by what each member holds, whatever extension the download gave it.
`sources.mjs` keeps only a map from each live tree's root to its classifier, held weakly, so an
entry goes with its tree. A path under no live tree is sniffed from disk and not remembered.
`sniffed`, `sniffedCount` and `holdSources` are gone. Over 115 corpus repositories, 75 of them
with extensionless members, a directory scan found the same 3,190 findings in the same 6,675 files
as before.

---

## 4. Invariants

A conforming rule set satisfies all of these. Each is testable; each is violated today.

| # | Invariant | Violated by |
|---|---|---|
| **I1** | Every finding carries `rule`, `path`, `line`, `detail`, `sev`, `cwe`, derived from the set's own rule table. | `jcl`, `build`, `recon` — `sev: undefined` standalone (verified) |
| **I2** | Every finding's `rule` id exists in the set's rule table. | Unenforced. A typo yields `sev: 'med', cwe: null` silently |
| **I3** | Every summary carries `findings`, `byRule`, `filesConsidered`, `filesRead`, `filesUnreadable`, `nosrc`, `coverageIncomplete`. | 4 of 9 sets return bare `stats` |
| **I4** | A set that stopped early sets `coverageIncomplete` **and** names the reason in a form the report prints. | `cics` sets the flag; `scan.mjs`'s `bySet` projection drops `notRead`/`stoppedBy` |
| **I5** | Findings sort by one canonical order: rule, path, line. | 12 sites, 5 variants; `vendor` omits rule from the key |
| **I6** | Every set has a report key. | **Already enforced** — `scan.mjs` throws `ESETNAME` |
| **I7** | Every set traverses through a guarded loop bounding heap growth. | 3 sets import `eachWithinMemory` without calling it; 4 more never import it |
| **I8** | A rule set reaches source only through its `SourceTree` port. | All 9 — they call `buildFileIndex(root)` directly |
| **I9** | One implementation per concept. Before writing a helper, grep `lib/` for it. | 12 comparators, 13 sort sites, 15 unreadable-catches. From [`language-coverage.md`](language-coverage.md) §8.8 |

I6 is proof the approach works: one invariant was made explicit, and it now fails a test instead of
shipping `undefined` report keys. Everything here generalises that single move.

---

## 5. The contract

```js
defineRuleSet({
  name:  'cics',
  rules: CICS_RULES,                    // the one table; the source of sev and cwe
  selects: isProgram,                   // which artifacts this set considers
  needs:  { estate: false },            // whether it requires EstateConfig

  perFile(artifact, ctx) { … },         // -> a summary. Never a parse tree.
  finish(summaries, ctx) { … },         // -> findings. Optional.
});
```

`ctx` supplies `tree` (the port), `parse(artifact)` (one canonical options object), `estate`,
`relPath` and `note(reason)`. **`ctx` never supplies a root path**, which is what makes I8
enforceable rather than aspirational.

### The two-phase requirement is not optional

A single `perFile → findings` callback would be simpler and would be wrong. `rules-cics.mjs`
records why:

> Holding every tree until the end is what the flow engine was refactored away from, and this set
> kept doing it: on a 100,000-program repository it exhausted an 8 GB heap and took a corpus run
> with it.

`cics`, `copybook` and `flow` are genuinely two-pass: take a small summary while the parse tree is
in hand, release the tree, then cross-reference. The contract must make the cheap path the default.
`perFile` returns a *summary*; `finish` sees only summaries. A set returning a parse tree from
`perFile` would reintroduce the OOM, so **the contract refuses it** — rejecting any value carrying
the parser's tree signature (`items`, `execs` and `refs` together).

Single-pass sets — `hidden`, `recon`, `vendor`, `build`, `jcl`, `opaque` — implement `perFile` only.

### Division of labour

**The harness owns:** listing, filtering, sorting, guarded traversal, reading with unreadable
counting, parsing with canonical options, canonical finding sort, severity and CWE derivation,
`byRule` tally, `nosrc`, `coverageIncomplete`, and the uniform return shape.

**The rule author owns:** the COBOL, JCL and CICS knowledge. Nothing else.

---

## 6. Vertical slices

Each rule set already *is* a vertical slice: `lib/rules-cics.mjs` holds its rule table, its analysis
and its findings shaping in one file. That is the right shape and it stays. What changes is that the
slice stops re-implementing the horizontal rail beneath it.

```
lib/
  ports/          SourceTree, EstateConfig, ReportSink       — interfaces
  adapters/       directory-tree, git-ref-tree, in-memory-tree
  kernel/         ruleset.mjs, findings.mjs, memory.mjs      — the rail
  sets/
    cics/         rules.mjs  analyse.mjs  cics.test.mjs      — one slice
    jcl/          rules.mjs  analyse.mjs  jcl.test.mjs
    …
  registry.mjs    the one list
```

A slice's test lives beside it and uses `InMemoryTree`. Adding a rule set means adding one
directory and one registry line — the seven-edit registration disappears.

**This is a directory move and should be its own commit, separate from every behavioural change.**
Moving files and changing behaviour in one commit makes the diff unreviewable.

---

## 7. The output format, and the open standard

The question "should we propose an open standard?" has a specific answer here: **no — adopt the one
already in use, because it already models almost everything this project invented.**

cobolwork emits SARIF 2.1.0 today via `lib/sarif.mjs`, but only as a *translation at the exit*. The
internal shapes were invented separately and then mapped. SARIF's own object model covers them:

| cobolwork concept | SARIF 2.1.0 construct | Status today |
|---|---|---|
| A rule table (`CICS_RULES`) | `toolComponent.rules[]` of `reportingDescriptor` | reinvented; `toSarif` flattens all sets into one list |
| **A rule set** | **`tool.extensions[]` — a `toolComponent`** | **not modelled at all** |
| `sev` (`crit`/`high`/`med`/`low`) | `reportingDescriptor.defaultConfiguration.level` + `rank` | hand-mapped in a `LEVEL` constant |
| `cwe` | `taxonomies[]` / `reportingDescriptorReference` | emitted as a bare property bag |
| Rule set that could not run (`setIncomplete`) | `invocations[].toolConfigurationNotifications` | invented |
| **Files not read (`filesNotRead`, `stoppedBy`)** | **`invocations[].toolExecutionNotifications`** | **invented, and put in a non-standard `properties` bag** |
| `nosrc` | `invocations[].executionSuccessful` | correctly used already |
| Inventory | `runs[].artifacts[]` with `roles` | invented |

The most useful line is the rule-set one. **SARIF already has a first-class notion of a tool with
several components** — `tool.driver` plus `tool.extensions[]`, each with its own rules, its own
`informationUri`, and its own notifications. That is precisely what a cobolwork rule set is. Model
the internal contract on `toolComponent` and `toSarif` stops being a translation and becomes a
projection.

The second most useful line is `toolExecutionNotifications`. `lib/sarif.mjs` currently writes
coverage into `invocations[0].properties`, which no SARIF consumer reads. The standard location for
"the tool could not read these files" is a notification with a `descriptor`, a `level` and a
`message` — which means the sentence `memory.mjs` already composes has a standard home.

### What is genuinely not in SARIF

One thing. SARIF can say *"I failed to read these files"* as notifications, but it has no standard
way to state **coverage as a ratio with a denominator** — "this run read 8,000 of 12,000 artifacts,
and stopped because it hit a memory reserve." cobolwork's `filesConsidered` / `filesRead` /
`filesNotRead` / `stoppedBy` quadruple is a real contribution, and the reason it exists is a real
principle: *a finding count over files nobody opened is not a clean result.*

### The constraint the mapping must not break

`coverageIncomplete` is this project's distinguishing promise. The README's claim is that a finding
count over source nobody read is not a clean result, and that boolean is how the claim is kept.

So the SARIF alignment has a hard constraint: **the headline boolean must stay a first-class field
a consumer cannot miss.** `toolExecutionNotifications` is the right home for the per-file detail —
which file, which reason, which set — but if the boolean degrades into one more entry in a property
bag that consumers skip, the tool has lost precisely the thing that distinguishes it from the
scanners it is measured against. Map the detail into the standard; keep the verdict where nobody
can miss it, in both the JSON report and SARIF's `executionSuccessful`.

The measured recommendation:

1. **Do not invent a standard.** Express the quadruple as a namespaced SARIF property-bag
   convention — `properties["cobolwork/coverage"]` — with a published JSON Schema, alongside
   standards-correct `toolExecutionNotifications` so conforming consumers get the information
   without understanding the extension.
2. **Earn the right to propose it.** A convention with one implementation is not a standard. If a
   second analyser adopts it, take it to the OASIS SARIF Technical Committee as a proposed
   `invocation.coverage` object. That is the correct venue, and the bar is prior use, not a good
   argument.

This ordering matters more than it looks. Publishing a schema costs a day and is honest. Declaring
a standard on one implementation invites exactly the criticism this project makes of everyone
else — claiming coverage it has not earned.

---

## 8. The funnel

| Phase | Layer | Artifact here |
|---|---|---|
| **DDD** | Ubiquitous language, bounded contexts | §2 language, §3 port diagram. Core aggregate: **Rule Set**; domain events: *finding raised*, *coverage shortened* |
| **SDD** | Use cases / vertical slices | `lib/sets/<name>/` — one directory per rule set (§6) |
| **BDD** | Acceptance criteria against ports | §9 Gherkin, written against `InMemoryTree`, never against a directory |
| **TDD** | Unit tests, inner domain | Red-green inside one slice, with a fixture tree built in the test body |
| **Execution** | CI / REPL | Domain tests need no disk. Adapter tests (CLI spawn, git) stay slow and few — **they are the ones worth keeping slow** |

The BDD/TDD split is the load-bearing part: a scenario phrased *"Given a tree containing a program
that reads DFHCOMMAREA"* is a domain statement. Phrased *"Given a directory at `test/fixtures/x`"*
it is an adapter statement wearing domain clothes. The port makes the first one writable.

---

## 9. Specification (BDD)

Features in dependency order. Every `Given a tree …` is an `InMemoryTree` unless it says otherwise.

### F0 — The source-tree port

```gherkin
Feature: A rule set reads artifacts, not directories

  Scenario: A set runs against a tree that was never on disk
    Given an in-memory tree containing one program with an EXEC CICS LINK
    When the rule set "cics" analyses it
    Then it reports a finding
    And no filesystem call was made

  Scenario: The same set runs unchanged against a git revision
    Given a repository at revision "HEAD~1"
    When the rule set "cics" analyses a GitRefTree over that revision
    Then it reports the findings it would report for a checkout of that revision
    And no temporary directory was created

  Scenario: An extensionless member is classified by content
    Given a tree whose artifacts have no file extensions
    When the tree lists its artifacts
    Then a member beginning "//JOB1 JOB" is a job
    And a member containing "PROGRAM-ID." is a program
    And the classification cache does not outlive the tree

  Scenario: Containment survives the abstraction
    Given a tree containing a symlink whose target resolves outside it
    When the tree lists its artifacts
    Then the escaping link is refused and counted, not followed
    And a symlink resolving inside the tree is followed exactly once

  Scenario: A COPY outside the tree is still refused
    Given a program whose COPY resolves above the tree root
    Then the copy's status is "refused-outside"
    And a COBCPY system directory remains a declared exception

  Scenario: The committed tree is read, not an export
    Given a revision containing a file marked export-ignore
    When a GitRefTree reads that revision
    Then the file is present
    And it does not read as added against a later revision
```

The last three are not new tests. They are `test/sources.test.mjs:44`, `:63` and `:144` restated
against the port, and they are F0's gate.

### F1 — Canonical findings

```gherkin
Feature: A finding means the same thing whoever produced it

  Scenario: Severity travels with the finding, not with the caller
    Given the rule set "jcl" analysed directly, not through scanAll
    When it reports a finding for rule "jcl-instream-credential"
    Then the finding's sev is "crit" and its cwe is "CWE-798"

  Scenario: An unknown rule id is refused, not defaulted
    Given a rule set reporting a finding naming a rule absent from its table
    Then it throws with code "ERULEID", naming the set and the id

  Scenario: One sort order across every set
    Given findings from any rule set
    Then they order by rule, then path, then line
    And a finding with no line sorts as line 0, never as NaN
```

### F2 — Guarded traversal

```gherkin
Feature: No rule set can read a tree larger than the heap

  Scenario: Every set traverses through the guard
    Given every module exporting a rule-set analysis
    Then each reaches its artifacts through the guarded loop
    And no module imports the guard without calling it

  Scenario: A set that stops early says so in its own summary
    Given available memory is set below the floor
    When the rule set "build" analyses a tree of 40 jobs
    Then coverageIncomplete is true
    And filesNotRead is greater than zero
    And stoppedBy names the limit that was hit

  Scenario: The counters reconcile
    Then filesConsidered equals filesRead plus filesNotRead plus filesUnreadable

  Scenario: Artifact classification is bounded by the scan
    Given a tree of 10,000 extensionless artifacts
    When the scan completes
    Then no classification cache outlives it
```

### F3 — The rule-set contract

```gherkin
Feature: A rule set is a declared thing with enforced invariants

  Scenario: Every set returns the same summary shape
    Then its summary carries findings, byRule, filesConsidered, filesRead,
         filesUnreadable, nosrc and coverageIncomplete

  Scenario: The two-phase shape holds a bounded working set
    Given the rule set "cics" analysing 500 programs
    When perFile has returned for each
    Then no parse tree is reachable from the accumulated summaries
    And peak heap is bounded by the largest single program

  Scenario: A set returning a parse tree from perFile is refused
    Given a set whose perFile returns a value carrying items, execs and refs
    Then it throws with code "ETREELEAK"

  Scenario: A set needing estate configuration and lacking it reports setIncomplete
    Given an estate configuration that is absent
    When the rule set "recon" analyses a tree
    Then setIncomplete is true
    And notLooked explains that nothing declared what production means
    And coverageIncomplete is unchanged
```

That last scenario preserves a distinction the code makes carefully and a careless harness would
flatten: *"nobody told us what production means"* and *"a copybook could not be read"* call for
different actions from different people.

### F4 — One registration

```gherkin
Feature: Adding a rule set touches one file

  Scenario: The registry is the single source of truth
    Then RULE_SETS, ALL_RULES, the report-key map, the feed catalogue
         and the CLI --only list all derive from the registry

  Scenario: A set absent from the registry cannot run
    Then its findings do not appear, and no silent zero is reported for it

  Scenario: An unregistered set is a hard failure, not a quiet one
    Given a rule set whose name the registry does not carry
    When a scan assembles its report
    Then it throws rather than filing that set's counts under an absent key

  Scenario: The report's key set derives from the registry
    Given the registry carries nine sets
    Then summary.bySet has ten keys — the nine and inventory
    And no test enumerates them by hand
```

The last two scenarios **subsume an existing mechanism rather than layering on it.** `scan.mjs`
holds a `SET_NAME` map and throws `ESETNAME` on an unmapped name; `test/cli.test.mjs:40` asserts
the exact ten-key set of `summary.bySet` by hand. That pair was added after the flow set was
renamed to `cobolwork-flow` while the map still said `cobolwork`, which shipped that set's file
counts under the literal key `undefined` for several commits.

The guard works — both places were correctly updated as the sets went from four to nine — but it
costs two more manual edits per set, in two files, and those are two of the nine counted above.
F4 should **delete both** and derive the key set from the registry. The property that must
survive the deletion is the one that motivated it: an unregistered set fails loudly instead of
reporting under `undefined`.

### F5 — Coverage told end to end, in SARIF's vocabulary

```gherkin
Feature: A report never claims more reading than happened

  Scenario: The reason a set stopped reaches the report
    Given the rule set "cics" stopped on the memory reserve
    Then bySet.cics carries filesNotRead and stoppedBy
    And setsIncomplete names cics and why

  Scenario: Unread files appear where a SARIF consumer looks
    When the report is emitted as SARIF
    Then each unread-file reason is a toolExecutionNotification
    And not only a property-bag entry

  Scenario: Each rule set is its own tool component
    When the report is emitted as SARIF
    Then each rule set appears in tool.extensions with its own rules
    And a result's ruleId resolves through its set's component
```

---

## 10. Roadmap

```
F0 source-tree port ──┬──> F1 canonical findings ──┐
                      │                            ├──> F3 contract ──> F4 registry
                      └──> F2 guarded traversal ───┘         │
                                                             └──> F5 coverage + SARIF
```

| Group | Scope | Files | Net lines | Risk | Observable change |
|---|---|---|---|---|---|
| **F0** | `ports/`, `adapters/`, `InMemoryTree` | 4 new, 3 touched | +300 / −60 | **HIGH — security-bearing** | `diff` stops writing temp dirs |
| **F1** | Comparator, sort, tally, metadata derivation | 12 touched, 1 new | +70 / −110 | Low | 3 sets gain `sev`/`cwe` standalone |
| **F2** | Complete the `memory.mjs` adoption; bound the sniff cache | 8 touched | +70 / −45 | Low–Med | 4 sets gain early-stop behaviour |
| **F3** | `kernel/ruleset.mjs`, the harness | 11 touched, 1 new | +180 / −260 | **Medium** | **Summary shape normalises across 9 sets** |
| **F4** | `registry.mjs` | 4 touched, 1 new | +50 / −60 | Low | None external |
| **F5** | `bySet` projection, `toolExecutionNotifications`, `tool.extensions` | 3 touched | +80 / −20 | Low–Med | **SARIF gains components and notifications** |
| **F6** | Directory move to `sets/` | ~20 moved | 0 | Low | None — **commit alone** |

**Total: ~25 files, roughly −65 net lines in `lib/`, plus one pure move.**

F0 and F3 carry the risk, and **F0's is of a different kind**. F3 risks a wrong report; F0 risks
the containment guarantee `SECURITY.md` makes. It should land with `DirectoryTree` at strict parity
— every existing test green, no behaviour change — before `GitRefTree` or `InMemoryTree` are
written, and the six containment tests are its gate rather than its regression net.

If the containment tests cannot be made to pass against an adapter without weakening them,
**that is the signal to stop and keep the filesystem coupling.** A port is worth having; it is not
worth having at the cost of the one guarantee this project treats as a vulnerability class.

### Deliberately out of scope

- **`lib/parser.mjs`** — 1,322 lines, graded against GnuCOBOL, golden-fixture-backed. It becomes a
  *consumer* of the port and is otherwise untouched.
- **Dependency-injection ceremony.** No container, no framework, no interface-per-class. The ports
  are three plain object shapes passed as arguments. A codebase with zero runtime dependencies
  should not acquire an architecture that needs one.
- **`lib/dataflow.mjs`** internals. It already uses the memory rail; the flow *set* adopts the
  contract at its boundary.

---

## 11. Execution plan

Each step ends green.

**F0 — the port** *(security-bearing; the six containment tests are the gate at every step)*
1. `lib/ports/source-tree.mjs`: `list`, `bytes`, `text`, `contains`, and a validator.
2. `lib/adapters/directory-tree.mjs`: today's `buildFileIndex` + `readSource` behind it, with
   `contains` keeping `realpathSync` behaviour **unchanged**.
3. Thread `tree` through `scanAll` to every set. **No behaviour change. All tests green.**
4. `lib/adapters/in-memory-tree.mjs`; port 3 rule-set tests onto it as proof. `contains` is key
   membership.
5. `lib/adapters/git-ref-tree.mjs` over `git cat-file --batch` — **one spawn, not N.** Preserve the
   `read-tree`/`checkout-index` property that `git archive` was rejected for: `export-ignore` files
   must still be present. Re-derive the CRLF assumption in `diff.mjs:53` rather than carrying it
   over; `cat-file` returns stored bytes (LF), `checkout-index` applied `autocrlf`.
6. Rewrite `diff.mjs` onto it; delete the temp-dir machinery **only once `test/sources.test.mjs:144`
   and `test/review.test.mjs:114` are green against the adapter.**
7. Decide `systemDirs` deliberately and record the decision in the commit message.

**F1 — canonical findings**
8. `lib/kernel/findings.mjs`: `byText`, `sortFindings`, `tally`, `withMeta` including `ERULEID`.
9. Replace 12 comparator definitions and 13 sort sites; delete the backfill in `scan.mjs`.

**F2 — guarded traversal**
10. Lint test first: no module imports `eachWithinMemory` without calling it. **It fails on three
   modules today** — that is the point.
11. Convert `build`, `recon`, `vendor`; then add the guard to `hidden`, `copybook`, `jcl`,
    `inventory`, `opaque`.
12. Move the sniff cache into `DirectoryTree` with a scan-bounded lifetime. **Done in roadmap 3.2.**
13. Introduce `filesConsidered`/`filesRead`/`filesNotRead`, keeping `filesScanned` as a derived
    alias for one release.

**F3 — the contract**
14. `lib/kernel/ruleset.mjs` with `defineRuleSet`, `perFile`/`finish`, and the `ETREELEAK` guard.
15. `test/ruleset-conformance.test.mjs` — table-driven over the registry, asserting I1–I9 for every
    set, plus a deliberately non-conforming fixture it must fail.
16. Migrate the six single-pass sets, then `copybook`, `cics`, `flow`. One commit each.

**F4 — the registry**
17. `lib/registry.mjs`; derive `RULE_SETS`, `ALL_RULES`, report keys, catalogue, CLI list.
18. Delete `SET_NAME` from `scan.mjs` and the hand-enumerated key list in `test/cli.test.mjs:40`.
    Keep `ESETNAME`'s behaviour — an unregistered set must still throw, because the bug it was
    written for shipped counts under the key `undefined` for several commits.

**F5 — coverage and SARIF**
19. Widen the `bySet` projection; key `setsIncomplete` off both flags.
20. Emit `toolExecutionNotifications` and `tool.extensions[]`.
21. Publish `schema/cobolwork-coverage.schema.json` for the `cobolwork/coverage` property bag.

**F6 — the move**
22. `lib/sets/<name>/`. Pure move, no edits, its own commit.

### Schema version

Bump `SCHEMA_VERSION` once, at F3. Record that four sets gained `byRule`/`findings`/`nosrc`, that
`bySet` gained `filesNotRead`/`stoppedBy`, and that SARIF output gained components and
notifications. All additive; nothing removed.

---

## 12. Backlog entry

> **The rule set as a contract.** Nine rule sets each re-solve traversal, reading, sorting, severity
> attachment and summary assembly, and each reaches the filesystem directly. Measured 2026-09-20:
> 12 copies of one comparator, 13 sort sites in 5 variants, 15 unreadable-catch sites, 4 of 9 sets
> returning a summary with no `byRule`, 3 sets importing `eachWithinMemory` without calling it, and
> `jcl`/`build`/`recon` returning `sev: undefined` unless `scanAll` backfills them. Adding `opaque`
> took 9 registration edits across 4 files. `lib/memory.mjs` is the precedent: one cross-cutting
> concern, one home, one sentence. `docs/spec/ruleset-contract.md` specifies a `SourceTree` port and
> a rule-set contract, models both on SARIF's `toolComponent` rather than inventing a vocabulary,
> and lets `diff` read git revisions without materialising them. Seven groups, dependency-ordered,
> ~25 files. Finishing it makes adding a rule set a one-directory change, makes a rule set's summary
> mean the same thing whoever called it, and makes a rule set testable against a tree that was never
> on disk.

---

## 13. Reconciliation

This specification makes counted claims about a tree that moves. Three times during drafting the
tree changed underneath it: `lib/memory.mjs` landed, the `opaque` rule set landed, and
content-sniffing for extensionless PDS members landed in `sources.mjs`. Each time, a number in §1
went stale, and twice a stale number survived into §12 after §1 was corrected.

A specification that overstates what it measured is the same failure this project treats as a
security bug when a *report* does it. So the counts are re-derivable:

```sh
#!/bin/sh
# Re-derive every counted claim in §1. Run from the repository root.
cd "$(dirname "$0")/.." || exit 1
p() { printf '%-36s %s\n' "$1" "$2"; }

p 'byText comparator copies'    "$(grep -l 'const byText' lib/*.mjs | wc -l)"
p 'findings.sort sites'         "$(grep -h 'findings.sort' lib/*.mjs | wc -l)"
p 'filesUnreadable++ sites'     "$(grep -h 'filesUnreadable++' lib/*.mjs | wc -l)"
p 'rule sets with bare stats'   "$(grep -l 'summary: stats, findings' lib/rules-*.mjs | wc -l)"
p 'fs call sites in lib/'       "$(grep -o 'readFileSync\|readdirSync\|existsSync\|openSync\|statSync\|readSync' lib/*.mjs | wc -l)"

n=0
for f in lib/rules-*.mjs lib/inventory.mjs; do
  i=$(grep -c "from './memory.mjs'" "$f")
  c=$(grep -c 'eachWithinMemory(' "$f")
  [ "$i" -gt 0 ] && [ "$c" -eq 0 ] && n=$((n + 1))
done
p 'dead eachWithinMemory imports' "$n"
```

Two counting traps, both of which caught this specification:

- **Count rule sets, not return statements.** `vendor` returns bare `stats` from two places — an
  early return when no pack loaded, and the final return. `grep -h … | wc -l` gives five;
  `grep -l … | wc -l` gives four. The invariants in §4 are about sets, so the second is right.
- **Count files, not matches, for the comparator.** A module could declare `byText` twice.

### The drift that mattered

The registration count is the claim most worth re-deriving, because it is the argument for F4 and
it only ever grows:

```sh
grep -c 'opaque\|OPAQUE' lib/scan.mjs feed/catalogue.mjs bin/cobolwork.mjs test/cli.test.mjs \
  | awk -F: '{s += $2} END {print s " edits to register one rule set"}'
```

It read 7 when first measured and 9 once `test/cli.test.mjs` and the second `feed/catalogue.mjs`
site were counted. **Nothing in the codebase would have reported that it had grown.** That is the
cost this specification exists to remove, demonstrated on itself.

---

## 14. What depends on this

[`language-coverage.md`](language-coverage.md) plans five more languages — BMS, IMS DBD/PSB,
DB2 DDL, HLASM and PL/I — taking the tool from 9 rule sets to 14. It names this document its
Phase 0 gate, and it sharpens this specification's argument in three ways worth folding back in.

### It makes the duplication argument arithmetic rather than aesthetic

This specification counts duplication in the present tense. The language plan projects it forward,
and the projection is the real case:

| Duplicated | Today | After five languages |
|---|---|---|
| `const byText = …` | 12 | 17 |
| `buildFileIndex(root)` | 11 | 16 |
| `relPath(root, f)` | 10 | 15 |
| `readSource(f).text` in a try/catch | 9 | 14 |
| `byRule[f.rule] = (byRule[f.rule] \|\| 0) + 1` | 8 | 13 |
| `f.sev = meta.sev; f.cwe = meta.cwe` | 3 | 8 |
| `const where = (x, path) => …` | 2 | 7 |

Roughly twenty helpers, written five more times each. The argument for the contract stops being
"nine copies is untidy" and becomes "the next five sets cost five rewrites or zero, and the
difference is whether this lands first."

### It adds three extractions to Phase 0's scope

The contract removes `byText`, `byRule`, severity stamping and `where` by construction — they
belong to the framework. Three further extractions are the language plan's, not this one's, but
they share F0's gate and should be sequenced with it:

| Extract | From | Callers | Why it cannot wait |
|---|---|---|---|
| `lib/cards.mjs` | `lib/jcl.mjs` | JCL, HLASM, BMS, IMS DBD, IMS PSB | The 72-column model, continuation folding and operand parsing already exist in `jcl.mjs`. Five callers, one implementation — or five drifting copies |
| `lib/layout.mjs` | `lib/parser.mjs` | COBOL, PL/I, BMS symbolic maps, IMS segments | **The one that matters most.** Level numbers → byte offsets is the graded part of the parser and what the byte-range taint model runs on |
| `lib/embedded-sql.mjs` | `lib/dataflow.mjs` | COBOL, PL/I | PL/I embeds `EXEC SQL` identically. `sqlHostVars`, `sqlIntoRange` |

`lib/layout.mjs` deserves the emphasis the language plan gives it: if PL/I computes its own
offsets, the project has **two layout engines and one grade**, and the README's accuracy table
quietly stops covering half the tool. That is the same failure this specification identifies in
`filesScanned` — one word, three meanings — arriving in a place where it would be measured and
published.

### It supplies one invariant this specification was missing

Added to §4 as **I9 — one implementation per concept.** Before writing a helper, grep `lib/` for
it. `byText`, `where`, the severity stamping and the `byRule` tally belong to the framework. A
second copy of the column model or the layout computation is a defect rather than a convenience.

And its companion, which is the test for every extraction here and there:

> **Extraction preserves behaviour.** The callers' tests pass *unchanged* — not "updated to
> match". An extraction that needs its callers' tests rewritten has changed behaviour, and
> behaviour change is a separate commit.

That rule applies directly to F0 step 3 (thread `tree` through with no behaviour change) and to
F6 (the directory move, its own commit, no edits).

### Two places the plans must stay in step

1. **F6 gets heavier, not lighter.** Moving to `lib/sets/<name>/` is a 9-directory change today
   and a 14-directory change after. Either do it before the languages land, or accept doing it
   twice. The language plan assumes the former.
2. **`test/feed.test.mjs` asserts `CATALOGUE.size`.** It is a deliberate tripwire — 79 rules
   today. F4 derives the catalogue from the registry, so the tripwire must survive that change
   rather than being silently satisfied by it. A registry that auto-discovers sets could make the
   count self-fulfilling, which would remove the tripwire's whole value.

### What the language plan asks of the port

Its invariant 6 is **"No root paths. Everything goes through the `SourceTree` port"** — stated as
settled, with five new rule sets specified as `defineRuleSet` adapters on it. Its invariant 4 on
content-based detection (`.asm` files in the corpus are 36% IMS, so extension tells you almost
nothing) reaches for `sniffKind`, which §3 of this document moves into `DirectoryTree`.

That is a real coupling and it cuts both ways: it strengthens the case for F0, and it means F0's
containment requirements — the hardest part, and the one where a bug is a vulnerability — are load
bearing for five languages rather than one refactor. **F0's stop condition applies with more force,
not less.** If the containment tests cannot pass against an adapter without weakening them, that
decision now blocks a larger plan, and the right answer is still to keep the filesystem coupling
and say so.

### A claim that is not reproducible: "206 tests passing"

This specification's header states 206 tests passing. That claim is **machine-dependent**, and
finding out why is worth recording, because it is the same failure mode the document is about.

Two sessions measured the same commit and disagreed:

| | Session A | Session B |
|---|---|---|
| `npm test` (parallel) | 206 pass, 0 fail | 206 tests, **189 pass, 17 fail** |
| `--test-concurrency=1` | 206 pass, 0 fail | 206 pass, 0 fail |
| `freemem()` at the time | **502 MB** | **330 MB** |
| Margin over `MEMORY_FLOOR` | 310 MB | 138 MB |

Neither was misreporting. The cause is in `lib/memory.mjs`:

```js
const osHeadroom = freemem();                                    // :54  machine-wide
available: Math.max(0, Math.min(heapHeadroom, osHeadroom)),      // :57
```

`available` is `min(per-process heap, whole-machine free memory)`. On both boxes the machine term
dominated — by 8× on one and 13× on the other. `watchMemoryBuffer().check()` returns `'tight'`
below `MEMORY_FLOOR` (192 MB), and `test/memory.test.mjs:37` asserts `'ok'` after `:34` hands back
to real machine state. So that assertion fails whenever **the box** has under 192 MB free,
whatever the test concurrency.

One diagnosis to avoid, because it is the intuitive one and it is wrong: this is *not* parallel
test files moving each other's heap. `node --test` spawns a process per file, so `used_heap_size`
is genuinely isolated. The coupling is `freemem()`, which every process on the machine moves —
other test workers, editors, browsers, a second agent session.

**It is the run that crosses the threshold, not the machine at rest.** A later measurement on
session A's box read 321 MB free — *below* the 330 MB at which session B saw 17 failures — and the
suite still passed 206/206. So the number to watch is not `freemem()` before the run but
`freemem()` *during* it: `node --test` spawns a worker per file, each holding a parser, a corpus
and a heap, and the suite depresses the machine-wide figure it is simultaneously asserting on. That
is why the flag flips the result, and it is the sense in which this is a defect in the test suite
rather than a fact about the hardware.

That distinction decides the fix:

- **Pinning `--test-concurrency=1` is mitigation, not a fix.** It helps only by shrinking the
  suite's own footprint. A constrained runner still fails serially. If it is taken, the commit
  message must say *reduces probability* so the real issue is not closed on the back of it.
- **The fix is to inject the readers — both of them.** Injecting `getHeapStatistics()` alone
  leaves `freemem()` deciding `available`. `setAvailableMemory` is already the seam; the gap is
  that the tests use it for the override cases and then deliberately hand back to real machine
  state for the `'ok'` cases, which is the exact moment they stop testing the logic and start
  testing the box.

Where it bites hardest is a hosted CI runner, Windows especially, and it presents as an unrelated
assertion about a watcher with a green re-run — the worst possible shape for a first contributor's
pull request.

**The general point for this specification:** a green suite is a claim like any other in §13, and
this one is not reproducible across machines. Any statement here of the form "all tests pass"
should say how and where it was run. The claims above re-derive from the tree; this one re-derives
from the tree *and the box*, which is a defect in the test, not in the reporting.
