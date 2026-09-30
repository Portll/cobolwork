# The build gate

A specification for `cobolwork build`, the deterministic step that stands between a change and the
compiler: it scans, applies a policy, checks the compiler options the build will use, and refuses
to compile when the policy says so. The scenarios below are the tests: each `#### <id>` heading is
the name of exactly one test, and `test/build.test.mjs` fails if a heading has no test or a test
names a heading that is not here.

Status: proposed, 2026-09-26.

---

## 1. Why this exists

Nothing in cobolwork stops a build. `scan` exits 0 whatever it finds; `gate` judges whether one
patch fixed one finding, and without `--exit-code` its status says whether it ran, not what it
decided. A pipeline that wants findings to block has to parse the report, pick a threshold, decide
what an incomplete scan means and apply the baseline's expiry dates itself, and every pipeline
that does will do it differently.

The compiler is the other half. A subscript past the end of a table overwrites the storage after
it unless the program is compiled with range checking, and Enterprise COBOL's default is
`NOSSRANGE`. The build decides that, not the source. cobolwork already works out whether `SSRANGE`
is in force from a program's `CBL`/`PROCESS` statements and the estate's declared `compilerOptions`
(`lib/dataflow.mjs`), and reports nothing when it is not.

**The gate runs no model.** Every check is a rule the engine evaluates over the parsed source, the
same way on every machine. The remediation pipeline may use a model to draft a fix; the gate that
disposes of it never does. A gate that reads repository text through a model can be addressed by
that text, and cobolwork already reports comments written to instruct the agents that read code
(`agent-directive-in-comment`). The gate reads that text only as data.

**Legacy estates need a ratchet.** An estate scanned for the first time holds hundreds or thousands
of findings. A gate that blocks on all of them fails every build on the first day and is switched
off on the second. The default mode blocks what a change introduces, and the worst findings
wherever they are; the rest waits in the baseline, each entry with a name and a date.

## 2. Ubiquitous language

The terms of [`ruleset-contract.md`](ruleset-contract.md) §2 and
[`remediation-gate.md`](remediation-gate.md) §2 stand. This adds:

| Term | Meaning |
|---|---|
| **policy** | Which findings block, which run-time checks the compiler must generate, which options it must not be given, and how incomplete coverage is treated (§4) |
| **floor** | A policy from outside the reviewed tree, named by `--policy`. A repository policy can tighten it and never loosen it |
| **tier** | How a report ranks a finding: LOW, MED, HIGH, CRIT, or KNOWN-EXPLOITABLE when it names a vulnerability CISA lists as exploited. INFO is context and coverage, which assert no defect (§5a) |
| **consequence class** | What a finding would let someone do that a build refuses at any tier: `privilege-escalation` or `data-mutation` (§5a) |
| **blocking finding** | A finding the policy says stops the build, not covered by a live waiver |
| **advisory finding** | A finding reported with its tier that does not stop the build |
| **waiver** | A baseline entry that accepts a finding, with a reason, who accepted it and an expiry date, all of which `lib/baseline.mjs` already requires |
| **expired** | A waiver past its expiry. The baseline already leaves its finding open and lists it in `baselineExpired` |
| **ratchet mode** | `--base <ref>` given: a finding blocks when the change introduced it, or when its tier is at or above the policy's `always` |
| **absolute mode** | No `--base`: every finding that would block, blocks |
| **introduced** | In the head and not paired with a base finding of the same or higher tier, by the pairing of `remediation-gate.md` §6 |
| **run-time check** | A test the compiler generates into the program: a subscript within its table, a reference modification within its item, numeric data valid for its usage, a called program not writing past what its caller passed (§7) |
| **effective options** | The options a program is compiled with, from the estate's defaults, the compile step and the program's own `CBL`/`PROCESS` statements, the last to name an option winning |
| **provenance record** | What was scanned, under which policy, and what was compiled, written so the binary can be traced to it (§9) |

## 3. The command

```
cobolwork build <repo> [--base <ref> [--head <ref>]] [--policy <file>] [--provenance <file>] [--advisories <file>[,<file>]] [--format json|sarif] [--out <file>] [--ironwork <path> | -- <compiler> <arg>…]
```

`--advisories` loads an estate's own advisory extract, as `scan` does; a feed inside the tree is
refused. It is where most KNOWN-EXPLOITABLE findings come from, because IBM publishes much of what it
knows about IBM Z only to its customers.

- The document (§10) goes to standard output, or to `--out`. With `--format sarif` it is the scan's
  SARIF with each blocking finding at level `error` and every other finding at `warning` or
  `note`, so a code-scanning upload shows what stopped the build.
- Everything after `--` is the compiler command, as an argument vector: no shell reads it. It runs
  only on a pass (§8). Without `--` the gate lints and checks options and compiles nothing, for a
  pipeline whose compile step is elsewhere, which includes every z/OS build.
- `--ironwork <path>` gives that pipeline a compile check before the mainframe: ironwork's `check`
  runs on every program on a pass (§8a). It and `--` are one or the other.
- The exit status is the verdict, because stopping the build is the command's purpose:

  | Exit | Meaning |
  |---|---|
  | 0 | pass, relaxed or not, and the compiler, if one was given, exited 0 |
  | 1 | fail: a check failed |
  | 2 | could not run: not a repository, a revision that does not resolve, a policy that does not validate, a compiler inside the tree |
  | 3 | undecided: no check failed and at least one could not be decided |
  | 4 | pass, and the compiler exited non-zero; its status is in the document |

  A pipeline that stops on any non-zero status stops on everything but a clean pass. The compiler's
  own status is not passed through, because a compiler that exits 1 would read as the gate's fail.
- `--only` is refused: a rule set left out is findings not seen. `--no-baseline` is allowed and
  makes every waiver inert, for a report of the whole debt.

## 4. The policy

A JSON document, `cobolwork.policy.json` at the repository's root, validated against
`schema/cobolwork.policy.schema.json`:

```json
{
  "policyVersion": 1,
  "block": "high",
  "always": "crit",
  "classes": ["privilege-escalation", "data-mutation"],
  "rules": { "opaque-altered-control-flow": "block", "web-link-opens-without-noopener": "warn" },
  "coverage": "block",
  "waivers": { "maxDays": 180 },
  "checks": ["subscript", "reference-modification", "argument-length"],
  "forbid": { "enterprise": ["TRUNC(OPT)"], "gnucobol": ["-fnotrunc"] }
}
```

| Key | Meaning | Default |
|---|---|---|
| `block` | A finding at or above this tier blocks. MED and LOW are advisory | `high` |
| `always` | In ratchet mode, a finding at or above this tier blocks whether or not the change introduced it. KNOWN-EXPLOITABLE ranks above CRIT, so it is included | `crit` |
| `classes` | A finding in one of these consequence classes blocks at any tier | both |
| `rules` | Per rule: `block` whatever its tier, or `warn` whatever its tier or class | none |
| `coverage` | Incomplete coverage is `block` (undecided) or `warn` (reported, and the verdict decided without it) | `block` |
| `options` | A build without a required run-time check is `block` (a missing check fails, options nothing declares are undecided) or `warn` (both reported, and the build passes relaxed). An option `forbid` names, and a check the change removes, fail under either | `warn` |
| `waivers.maxDays` | A waiver written with an expiry further off than this covers nothing | 180 |
| `checks` | The run-time checks every program must be compiled with, by name (§7) | `subscript`, `reference-modification` |
| `forbid` | Options, per compiler, a build must not pass, beyond those that turn a required check off | none |

There is no `off`. A rule the estate does not want is waived, with a name and a date, or set to
`warn`, which still appears in every report.

**Which policy applies.** Two layers, and the stricter wins at every key:

1. The **floor**: `--policy <file>`, which must lie outside the repository, as an advisory feed must
   (`docs/rule-sets.md`, "The build"). An organisation keeps one for every estate.
2. The **repository policy**: in ratchet mode, the file as it stands in the **base** revision; in
   absolute mode, the file in the tree.

A repository key looser than the floor's is ignored, and the document's `policy.ignored` names it.

Reading the repository policy, the baseline and `cobolwork.site.json` from the base means a change
is judged by the rules it was written against. A pull request that relaxes the policy, adds a
waiver for its own finding or edits the site file so a rule stops firing gets none of it until it
has been reviewed and merged, and `configurationChanged` names what it touched so the reviewer
sees it. A waiver for new code is therefore its own change, reviewed on its own. That is friction,
and it is the property: accepting a finding is a decision somebody else signs.

Absolute mode reads the tree's own policy, so it is for the branch a change lands on, not for the
change. A pipeline gates pull requests with `--base` and gates `main` without.

## 5. The two modes

A finding **would block** when its tier is at or above `block`, or it is in one of the policy's
`classes`, or `rules` names it `block`; and `rules` naming it `warn` overrides all three.

**Ratchet mode.** Both revisions are scanned with every rule set, as `diff` scans them. A finding
blocks when it would block and the change introduced it, or when its tier is at or above `always`
wherever it is. Pairing is `remediation-gate.md` §6 unchanged: rewording a flagged line does not make
its finding new, and a finding whose tier rose is introduced.

**Absolute mode.** One scan. Every finding that would block, blocks.

**Waivers, in both.** A finding covered by a live waiver does not block and is listed as waived.
An expired waiver, or one written with an expiry further off than `waivers.maxDays`, covers
nothing: its finding is judged as if it had none, and in ratchet mode it counts as introduced. An
old finding with no waiver is the debt the ratchet exists to carry; an old finding whose waiver
expired is a promise with a date that was not kept, and the build is where that is noticed.

## 5a. Tiers and consequence classes

Every finding a build reports carries a tier and its consequence classes, blocking or not, so the
report ranks the whole estate and says why each blocking finding blocked.

**Tiers.** A finding's tier is its severity - LOW, MED, HIGH, CRIT - unless it names a vulnerability
CISA's Known Exploited Vulnerabilities catalogue lists, when it is KNOWN-EXPLOITABLE, above CRIT. The
build set marks those findings with `knownExploited`, the CVE ids that put them there: a pinned
compiler or component, or a runtime version the estate declares. The tier rests on a published
fact about a published vulnerability. Whether a route in the estate's own code is exploitable is a
separate field, `exploitability`, which each build finding carries as its verdict (`reach.md` §9);
it does not change the tier or what blocks.

**Consequence classes.** Two, decided per rule by `lib/consequence.mjs` and never by a finding's
detail:

- **`privilege-escalation`**: input that chooses a command, a program, an SQL statement, a file or
  a job runs with the program's authority rather than its author's. The routes to `os-command`,
  `dynamic-sql`, `internal-reader`, `dynamic-program-load`, `cics-dynamic-transfer` and
  `dynamic-file-path`; a route around a sign-on; diagnostic transactions and transactions without
  command security; authorised libraries and privileged security commands; a credential written
  where others can read it; a compiler a crafted source file can exploit. The `tampering` rules are
  here too - source arranged so the compiled program is not the one a reviewer read hands its author
  control of what runs - except `copybook-shadowed`.
- **`data-mutation`**: input that chooses which record is changed, which queue is written, or where
  in storage a write lands. The routes to `record-update`, `queue-name`, `os-command`, `dynamic-sql`
  and `internal-reader`; the routes to `subscript`, `reference-modification`,
  `occurs-depending-count` and `loop-bound` unless the program abends on a bad index (`SSRANGE`
  without `MSG`); a called program or a CICS communication area longer than what the caller passed;
  destructive in-stream JCL; a non-production job writing production data; a state change without a
  token.

A rule in neither class discloses, exposes, or stops the program rather than changing what it does,
and its tier alone decides whether it blocks. Every defect rule is in the table, in one class, both,
or named as neither; a test fails when a rule is added without a decision, so a new rule cannot
reach a build unclassified. On 2026-09-27: 60 rules escalate, 54 mutate, 59 do neither, of 152.

MED and LOW are advisory unless a class makes them block. A MED file name taken from a file record
blocks; a MED log line holding personal data is reported and does not.

**Measured, and two rules taken out.** Over the 500-repository corpus on 2026-09-27, 12 repositories
failed only through a MED or LOW finding's class, and reading each showed no escalation or change of
data in any:

- `cics-transfer-to-variable-program` (7 repositories): every program name the variable held was a
  literal - `VALUE 'LGACVS01'`, `MOVE 'BBANK20P' TO BANK-NEXT-PROG`. The rule reports that a
  variable names the program, not that input chooses it; input that does is
  `*-to-cics-dynamic-transfer`, CRIT, which blocks by tier. It is in neither class.
- `copybook-shadowed` (3): separate exercises in one repository each resolving their own copy,
  and starter and solution copies. Neither class. `copybook-shadows-system`, a repository copy of
  `SQLCA` or `DFHAID`, stays in the class unless its layout is the system's: a repository `SQLCA`
  is compared field by elementary field with Db2's documented layout (`rules/system-layouts.json`),
  and one that matches is low and in neither class. The two in the corpus are vendored copies that
  match.
- `file-record-to-dynamic-file-path` (1): a false route through `SELECT ()`, from partial-word
  `REPLACING` the parser does not yet apply.

## 6. Coverage

A scan whose coverage is incomplete has findings it did not report: a copybook it could not find, a
program it could not parse whole, a set the memory guard stopped. The gate cannot tell a clean
program from one it did not read, so under the default policy an incomplete scan makes `coverage`
undecided and the build exits 3. The document names each set and the reason, from the scan's
`coverageIncomplete` and `setsIncomplete`.

`"coverage": "warn"` lets the verdict be decided without it; a floor that says `block` wins.

A copybook missing from the repository is most often one the estate keeps in a copy library the
repository never held: 69 of the 131 incomplete repositories in §16a. `--copylib <dir>[,<dir>]` names
those libraries, on the build and on every command that scans. They are searched after the tree's
own copybooks, as `COBCPY` and `COBOLWORK_COPYPATH` are, and a copybook found there is read rather
than reported missing. The provenance record names them.

On a machine short of memory a scan can stop at the reserve, so the same change can be undecided on
one run and decided on the next. It never moves between pass and fail. A pipeline that sees 3 with
only the memory guard named can retry on a larger runner; one that sees 3 for a missing copybook has
a build that does not hold its own source.

## 7. Run-time checks and compiler options

The checks that make a program stop rather than corrupt its own storage are off unless a build turns
them on. The policy names the checks; the gate works out each program's effective options and says
whether they generate them.

**Where options come from.** For Enterprise COBOL, in the order the compiler applies them: the
installation defaults, which only the estate knows and declares as `compilerOptions` in
`cobolwork.site.json`; the `PARM` of the step that compiles the program; and the program's own `CBL`
or `PROCESS` statements. A compile step is `EXEC PGM=IGYCRCTL`, whose `SYSIN` names the member, or
the `EXEC` of a compile procedure - IBM's `IGYWC…` procedures, or one of the tree's own that runs
IGYCRCTL - with `PARM.<step>` or an unqualified `PARM`, which JCL gives the first step, and the
member on `<step>.SYSIN`, on an unqualified `SYSIN`, which JCL adds to the first step, or on the
`SYSIN` the procedure itself declares, with the caller's symbols filled in. A `PARM` written as a
parenthesised list is read as one. A program is matched to a member by its file name. A member whose
dataset name is still symbolic is not attributed. What no level sets is the installation's default,
which an installation can change from IBM's: a compile step that does not mention `SSRANGE` leaves it
unknown, and only `compilerOptions` in the site file says what the default is.

For GnuCOBOL and for GCC's `gcobol`, the argument vector after `--`; without one, every `cobc` and
`gcobol` command the tree's build scripts run - Makefiles, shell and batch scripts, CI workflows, Dockerfiles, VS Code's
`.vscode/tasks.json`, and scripts with no extension up to 64 KB - with the variables the same file
assigns substituted. A program with no Enterprise COBOL level of its own takes its options
from those commands, and every command must generate the required checks: a script is a build the
repository declares, so a check it leaves out is missing, not undecided.

**How a build script is read.** Each line is read as the shell that runs it reads it:

- It is split into commands at `&&`, `||`, `;`, `|` and `&` outside quotes and `$( )`, so
  `mkdir -p bin && cobc -x -free …` is two commands, and the `|` in `$(shell find src … | sort)` is
  not a separator. A command held in one quoted word (`sh -c "cobc …"`, an alias, a `CMD` string) is
  read as a command line of its own, and a Dockerfile's `RUN ["cobc", …]` as its argument list.
- The variables the file assigns are substituted where they are used, until none the file assigns
  is left: in a Makefile `=`, `:=`, `+=`, and `?=` only where the variable is not yet set, used as
  `$(VAR)` or `${VAR}`, with `$(wildcard …)` read as its pattern; in a shell script `NAME=value`,
  `$NAME`, `${NAME}` and `${NAME:-default}`; in a batch file `set NAME=value` and `%NAME%`; in
  PowerShell `$name = …`; in a Dockerfile `ENV` and `ARG`. A shell assignment in front of a command
  on the same line, `PATH="…" $(COBC) …`, belongs to that command. A Makefile line opening with a
  tab is a recipe line while a rule is open, and make's `@`, `-` and `+` before it are not part of
  the command. The command is `cobc`, or `gcobol` under its versioned and cross-compiler names
  (`gcobol-16`, `aarch64-linux-gnu-gcobol`); a Makefile whose compiler variable ends up naming
  another compiler, `CBLC ?= ccbl`, runs neither.
- A task in `.vscode/tasks.json` is its `command` followed by its `args`, read the same way, and its
  `windows`, `linux` and `osx` variants are tasks too. Comments and trailing commas are accepted.
  `${workspaceFolder}` is the folder that holds `.vscode`, where the task runs unless its
  `options.cwd` says otherwise; a variable naming the open file, `${file}`, stands for any file.
- A `cd` before a command on the same line, and in a shell or batch script on an earlier line, moves
  where the command's files are read from.
- A command that names no source file compiles nothing and is not read: `cobc --version`,
  `command -v cobc`, `echo "cobc is not installed"`. A source file is an operand with a program
  extension, or one that a variable, a batch argument, a glob or `find`'s `{}` supplies. The values
  of `-o`, `-I`, `-L`, `-l`, `-A` and `-Q` are not operands: each takes the next argument
  (`provenance/compiler-options.json`). For `gcobol` the values of `-o`, `-I`, `-L`, `-l`, `-D`,
  `-x`, `-dialect`, `-copyext`, `-include`, `-fcobol-exceptions` and `-fno-cobol-exceptions` are
  not; `-main` takes none, and marks the source that follows it.

**The checks.** The Enterprise COBOL rows are from IBM's documentation for 6.3 and 6.4. The GnuCOBOL
and gcobol rows rest on observed behaviour, not on either compiler's source (§16):

| Check | Enterprise COBOL | GnuCOBOL | gcobol | Default |
|---|---|---|---|---|
| `subscript` | `SSRANGE`, abending: a bare `SSRANGE` is `SSRANGE(NOZLEN,ABD)`. Covers subscripts, `ALL` and indexes; an `OCCURS DEPENDING ON` object is checked only against the table's maximum | `-fec=EC-BOUND-SUBSCRIPT`, which also generates the `OCCURS DEPENDING ON` check: `-fec=EC-BOUND-ODO` alone generates nothing | `-fcobol-exceptions=EC-BOUND-SUBSCRIPT` | yes |
| `reference-modification` | `SSRANGE`, as above | `-fec=EC-BOUND-REF-MOD`, generated where the offset or length is known only at run time | `-fcobol-exceptions=EC-BOUND-REF-MOD` | yes |
| `numeric-data` | `NUMCHECK(ZON,PAC,ABD)`: an implicit class test on zoned and packed senders | `-fec=EC-DATA-INCOMPATIBLE`: display and packed items, not binary | none: gcobol 16 does not implement `EC-DATA-INCOMPATIBLE` | no |
| `argument-length` | `PARMCHECK(ABD)`: a called program writing past the end of the caller's WORKING-STORAGE, not past each argument | `-fec=EC-PROGRAM-ARG-MISMATCH` (3.2): on entry, every required `USING` item was passed and the caller's copy is at least as large | none: gcobol 16 does not implement `EC-PROGRAM-ARG-MISMATCH` | no: it needs GnuCOBOL 3.2 and Enterprise COBOL 6.2 |

Each GnuCOBOL row was confirmed with GnuCOBOL 3.2.0 on 2026-09-26 by compiling a program that
breaks the check and running it; `provenance/compiler-options.json` records each observation.
Without the checks, invalid digits `A1B` computed as `0112`, and a called program with a 20-byte
LINKAGE item wrote 18 bytes past its caller's 2-byte argument. `-fec` takes one name, with or without
`EC-`, as `-fec=<name>` or `-fec <name>`; a comma list is refused. A later `-fno-ec` overrides an
earlier `-fec` or `-debug`, and a name covers every condition below it.

Each gcobol row was confirmed with gcobol 16.2.0 (Debian 16.2.0-3, aarch64 Linux) on 2026-09-30 the
same way: without the option the out-of-range subscript and reference modification ran on, with it
each program ended at the statement with `fatal exception: … EC-BOUND-SUBSCRIPT` (or `EC-BOUND-REF-MOD`)
and exit status 133. Enabling `EC-DATA-INCOMPATIBLE` or `EC-PROGRAM-ARG-MISMATCH` stops the compile
with `sorry, unimplemented`, and `EC-ALL` does not generate them: `A1B` computed as `0011`. So a
policy requiring `numeric-data` or `argument-length` fails `options` for gcobol, and nothing is added
for it. `-fcobol-exceptions` takes a comma list, as `-fcobol-exceptions=<list>` or
`-fcobol-exceptions <list>`, names in either case, and may be repeated. `-fno-cobol-exceptions N`
withdraws the enabled conditions N covers and nothing else: after `-fcobol-exceptions EC-BOUND`,
`-fno-cobol-exceptions EC-BOUND-SUBSCRIPT` leaves the subscript check on, and after `EC-ALL`,
withdrawing `EC-BOUND` leaves it on too. A later `-fcobol-exceptions` re-enables what an earlier
`-fno-cobol-exceptions` withdrew. gcobol has no `-debug` equivalent: `-g` is debugging information.

`-debug` generates every GnuCOBOL row: it is `-fstack-check -fec=EC-ALL`. `-fec` exists from
GnuCOBOL 3.1 and `EC-PROGRAM-ARG-MISMATCH` from 3.2; where the build set has found the pinned
version, a check that version cannot generate fails `options` and says so. Every advisory against
`cobc` on record was fixed in 3.1 (`rules/advisories.json`), so an estate on 2.2 already has a
finding for it.

An option that reports and continues does not count. `SSRANGE(MSG)`, `NUMCHECK(MSG)` and
`PARMCHECK(MSG)`, which is also what a bare `PARMCHECK` means, write a message and carry on, which is
the overwrite with a log line. An option that turns a required check off is forbidden without being
listed: `NOSSRANGE`, `NOPARMCHECK`, `-fno-ec` naming the check or naming none,
`-fno-cobol-exceptions` withdrawing the condition that generated the check.

`INITCHECK` is not a run-time check: it is compile-time analysis that issues warnings, and the gate
does not read compiler listings.

**What the compiled options cannot show.** Language Environment's `CHECK(OFF)` has no effect on a
program compiled with Enterprise COBOL 5.1 or later, so it does not undo an `SSRANGE` the gate has
credited; it still silences `SSRANGE` in programs compiled with 4.2 or earlier, which the gate cannot
tell apart. An installation can fix an option with an asterisk in its IGYCDOPT defaults, which
overrides a program's `CBL`, and a compile step can bypass that with its own IGYCDOPT on `STEPLIB`.
The options a program was compiled with are the ones its listing records. The gate reads what the
source and the build declare, which is evidence of them, not proof. These are IBM's documented
behaviours (`provenance/compiler-options.json`), not yet observed on a z/OS system.

**What happens.**

- A program whose effective options do not generate a required check is a weaker build, not a
  defect in the code. Under the default, `"options": "warn"`, the build passes relaxed: the verdict
  is `pass`, `relaxed` lists `options`, the reasons name the program, the check and the level that
  set it, and the summary line reads `pass (relaxed: options)`. Under `"options": "block"`, which a
  floor can impose, it fails the `options` check.
- An option the policy's `forbid` list names fails the `options` check under either setting: the
  policy asked for that by name.
- In ratchet mode a change that removes a check the base's build generated fails the `options` check
  under either setting, program by program and script by script: the change made the build weaker.
  A script generates a check only if every `cobc` and `gcobol` command in it does.
- For GnuCOBOL with a compiler given, a missing check is added to the argument vector as its
  `-fec=` option, after the caller's own, and `optionsAdded` lists it; for gcobol, as its
  `-fcobol-exceptions=` option. `-debug` is not added, because
  it also turns on checks the policy did not ask for, each with a cost.
- An option the caller passed that turns a required check off is never removed: removing it silently
  would hide a build configured against the policy. Under `warn` the build passes relaxed and
  compiles as the caller asked; under `block`, or when `forbid` names it, nothing compiles.
- For Enterprise COBOL the gate compiles nothing and adds nothing. The reason says where to add the
  option, and the build is fixed where it is defined.
- A compiler command that is not `cobc` or `gcobol` - `make`, a script - makes `options` undecided:
  the gate cannot tell what reaches the compiler through it. Gate the `cobc` or `gcobol` step, or
  run without `--` and declare the options.
- A program whose effective options cannot be worked out, because no compile step names it and the
  estate declares no defaults, is unknown. Declaring the installation defaults turns that into an
  answer. Under `warn` the build passes relaxed; under `block` `options` is undecided, for an estate
  that means every program to be compiled with its checks, and a floor that says `block` wins.

**Cost.** Checks cost run time. A program that cannot afford one is waived by name, with an owner and
a date, like any finding.

**Open before §7 ships.** Whether a Language Environment run-time option can suppress the checks
`SSRANGE` generates. If one can, the estate declares its run-time options as it declares its compiler
defaults, and the check reads both.

## 8. Running the compiler

- It runs only on a pass. A fail or an undecided verdict compiles nothing.
- The first argument is resolved as `gate` resolves `cobc` (`lib/gate.mjs`, `findCobc`): an absolute
  file, or the first match on `PATH` skipping relative entries and every directory inside the
  repository. A compiler inside the reviewed tree is refused with exit 2: a change that adds a
  `cobc` to the repository and a `PATH` entry pointing at it would otherwise compile itself with its
  own compiler.
- It runs with the caller's working directory and environment, with no shell, and with no time
  limit: a build's length is the pipeline's to bound. The document records the resolved path, the
  argument vector as run and the exit status.

## 8a. Checking with ironwork

ironwork compiles COBOL as IBM Enterprise COBOL does, and `ironwork check <program> -I <dir>…`
stops after the front end and exits with IBM's highest return code: 0 clean, 4 warnings only
(the program compiles), 8, 12 or 16 when it does not. Errors come first on standard error as
`file:line:col: message`; `warning:` and `informational:` lines after them are not read. cobolwork runs it as a separate program, as it runs
`cobc`, and links nothing of it.

- It runs only on a pass, once per program in the tree, with the tree's copy directories and every
  `--copylib` as `-I`, and ironwork applies each program's own `CBL` and `PROCESS` cards. The options
  check reads the tree as it does with no compiler (§7).
- The path is resolved as the compiler's is, and one inside the repository is refused with exit 2.
- Each program lands in one of four lists in `compiled`: `failed`, a program ironwork rejects;
  `notModelled`, one it refuses by name for a construct it does not model yet, or whose only errors
  are a field the CICS, DL/I or SQL translator declares (`DIBSTAT is not defined`); `unresolved`, one
  that copies a member no copy library holds; `unrun`, one whose check ended some other way or took
  more than 60 seconds.
- `compile` is `false` with any program in `failed`, and the gate exits 4 as for a compiler. It is
  `null` where every other program is one ironwork could not decide: the gate exits 3, or, where the
  policy says `warn` for coverage, passes with `compile` in `relaxed`. What ironwork has not modelled
  is not a program that compiles, as a copybook the tree lacks is not a clean read.
- A message is passed through `printable`, with every quoted literal replaced by `'…'`, since a
  diagnostic may quote the program and no output of the gate carries source text (B7.1). The
  document records the ironwork version, the argument vector with `<program>` for the program and
  copy directories relative to the tree, and the counts; the provenance record carries the same with
  the binary's SHA-256.

## 9. Provenance

`--provenance <file>` writes a JSON record of:

- the tool version and flow model;
- the policy as applied, as canonical JSON and its SHA-256, and which layer set each key;
- the base and head revisions;
- the SHA-256 of every program and copybook the scan read, sorted by path;
- each waiver that covered a finding: its rule, who accepted it, the reason and the expiry;
- the compiler's resolved path and SHA-256, the argument vector as run and its exit status;
- the verdict.

It holds no time unless `SOURCE_DATE_EPOCH` is set, the reproducible-builds convention, so two builds
of the same inputs write the same bytes. It is shaped to be the predicate of an in-toto statement;
signing it is the pipeline's, because key custody is.

## 10. Output

```json
{
  "tool": "cobolwork-build",
  "schemaVersion": 1,
  "verdict": "fail",
  "relaxed": [],
  "mode": "ratchet",
  "checks": { "findings": false, "coverage": true, "options": true, "compile": null },
  "blocking": [{ "fingerprint": "...", "rule": "cics-transfer-to-variable-program", "tier": "med", "sev": "med", "classes": ["privilege-escalation"], "path": "...", "line": 10, "introduced": true, "blocking": true, "because": "class" }],
  "findings": ["every open finding, in the shape above, blocking or advisory"],
  "waived": [{ "fingerprint": "...", "rule": "...", "tier": "high", "who": "...", "reason": "...", "expires": "2027-01-31" }],
  "expired": [],
  "overlong": [],
  "optionsAdded": [],
  "configurationChanged": ["cobolwork.policy.json"],
  "policy": { "sha256": "...", "setBy": {}, "ignored": [], "applied": {} },
  "compiled": null,
  "reasons": ["..."],
  "repositoryText": ["blocking[].path", "findings[].path", "waived[].who", "waived[].reason", "expired[].who", "overlong[].who", "reasons"],
  "summary": { "base": "origin/main", "head": "3f2a9c1", "flowModel": "...", "toolVersion": "...", "findings": 214, "blocking": 1, "waived": 12, "byTier": { "info": 0, "low": 40, "med": 150, "high": 20, "crit": 3, "known-exploitable": 1 }, "coverageIncomplete": false }
}
```

`because` says which rule of §5 made a finding block: `tier`, `class` or `rule`. Standard error gets
one line for the CI log, whatever the format:

    cobolwork build: fail; blocking 1 CRIT, 1 MED; advisory 150 MED, 40 LOW
    cobolwork build: pass (relaxed: options); advisory 3 MED

Four checks, each `true`, `false` or `null`:

| Check | Passes when | Fails when | Undecided when |
|---|---|---|---|
| `findings` | nothing blocks | something does; each is listed | - |
| `coverage` | the scans are complete, or the policy says `warn` | - | a scan is incomplete and the policy says `block` |
| `options` | every program's effective options generate the required checks, or the policy says `warn` | an option `forbid` names is set, a check the change removed, or under `block` a missing check | under `block`, a program's options cannot be worked out |
| `compile` | the compiler exited 0, or ironwork accepted every program | it exited non-zero, or ironwork rejected a program | no compiler was given, the verdict stopped it, or ironwork could not decide a program (§8a) |

The verdict is `fail` if any of the first three is `false`, otherwise `undecided` if any of them is
`null`, otherwise `pass`. `compile` decides exit 4, and with ironwork exit 3, not the verdict.
`relaxed` lists the checks that passed only because the policy says `warn` for them - `coverage`,
`options`, and `compile` for programs ironwork could not decide - so a pass that the
strict policy would not give is marked in the document, the provenance record, the SARIF run and the
summary line.

`reasons` follow `remediation-gate.md` §7: rule ids, the rule's own text, paths, lines, severities and
counts, never a finding's detail or source text, at most twenty, each through `printable`.

## 11. The rules the gate needs

Most of what a build should refuse is already reported: 152 rules on 2026-09-26, 97 of them routes
from outside input to a sink. Numeric data from outside used in arithmetic without a `NUMERIC` test is
one of those routes (`*-to-arithmetic`, with taint carried across `REDEFINES`). `ALTER` and
`GO TO … DEPENDING ON` are reported as `opaque-altered-control-flow`, which an estate can set to
`block`. What is missing is the family a build gate exists for, a program that carries on after
something failed, and the few statements that lose data without an abend.

### 11a. Carrying on after a failure

In each case the platform's default would have stopped the program, and the program opted out and
did not look:

- **A file with `FILE STATUS`.** With no error handling at all, an I/O error signals a severity-3
  condition that ends the run unit. Declaring the status key tells the runtime the program handles
  errors itself, so the run continues and testing the key is left to the program (IBM, *Handling
  errors in input and output operations*, Enterprise COBOL 6.4).
- **`EXEC SQL`.** Db2 never stops the program: every statement sets `SQLCODE` and returns, and
  `WHENEVER SQLERROR` defaults to `CONTINUE`.
- **`EXEC CICS` with `RESP` or `NOHANDLE`.** Without either, an exceptional condition takes CICS's
  default action, which for most conditions abends the task. With either, CICS returns and the
  program decides.

The rules pose one question: at the statement that relies on the result, has the status been tested
on every route since the statement that set it? The control-flow graph answers "does this fact hold
on every route to Z" (`lib/control.mjs`) and not "on every route after Y", so each rule asks it at Z:
the next statement that reads what Y wrote, or the next statement on the same file, cursor or CICS
resource. Four changes to the graph come first, and each has its own bench cases:

1. A file I/O statement writes its file's status field. Today a `READ` kills facts about the file's
   records and not about its status, so a status test made before a `READ` still counts after it.
2. A fact a rule adds through the `extra` hook is killed by a write to the field it names, as a
   built-in check is. Today such facts are never killed. `cics-signon-bypassed`, the one rule that
   uses the hook, must give the same bench results afterwards.
3. `SQLCODE` and `SQLSTATE` resolve to items written by every `EXEC SQL` when the program includes
   `SQLCA` and the tree does not hold it. Today they resolve only when a real `SQLCA` copybook is in
   the tree, and `INCLUDE SQLCA` declares nothing.
4. For a status field only, a comparison with a constant counts as a test. Today equality is not a
   restricting test, which is right for taint and wrong here: `IF WS-FS = '00'` is exactly the check.

| Rule | Set | Sev | CWE | Reported when |
|---|---|---|---|---|
| `io-status-unchecked` | `errors` | med | CWE-252 | a file declares `FILE STATUS`, no `USE AFTER ERROR` declarative covers it, and a route from an I/O statement on it reaches a read of its record, or the next I/O statement on it, without testing the status |
| `sql-status-unchecked` | `errors` | med | CWE-252 | a route from an `EXEC SQL` reaches a read of a host variable it wrote, or the next `EXEC SQL`, without testing `SQLCODE` or `SQLSTATE`, and no `WHENEVER SQLERROR GO TO` precedes it in the source. `WHENEVER` applies by position in the source, as the precompiler applies it, not by route |
| `cics-response-unchecked` | `errors` | med | CWE-252 | a command with `RESP(x)` or `NOHANDLE` and a route from it to a read of what it wrote, or the next `EXEC CICS`, that does not test `x`, `EIBRESP` or `EIBRCODE` |

### 11b. Losing data without an abend

These are routes, reported only where outside input reaches the statement, because a `STRING` of two
literals cannot overflow in a way anyone chose. Each is a new sink kind with rows for the sources a
caller controls: `argv-or-env`, `cics-terminal`, `cics-web`, `jcl-parm`, `jcl-instream` and
`file-record`.

| Sink kind | CWE | Reported when |
|---|---|---|
| `text-truncation` | CWE-222 | a `STRING` or `UNSTRING` with no `ON OVERFLOW` phrase; `NOT ON OVERFLOW` alone does not count |
| `numeric-truncation` | CWE-197 | a `MOVE` into a numeric item with fewer integer digits than the sender, or arithmetic with no `ON SIZE ERROR` into such an item. The parser keeps a picture's size in bytes and ignores `V`, so it has to keep integer and decimal digits first |
| `unhandled-selector` | CWE-478 | an `EVALUATE` with no `WHEN OTHER`, or a `GO TO … DEPENDING ON`, whose subject is the input: a value no branch names falls through and the program carries on |

### 11c. Credentials in the source

`credential-in-source`, in a new `secrets` set, high, CWE-798: the three COBOL shapes
`rules/gitleaks-mainframe.toml` already gives gitleaks (a credential in a `VALUE` clause, a password
in `EXEC SQL CONNECT`, a password in `EXEC CICS SIGNON`). Today a scan reports none of them, and the
build gate cannot depend on gitleaks being installed. One list of shapes serves both, and a test holds
the TOML file to it.

### 11d. Not proposed

- **A dynamic `CALL` without `ON EXCEPTION`.** A call that cannot be resolved abends without it, which
  is the outcome the gate wants. A variable target is already `*-to-dynamic-program-load`.
- **`PERFORM … THRU`** and uninitialised storage. Quality, not security, and `INITCHECK` does the
  second at compile time.

**A new rule warns until it is measured.** A rule in this section blocks under the default policy
only once `diag/measure-rules.mjs` has recorded its firing rate over the corpus, as a vendor pack must
before it loads. Until then the default policy treats it as `warn`, and an estate that wants it
blocking says so in `rules`. A gate that fails builds on a rule nobody measured is switched off the
first time the rule is wrong.

### 11e. What counts as a check on an index

An index in a subscript or a reference modification is bounded only where the check keeps it at 1 or
more as well as at or below the top of the table: both ends. Position counts from 1, so an upper
bound alone leaves 0, which addresses the entry before the table, and a reference-modification
length of 0 is a zero-length move that can overrun. A set of literal values bounds an index only if
every value is 1 or more. An `OCCURS DEPENDING ON` count and a loop bound accept 0, and an upper
bound alone bounds them.

An index written as a name plus or minus a whole constant, `T(I + 1)` or `X(I - 1 : 1)`, is judged on
the interval of `I` moved by that constant: the moved low end must be 1 or more and the moved top
must not pass the table or field. An unsigned whole-number `I` moved up starts at the constant even
where no check gave it a low end. Any other expression is judged as the bare name.

A counter of `PERFORM VARYING c FROM k BY s UNTIL ...` is at least `k` inside the loop when `k` is a
number or a constant the model resolves, or a field that is at least `k` where the loop starts, `s` is
not negative or is absent, and the field is a whole number. That lower bound joins the upper bound the
UNTIL gives. Any statement in the body that writes the counter other than by a rise, and any inner
`VARYING` or `AFTER` over it, takes the bound away.

A loop bound that input decides is credited when every subscript the loop's own body makes with the counter, and every other index in the same reference, is kept between 1 and the table's size by the loop's condition or the body's checks, the size being one number. The counter is then within the table whatever the bound is, so the credit does not depend on the route the input took. A second exit joined by `OR` gives that bound; exits joined by `AND` give none. A body that can run code outside itself, by `GO TO` or a `PERFORM` of a paragraph, counts every subscript the counter makes in the program, and a `PERFORM VARYING` of a paragraph is not credited by this rule.

An `OCCURS DEPENDING ON` count is judged at each statement that names its table, a part of it or a group holding it. A check credits it as far as the count is kept at or below the table's maximum; a check against a larger number lowers the finding one tier and stops nothing.

A lower bound of 1 or more survives an increment. A field set by `MOVE` to a whole constant that fits it,
or varied from one, stays at that bound through `ADD n TO`, `SET UP BY n`, `COMPUTE x = x + n` and the
`VARYING` step, where `n` is a literal or constant that is not negative or an unsigned number; the upper
bound is lost. Any other write takes the bound: `MOVE`, `SUBTRACT`, `SET DOWN BY`, `ACCEPT`, a `CALL`
by reference, `INITIALIZE`, `READ INTO`, and a write through a group or a `REDEFINES`. A sum past the
field's digits truncates, possibly to 0, so the bound survives an increment only where an upper bound
that leaves room for the most `n` can add holds before it, or `ON SIZE ERROR` leaves the field as it
was. An `n` that is a field counts as its largest value, and a bound the model cannot show leaves no
room. A performed paragraph's summary assumes no such room.

A lower bound of `k` or more, set by a `MOVE` of a whole constant from 0 up or held by an `INSPECT ... TALLYING` count starting from a constant, rises to `k + n` through `ADD n TO`, `SET UP BY n` and `COMPUTE x = x + n`, where `n` is a literal or constant of 1 or more, on the same terms as the survival above: an upper bound live before the increment that leaves room for the sum. `ON SIZE ERROR` leaves the field unchanged, so it raises nothing. A counter from 0 is at least 1 after its first `ADD 1` and is only 0 or more before it. The lower bound of a `VARYING` counter holds at the loop's own `UNTIL` test as well as in the body, together with the credit for operands to the left of a use in that condition; a counter varied from 0 is not bounded below there. A bound that a field is capped at in another paragraph is no fact on a route that does not pass through that paragraph, so a loop up to such a field is not bounded above by it.

A relation whose side is an arithmetic expression bounds each field in it that has coefficient 1 or -1,
where the rest of the expression is known: `+`, `-`, `*` by a constant, parentheses, constants,
`LENGTH OF x` and `FUNCTION LENGTH(x)` (the item's size). `A + B > K` failing bounds `A` at `K` less
the lowest `B` can be, which is 0 for an unsigned `B` and unknown for a signed one; `A - B` and
`A > B + k` need the highest `B`. A bound on `B` that only a check gives, `IF B > 100` before or after
`IF A > B`, joins the two: it holds until `A` is written, and is not made if `B` was written between
the checks. A constant the program moves into `B` does not count. An expression with a division, a
power, a product of two fields, a subscript or a non-numeric name, or a constant past 10^15, where the
compiler's intermediate precision could give way, bounds nothing. Such a bound joins the others that
hold at the use and can complete a bound, but an outcome that says something only this way does not
by itself lower a finding a tier.

An integer field an arithmetic statement writes holds the interval its operands give. `COMPUTE`, `ADD`,
`SUBTRACT`, `MULTIPLY` and `DIVIDE`, and a `MOVE` of a field, `FUNCTION LENGTH`, `LENGTH OF`,
`FUNCTION ORD` or `FUNCTION MOD`, leave the receiving field between the least and the greatest value
the expression takes, and the interval is a fact after the statement. An operand is bounded by the
tightest bounds among the facts that hold at the statement, or by its picture: `PIC 9(n)` is 0 to
10^n - 1, a signed picture is symmetric, and a binary field can hold what its bytes can. A constant is
itself; `FUNCTION LENGTH` of an item, or of `FUNCTION TRIM` of one, is 0 to the item's size, `LENGTH OF`
its size, `FUNCTION ORD` 1 to 256, and `FUNCTION MOD` by a divisor of 1 or more is 0 to one below the
divisor. Arithmetic is exact: a `COMPUTE` keeps the fraction of an intermediate quotient and truncates
once, when it stores, or rounds outward for `ROUNDED`; a quotient whose divisor has a prime factor other
than 2 and 5 is cut short in its last digit, so its interval widens, and it cannot be multiplied or
divided again. The interval is a fact only where the result fits the receiving picture and its binary
storage, so that nothing is truncated, wrapped or stored as an absolute value, and where no divisor can
be zero. A statement whose result can overflow bounds nothing, with or without `ON SIZE ERROR`, which
leaves the field as it was on the path that overflows. A statement with several receivers that one of
its operands overlaps, or with `REMAINDER` or `CORRESPONDING`, bounds nothing. The interval counts as a
bound for an index only where it lies between 1 and the sink's limit, as a constant moved into the
index does. A statement's interval is worked out from the facts that held at it on every route, so it
holds only where those facts held; a performed paragraph's summary carries only the intervals that need
none. An ordering test between two integer fields, `IF A < B` or `UNTIL A > B`, makes `A` at most the
greatest `B` can hold, and `B` at least the least `A` can hold, on the outcome that makes the relation
true. Every interval a fact rests on also gives every looser fact about the field, so routes that
reached different intervals meet at the looser.

A check that ran on every route and did not bound the index lowers an index finding (a rule ending
`-to-subscript`, `-to-reference-modification`, `-to-occurs-depending-count` or `-to-loop-bound`) one
step only where one of its outcomes holds on every route to the use. Where both outcomes reach the
use, the program carried on past a failed check, the index can be out of range there, and the
finding keeps its tier. For every other sink kind a check that ran lowers the finding one step. In
both, `guard` names the check and `guardedFrom` the tier it left.

A source's route reports one use per table and index name: the least checked, then the first in file
order. The uses left out are listed in the kept finding's `related` after the source, each with how far
it is checked, and `alsoUses` counts them. A line is credited no further than the least checked use on
it that any source reaches, whether the report lists that use or leaves it out.

The routes to `subscript` and `reference-modification` are data-mutation (§5a), so a false one fails a
build. The check model (`lib/control.mjs`) credits a check only where it has run on every route to
the use. A reading of six `cics-terminal-to-subscript` findings on 2026-09-27 found five false, from
four things the model did not read. Each becomes a fact the model holds where it is true on every
route, and nowhere else. Where the model cannot be sure, it claims nothing: no credit, and no code
called unreached.

- **An earlier operand of the same condition.** `IF WS-I > 0 AND WS-I <= 10 AND T(WS-I) = X`. A name
  used inside an `IF` or `UNTIL` condition is judged with what holds before the condition and what
  every operand evaluated before it said: the left side of an `AND` true, the left side of an `OR`
  false, through any `NOT`. A name more than one relation reads is judged by the weakest of them:
  `I <= 10 AND T(I) = 'A' OR 'B'` reads `T(I)` a second time with nothing guarding it. A subscript in
  an `UNTIL` is judged where the loop tests it, not before the loop starts. The order is documented:
  "evaluation of that hierarchical level terminates as soon as a truth value for it is determined",
  and "values are established for arithmetic expressions and functions if and when the conditions
  that contain them are evaluated" (*Enterprise COBOL for z/OS 6.4 Language Reference*, p. 286, "Order
  of evaluation of conditions", <https://publibfp.dhe.ibm.com/epubs/pdf/igy6lr40.pdf>; the 6.3 text
  and the 2009 ISO draft, §8.8.4.3, say the same). Where IBM's compiler places the `SSRANGE` check for
  `T(I)` in a later conjunct is not documented, and the same ISO draft resolves a statement's
  identifiers, subscripts included, as its first operation (§14.6.4); whether `SSRANGE(ABD)` can stop
  such a statement is unobserved on z/OS. Credit is right under either reading. The rules report input
  deciding where a program reads or writes; the element behind a false conjunct is at most read, never
  written, and cannot change the condition's value, so what remains is an abend, which is what
  `SSRANGE` is for. GnuCOBOL 3.2.0 was observed on 2026-09-27: compiled with `-debug`, with `I` at 20
  and a table of 10, the first condition above runs, and `T(I) = 'X' AND I <= 10` and the `OR 'B'`
  form stop with a subscript error.
- **A check that sets a flag.** `IF WS-I > 10 SET WS-ERR TO TRUE END-IF … IF NOT WS-ERR … T(WS-I)`.
  Where a test's failing branch assigns a flag a literal, by `MOVE` or by `SET` of a condition-name,
  the model holds *the flag has that value, or the field is within the bound the test's other outcome
  gives*. The test's other outcome makes it, as does any assignment of that value to the flag; any
  write to either field destroys it. A later test whose outcome says the flag does not hold that value
  turns it into the bound. On every route to that test one half was made and neither field written
  since, and the test rules the first half out. Values are compared only where nothing but the literal
  decides the comparison: an alphanumeric literal that fills an alphanumeric item, so `JUSTIFIED`
  cannot move it, compared with alphanumeric literals, and an integer that fits a numeric item,
  compared with numeric literals. `PIC 99` given `1` holds `01`, which is not `'1'`; `PIC XX JUSTIFIED
  RIGHT` given `'Y'` holds `' Y'`. A write is any write to the bytes, through a `REDEFINES` of the
  whole record or a `RENAMES` as much as by name. Which flags to follow is read from the failing
  branch's own statements, so a flag set in a paragraph it performs is not followed; that limits what
  is credited, not whether it is true. The bound is destroyed by every write that destroys its
  premise, and the test that yields it writes nothing, so a performed paragraph's summary stays sound.
  A flag moved from a constant item, a level-78 name or a `VALUE` item no statement writes that fills
  the flag exactly, holds that item's value as a literal does. The check and the flag may sit in a
  performed paragraph or section: the fact crosses the `PERFORM` in the summary, and a `GOBACK` or
  `STOP RUN` on the failing branch leaves the run for every caller. A `GOBACK` in a nested program
  returns to its caller, which keeps its use.
- **An `INSPECT … TALLYING` count.** A count holding a constant *n* before `INSPECT F TALLYING count`
  holds between *n* and *n* plus the length of F after it. Each comparison cycle adds at most one to a
  count and moves past at least one character position of F (Language Reference 6.4, `INSPECT`,
  "Comparison cycle"). The count's value is known only where a `MOVE` of the constant comes first on
  every route, earlier in the same paragraph, with nothing between that writes the count's storage or
  can be entered other than from the statement before it - no label, `ENTRY`, `NEXT SENTENCE`,
  `PERFORM`, `CALL`, `UNSTRING` or other tally - and where the count has the digits to hold *n* plus
  that length. F is a data item, or `FUNCTION REVERSE`, `UPPER-CASE`, `LOWER-CASE` or `TRIM` of one; a
  reference-modified F gives no bound. This bound is the program's data, not a check it made, so it
  counts only where it keeps the index in range for its own sink: at least 1, and at most the entries
  of a one-dimensional table of fixed size, or the length of the item a reference modification
  starts in. A count of commas in an 80-byte line is no bound on a table of 10, and a count from zero
  can stay zero, which no subscript or reference modification may be.
- **A sink no route reaches.** A statement no route reaches from an entry - the first statement after
  `END DECLARATIVES`, or of the program where there are none, an `ENTRY` statement, a paragraph that
  `HANDLE CONDITION`, `HANDLE AID`, `HANDLE ABEND` or `EXEC SQL WHENEVER … GO TO` names, a declarative -
  does not run. A route to a sink there is reported at INFO, marked `unreached`, in no consequence
  class, and asserts no defect. Reach is worked out from the control-flow graph alone, not from the
  facts, and the graph must over-approximate control, so every way in it lacked is added before the
  claim is made: a `SORT` or `MERGE` performs its input and output procedures; a conditional phrase
  - `NOT AT END`, `NOT ON EXCEPTION` - begins at its own words, whatever the phrase before it ends
  with; a `PERFORM` returns once anything reaches the end of its range, a handler's label inside it
  included; `CALL 'CEE3DMP'` returns; an `EXEC CICS RETURN` or `XCTL` with `RESP` or `NOHANDLE`, or in
  a program that issues `IGNORE CONDITION`, can come back to the next statement, and in a program
  that issues `HANDLE CONDITION` reach assumes it may. An `EXIT PROGRAM` with no `CALL` active carries
  on to the next statement (Language Reference 6.4, `EXIT PROGRAM`); only reach follows those last
  two, so a check that ends in one still turns a value away where the program runs as intended. A
  `GO TO` the graph cannot resolve goes to every paragraph, as does every `GO TO` in a program that
  uses `ALTER`, and a `PERFORM` of a paragraph it cannot find returns having done anything. Nothing in
  a program is called unreached where it uses `ALTER`, where a `PERFORM`, `GO TO` or `SORT` names a
  paragraph the parse did not find or found twice, or where the analysis stopped at a step limit. What
  remains is code behind `STOP RUN`, `GOBACK`, `EXEC CICS RETURN` or a `PERFORM` that never returns,
  and paragraphs nothing performs or falls into.

A table indexed by the same name at several statements was one sink, at the first. Judged per use,
the first can be the guarded or the dead one and hide a later use that is neither. Every use of a
subscript or reference modification is now a sink, and the route from one source to one table
through one name is reported once, at its least-checked reachable use. A loop bound and an
arithmetic operand are the same: every use a sink, one reported per source and name. The check named
on a stopped route is one whose outcome alone makes the value safe, where there is one.

**Measured.** Over the 500-repository corpus on 2026-09-27, against `main` at 30d9149, findings at
their tier, and routes a check stops:

| Rule | Findings before | after | at INFO after | Checked before | after |
|---|---|---|---|---|---|
| `cics-terminal-to-subscript` | 25 | 7 | 3 | 22 | 37 |
| `cics-terminal-to-reference-modification` | 9 | 6 | 0 | 2 | 5 |
| `argv-or-env-to-reference-modification` | 48 | 54 | 0 | 11 | 5 |
| `cics-terminal-to-arithmetic` | 81 | 78 | 3 | 2 | 2 |
| `jcl-instream-to-arithmetic` | 241 | 239 | 6 | 0 | 0 |

The other subscript, reference-modification, loop-bound and `OCCURS DEPENDING ON` rules did not
move. Every finding that left its tier was read, 29 in all: twelve were bounded by a flag (CardDemo's
two menus, six copies each), six by an earlier operand of their condition, three by a tally, and
eight are in code that does not run - a program that performs its own first paragraph and so never
returns from it, and two paragraphs nothing performs. The seven
`argv-or-env-to-reference-modification` routes that stopped being checked read a field inside an
`UNTIL` whose index the loop increments until the input shows a space: the check that credited them
described the index before the loop began, and the index is the input's to choose. Two other routes
rose from MED to HIGH for the same reason, and are false in a way the model does not read: a
`VARYING` counter restarted from a constant and counting down.

## 12. Invariants

1. **B-I1** No model, network request or clock decides a verdict. Advisory feeds and the known
   exploited list are files; `SOURCE_DATE_EPOCH` touches only the provenance record.
2. **B-I2** Incomplete coverage never passes under a policy that says `block`, and a floor that says
   `block` cannot be relaxed by the repository.
3. **B-I3** In ratchet mode the change is judged by its base's policy, baseline and site file.
4. **B-I4** A repository policy never loosens the floor.
5. **B-I5** Nothing the reviewed tree supplies is executed: the compiler is resolved outside it, no
   shell reads the argument vector, and git is used as `diff` uses it.
6. **B-I6** The same inputs give the same document and the same provenance bytes, when the scans are
   complete.
7. **B-I7** A forbidden compiler option is refused, never removed.
8. **B-I8** An expired waiver covers nothing.
9. **B-I9** No output carries source text or a finding's detail.
10. **B-I10** An option that reports a failed check and continues never satisfies a required check.
11. **B-I11** Every defect rule has a consequence decision, and a finding's tier and classes come
    from its rule and the published record, never from its detail text.

## 13. Specification (BDD)

Every scenario builds a git repository from this repository's fixtures and commits the base.

### B1 - The policy

#### B1.1 With no policy the defaults apply
    Given a repository with no cobolwork.policy.json
    When  a program holds a high finding
    Then  in absolute mode the verdict is fail

#### B1.2 A policy that does not validate stops the gate
    When  cobolwork.policy.json names a severity that does not exist
    Then  the gate exits 2 and compiles nothing

#### B1.3 The repository cannot loosen the floor
    Given a floor with block high
    When  the repository policy says block crit
    Then  a high finding blocks, and policy.ignored names the key

#### B1.4 A floor inside the repository is refused
    When  --policy names a file inside the repository
    Then  the gate exits 2

#### B1.5 A rule set to block blocks below the threshold
    When  the policy sets a low rule to block and the change introduces it
    Then  the verdict is fail

#### B1.6 A rule set to warn never blocks
    When  the policy sets a high rule to warn
    Then  it is reported and the verdict is pass

#### B1.7 A MED finding in no consequence class is advisory
    Given a job whose FTP step sends in cleartext, a MED finding in neither class
    Then  it is listed with tier med and blocking false, and the verdict is pass

### B2 - The modes

#### B2.1 Ratchet mode passes an old finding and fails a new one
    Given a base holding one high finding
    When  the change adds a second
    Then  the second blocks, the first does not, and the verdict is fail

#### B2.2 Rewording a flagged line does not make its finding new
    When  the change rewords the line of an old high finding and the route still reaches it
    Then  the verdict is pass

#### B2.3 A finding at the always severity blocks wherever it is
    Given a base holding one critical finding
    When  the change touches nothing near it
    Then  the verdict is fail

#### B2.4 The change is judged by the base's policy
    When  the change lowers block to crit in cobolwork.policy.json and adds a high finding
    Then  the verdict is fail, and configurationChanged names the policy

#### B2.5 A waiver the change adds does not cover the change
    When  the change adds a high finding and a baseline entry accepting it
    Then  the verdict is fail

#### B2.6 A site-file change does not switch a rule off for the change that makes it
    When  the change edits cobolwork.site.json so a site-gated rule stops firing, and adds its finding
    Then  the finding blocks

#### B2.7 Absolute mode blocks every finding at the threshold
    Given a repository holding one high finding and no waiver
    Then  in absolute mode the verdict is fail

### B3 - Waivers

#### B3.1 A live waiver covers its finding
    Given a waiver for a high finding expiring in thirty days
    Then  the finding is listed as waived and the verdict is pass

#### B3.2 An expired waiver covers nothing
    Given the same waiver, expired
    Then  the finding blocks and is listed as expired

#### B3.3 A waiver written further out than maxDays covers nothing
    Given a waiver written with an expiry two years off and maxDays 180
    Then  the finding blocks

#### B3.4 --no-baseline makes every waiver inert
    Then  the waived finding blocks

### B4 - Coverage

#### B4.1 Incomplete coverage is undecided under the default policy
    When  a program copies a copybook the tree does not hold
    Then  coverage is null, the verdict is undecided and the gate exits 3

#### B4.2 coverage warn lets the verdict be decided
    When  the policy says coverage warn
    Then  the verdict is pass and the document names the incomplete set

#### B4.3 A floor that blocks on coverage wins
    When  the floor says block and the repository says warn
    Then  the verdict is undecided

#### B4.4 A copy library from outside the tree completes the coverage
    Given a program that copies a copybook the tree does not hold, and --copylib naming a directory that does
    Then  coverage is true, and the provenance record names the library

#### B4.5 A copy library that is not a directory is refused
    When  --copylib names a path that does not exist
    Then  the gate exits 2

### B5 - Run-time checks and compiler options

The scenarios that read options run under `"options": "block"`; B5.15, B5.16, B5.20, B5.21 and B5.22
are about what the default, `warn`, does with them.

#### B5.1 NOSSRANGE in a CBL statement fails the options check
    Given an Enterprise COBOL program whose CBL statement says NOSSRANGE
    Then  options is false and the reason names the program, the option and the CBL level

#### B5.2 A CBL statement overrides the estate default
    Given compilerOptions NOSSRANGE in the site file and SSRANGE on the program's CBL statement
    Then  options is true

#### B5.3 SSRANGE(MSG) does not satisfy the subscript check
    Given a program whose CBL statement says SSRANGE(MSG)
    Then  options is false

#### B5.4 A bare PARMCHECK does not satisfy the argument-length check
    Given a program whose CBL statement says PARMCHECK
    Then  options is false and the reason names MSG

#### B5.5 A program with no known options is undecided
    Given no compilerOptions and no compile step naming the program
    Then  options is null

#### B5.6 A missing GnuCOBOL check is added as its -fec option
    When  the compiler is cobc with no -fec and no -debug
    Then  -fec=EC-BOUND-SUBSCRIPT and the other required checks are appended after the caller's arguments, and optionsAdded lists them

#### B5.7 -debug satisfies every GnuCOBOL check
    When  the compiler's arguments include -debug
    Then  optionsAdded is empty and options is true

#### B5.8 A forbidden GnuCOBOL option is refused, not removed
    When  the compiler's arguments include -fno-ec
    Then  options is false and the compiler does not run

#### B5.9 A check the pinned GnuCOBOL cannot generate fails
    Given a build that pins GnuCOBOL 3.1 and a policy requiring argument-length
    Then  options is false and the reason names 3.2

#### B5.10 A JCL compile step's PARM decides the options of the member it compiles
    Given EXEC PGM=IGYCRCTL,PARM='NOSSRANGE' with SYSIN naming member P, and P.cbl in the tree
    Then  options is false and the reason names the compile step

#### B5.11 A compile procedure's PARM.COBOL applies to the member COBOL.SYSIN names
    Given EXEC IGYWCL,PARM.COBOL='SSRANGE' with COBOL.SYSIN naming member P, and no site file
    Then  options is true

#### B5.12 A build script's cobc command without the checks fails the options check
    Given a Makefile whose rule runs $(COBC) $(FLAGS) prog.cbl with neither -fec nor -debug
    Then  options is false and the reason names the Makefile and the line

#### B5.13 A build script's cobc command with -debug passes
    Given a shell script that runs cobc -x -debug prog.cbl
    Then  options is true

#### B5.18 A compile step silent on SSRANGE leaves it to the installation's default
    Given EXEC PGM=IGYCRCTL,PARM='LIB' compiling member P, and no site file
    Then  options is null, because an installation can change IBM's default

#### B5.19 A procedure in the tree takes its member from the caller, and PARM=(…) is a list
    Given a procedure whose IGYCRCTL step reads SYSIN DSN=SRC.LIB(&MEM), and a job running it with MEM=P and PARM.COBL=(LIB,NOSSRANGE)
    Then  options is false and the reason names NOSSRANGE for P.cbl

#### B5.15 options warn decides a build whose options nothing declares
    Given a program with no option card, no compile step and no build script, and the policy options warn
    Then  options is true, a reason says the options are unknown, and the verdict is pass

#### B5.16 Under the default policy a build without the checks passes relaxed
    Given a Makefile running cobc with neither -fec nor -debug, a program whose CBL statement says NOSSRANGE, and no policy file
    Then  the verdict is pass, relaxed is [options], the reasons name the Makefile, and the summary line says pass (relaxed: options)

#### B5.20 An option the policy forbids fails under warn
    Given a program whose CBL statement says NOSSRANGE, and a policy whose forbid.enterprise lists NOSSRANGE
    Then  options is false and the verdict is fail

#### B5.21 A change that removes a check the base generated fails under warn
    Given a build script running cobc -x -debug at the base, and cobc -x after the change
    Then  the verdict is fail, and the reason names the script and the check

#### B5.22 A build with no checks that the change leaves alone passes relaxed in ratchet mode
    Given a build script running cobc without checks at the base, and changed in a way that adds none
    Then  the verdict is pass and relaxed is [options]

#### B5.17 A floor that blocks on unknown options wins
    When  the floor says options block and the repository says warn
    Then  the verdict is undecided

#### B5.14 An editor's task file and a script with no extension are build scripts
    Given a .vscode/tasks.json task running cobc without checks, and a script named run holding cobc -x -debug
    Then  options is false, and the reason names the task file

#### B5.23 A task's command line is read command by command, with its arguments and its Windows variant
    Given a tasks.json with a comment and trailing commas, whose task runs mkdir -p bin && cobc -x -free -o bin/prog with ${workspaceFolder}/prog.cbl in its args, and whose Windows variant runs the same cobc after a PowerShell test
    Then  options is false, and the reasons name both lines

#### B5.24 A Makefile's compiler and options reach the command through the variables it assigns
    Given COBC ?= cobc then COBC ?= gcobol, FLAGS := -x then FLAGS += -debug, and the recipe PATH="…" ${COBC} $(FLAGS) prog.cbl
    Then  options is true

#### B5.25 A cobc command that names no source compiles nothing
    Given a script holding command -v cobc, echo "cobc is not on PATH…", cobc --version and cobc -x -debug prog.cbl
    Then  options is true

#### B5.26 A missing gcobol check is added as its -fcobol-exceptions option
    When  the compiler is gcobol with no -fcobol-exceptions
    Then  -fcobol-exceptions=EC-BOUND-REF-MOD and -fcobol-exceptions=EC-BOUND-SUBSCRIPT are appended after the caller's arguments, and optionsAdded lists them

#### B5.27 gcobol's -fno-cobol-exceptions withdraws only the conditions it covers
    When  the compiler's arguments are -fcobol-exceptions EC-BOUND -fno-cobol-exceptions EC-BOUND-SUBSCRIPT
    Then  options is true and nothing is added
    When  they are -fcobol-exceptions EC-ALL -fno-cobol-exceptions EC-ALL -fcobol-exceptions EC-BOUND-REF-MOD
    Then  options is false, the reason names the subscript check, and the compiler does not run

#### B5.28 A check gcobol does not implement fails, and is not added
    Given a policy requiring numeric-data
    When  the compiler is gcobol with -fcobol-exceptions=EC-ALL
    Then  options is false, the reason names EC-DATA-INCOMPATIBLE, and optionsAdded is empty

#### B5.29 A build script's gcobol command is read as cobc's is
    Given a Makefile whose CBLC ?= gcobol-16 runs $(CBLC) -o prog prog.cbl, and a script running aarch64-linux-gnu-gcobol -fcobol-exceptions ec-bound -o prog prog.cbl
    Then  options is false, the reasons name the Makefile's line and -fcobol-exceptions, and none names the script

#### B5.30 An option forbid.gcobol names is refused
    Given a policy whose forbid.gcobol lists -fdefaultbyte
    When  the compiler is gcobol with -fdefaultbyte=0
    Then  options is false and the compiler does not run

### B6 - The compiler

#### B6.1 A compiler inside the repository is refused
    Given a PATH whose only cobc is inside the repository
    Then  the gate exits 2

#### B6.2 A fail compiles nothing
    Given a compiler that records whether it ran
    When  the verdict is fail
    Then  it did not run

#### B6.3 A compiler that fails after a pass exits 4
    Given a compiler that exits 1
    When  the verdict is pass
    Then  the gate exits 4 and compiled holds the status

#### B6.4 No shell reads the arguments
    When  an argument is the text ; touch marker
    Then  no file named marker exists afterwards

#### B6.5 ironwork checks every program after a pass, with the tree's copy directories
    Given two programs and a copybook directory, and an ironwork that accepts both
    Then  the gate exits 0, compile is true, and each run named the copybook directory with -I

#### B6.6 A program ironwork rejects exits 4, and its message quotes no literal
    Given a program ironwork rejects with a message quoting a literal
    Then  the gate exits 4, compile is false, and failed names the program, line and message with the literal replaced

#### B6.7 A construct ironwork does not model yet leaves the build undecided
    Given a program ironwork refuses as not supported yet
    Then  the gate exits 3 and compile is null
    And   under coverage warn the gate exits 0 with compile in relaxed
    And   a statement verb ironwork stops at, or a field a translator declares, is not modelled either

#### B6.8 A fail runs no ironwork
    Given a finding that blocks
    Then  ironwork did not run and compiled is null

#### B6.9 An ironwork inside the repository is refused, and so is naming a compiler too
    Given an ironwork inside the repository, or --ironwork with --
    Then  the gate exits 2

#### B6.11 A program with warnings only compiles; errors are read past warning and informational lines
    Given a program ironwork checks at 4 with a warning, and one at 8 with an error, a warning and an informational line
    Then  the first counts as accepted and warned, and the second fails naming only its error

#### B6.10 A copybook no library holds leaves the program unresolved, not failed
    Given a program ironwork reports copying a member the copy libraries do not hold
    Then  compile is null and unresolved names the program

### B7 - What the gate emits

#### B7.1 No output carries source text
    Given a program whose statements hold a marker string
    Then  neither the document nor the provenance record contains it

#### B7.2 The same inputs give the same bytes
    When  the gate runs twice with SOURCE_DATE_EPOCH unset
    Then  the documents are identical and the provenance records are identical

#### B7.3 SARIF marks the blocking findings as errors
    When  --format sarif and one finding blocks
    Then  that result has level error and the others do not

#### B7.4 The exit status is the verdict
    Then  pass exits 0, fail 1 and undecided 3

#### B7.5 The spec and the suite name the same scenarios

### B9 - Tiers and consequences

#### B9.1 A vulnerability CISA lists as exploited is KNOWN-EXPLOITABLE and blocks wherever it is
    Given an estate declaring a runtime version, and an advisory feed naming a CVE in the catalogue against it
    When  the base already held the finding and the change touches nothing near it
    Then  its tier is known-exploitable and the verdict is fail

#### B9.2 A MED file name taken from a file record blocks as privilege escalation
    When  the change adds a program that opens a file named by a record it read
    Then  the finding blocks with tier med, class privilege-escalation, because class

#### B9.3 Input that chooses a table row mutates data until SSRANGE abends
    Given input from the command line used as a subscript
    Then  the finding is data-mutation; with SSRANGE declared it is not; with SSRANGE(MSG) it still is

#### B9.4 Every defect rule has a consequence decision

#### B9.5 A repository without a floor can make the classes advisory
    When  the repository policy says classes is empty
    Then  the MED file name taken from a file record is advisory and the verdict is pass

#### B9.8 A vendored SQLCA laid out as IBM's is in neither class, and a doctored one escalates
    Given a repository SQLCA.cpy whose fields sit where Db2 documents them, copied by a program
    Then  copybook-shadows-system is low and in neither class; with SQLCODE moved it is med and privilege-escalation

#### B9.9 A command-line file name escalates only under an entry the estate names privileged
    Given a program that opens the file its command line names, started by a job step
    Then  the finding is low and in neither class; with the job named in privilegedJobs it is high and privilege-escalation

#### B9.7 A transfer to a program a variable names blocks only when input chooses the name
    Given an EXEC CICS XCTL to a program a variable holding a literal names
    Then  the finding is MED, in neither class, and advisory

#### B9.6 The CI line names the verdict and counts blocking and advisory findings by tier
    Then  standard error holds one line with the verdict, the blocking tiers and the advisory tiers

### B8 - The new rules

Each is also a positive and a negative bench case under `bench/cases/`.

#### B8.1 A FILE STATUS never tested before the record is read is reported
    Given a READ of a file with FILE STATUS, and a MOVE from its record with no test between
    Then  io-status-unchecked is reported

#### B8.2 A FILE STATUS tested on every route is not
    When  an IF WS-FS NOT = '00' that ends the run stands between the READ and the MOVE
    Then  io-status-unchecked is not reported

#### B8.3 A status test made before the I/O does not count after it
    When  the test stands before the READ and not after it
    Then  io-status-unchecked is reported

#### B8.4 A file with no FILE STATUS is not reported
    Given the same program with the FILE STATUS clause removed
    Then  io-status-unchecked is not reported

#### B8.5 A USE AFTER ERROR declarative covers its file
    Given a declarative for the file and no status test
    Then  io-status-unchecked is not reported

#### B8.6 An EXEC SQL whose SQLCODE is never tested is reported
    Given a SELECT INTO whose host variable is then moved, with no test of SQLCODE
    Then  sql-status-unchecked is reported, whether or not SQLCA is in the tree

#### B8.7 WHENEVER SQLERROR GO TO covers what follows it, and CONTINUE does not
    Then  with WHENEVER SQLERROR GO TO before the SELECT it is not reported, and with CONTINUE it is

#### B8.8 An untested RESP is reported and a command without RESP is not
    Given a READ with RESP(WS-RESP) and a MOVE of its INTO field with no test
    Then  cics-response-unchecked is reported, and not for the same READ without RESP or NOHANDLE

#### B8.9 cics-signon-bypassed is unchanged by killable facts
    Then  its bench cases give the results they gave before

#### B8.10 A STRING of terminal input with no ON OVERFLOW is reported
    Then  cics-terminal-to-text-truncation is reported, and not with ON OVERFLOW

#### B8.11 A MOVE of input into fewer integer digits is reported
    Given PIC 9(7)V99 moved into PIC 9(5)V99
    Then  numeric-truncation is reported, and not into PIC 9(7)V9

#### B8.12 An EVALUATE of input with no WHEN OTHER is reported
    Then  unhandled-selector is reported, and not with WHEN OTHER

#### B8.13 A password in a VALUE clause is reported, and the gitleaks file holds the same shapes
    Then  credential-in-source is reported, and rules/gitleaks-mainframe.toml holds every shape the set does

## 14. Out of scope, deliberately

- **Signing the provenance record.** Key custody is the pipeline's.
- **Submitting a z/OS compile.** The gate checks the options an Enterprise COBOL build declares and
  says where to change them. It does not run IGYCRCTL, and has no adapter for IBM Dependency Based
  Build.
- **Caching the base scan.** Ratchet mode scans the base on every run. A cached report of `main` would
  halve that, and would be a file the gate has to trust; that is a later decision with its own
  integrity question.
- **Fixing anything.** The remediation pipeline drafts, and `gate` disposes.
- **Enforcement while the program runs**, beyond the checks the compiler generates. Allow-lists of
  what a program may call or open need a runtime, and are not a lint.

## 15. Execution plan

Tracked as the `cobolwork-build-gate` plan.

| Step | Delivers | Needs |
|---|---|---|
| 1 | This specification | - |
| 2 | The policy: schema, loader, the two layers, the hash; the base revision's copy in ratchet mode | 1 |
| 3 | The verdict over one scan: `findings`, `coverage`, `waivers.maxDays`, exit status | 2 |
| 4 | `cobolwork build`: ratchet mode through `diff`'s two scans and `gate`'s pairing, the compiler, provenance, SARIF | 3 |
| 5 | Effective options per program: site defaults, compile-step `PARM`, `CBL`/`PROCESS`, build scripts' `cobc` commands, suboptions and abbreviations; the `options` check. Landed 2026-09-27 except the pinned-version check (B5.9) | 2 |
| 6 | §11a: the four graph changes, then the `errors` set | 1 |
| 7 | §11b: integer and decimal digits in the parser, then the three sink kinds | 1 |
| 8 | §11c: the `secrets` set and the shared shape list | 1 |

Each rule step raises `CATALOGUE.size` in `test/feed.test.mjs`, adds its bench pair, and records a
corpus measurement before the default policy lets the rule block.

## 16a. The 500-repository census

`diag/build-corpus.mjs` runs the gate over a corpus, one repository at a time, in absolute mode with no
compiler, and writes one line per repository. Over the 500 held-out repositories on 2026-09-27, with
`COBOLWORK_FREE_MEMORY_MB=12288`:

| | Before the option readers | After them, and the two rules taken out of the classes (§5a) |
|---|---|---|
| pass | 29 | 29 |
| fail | 85 | 121 |
| undecided | 386 | 350 |
| options unknown | 468 | 402 |
| options refused | 1 | 65 |

The readers decided the options of 65 repositories that had none. 64 refuse, because the build the
repository declares compiles without the checks: a Makefile, script or task running `cobc -x` with
neither `-fec` nor `-debug`. That is the gate reporting what the build does. The run first counted 15
more as refused, where JCL or an option card compiled a program without naming `SSRANGE`. Those are
the installation's default, which only the site file declares, so they are unknown; the columns
above are recomputed from the run's rows for that change.

What keeps the other 350 undecided:

- **Options.** Most of the 402 repositories still unknown say nothing anywhere about how they are
  compiled; the rest hold option cards or compile steps that do not name `SSRANGE`, or JCL whose
  compiled member is still symbolic. An estate closes this with one line of `cobolwork.site.json`,
  and a scan of code whose build it does not own can say `"options": "warn"`; 273 repositories were
  undecided on options alone.
- **Coverage, 131.** A copybook the programs include is not in the repository (69), the parse missed
  a declaration or did not read a program whole (50), or JCL was read in part (26). The parse and JCL
  causes are the items `BACKLOG.md` records from the same corpus.

## 16. What the implementation may not take

cobolwork is offered under AGPL-3.0-or-later and, on application, under PolyForm and commercial
terms ([`LICENSING.md`](../../LICENSING.md)). GPL-3.0 material in the tree would block the second
two, because GPL §10 forbids adding the restrictions those licences are made of.

- **Nothing from GnuCOBOL's source tree.** No table, list or text from `cobc/flag.def`,
  `cobc/config.def`, `libcob/exception.def`, the `config/*.words` files, `cobc --help` or the manual
  enters the repository, in code, fixtures or comments. The exception-condition names are already
  attested by ISO drafts in `provenance/words.json`. The handful of `cobc` option names the gate
  reads (`-debug`, `-fec=`, `-fno-ec`, `-fnotrunc`, and `-o`, `-I`, `-L`, `-l`, `-A`, `-Q`, whose
  values are not source files) are
  recorded with the attesting document , and what each does is established by compiling, as
  in §7.
- **`cobc` runs as a separate program.** The gate passes it arguments and reads its exit status.
  Nothing links to it or loads it.
- **IBM's option names and meanings** are interface facts of the kind `lib/words.mjs` already takes
  from IBM's manuals. When they enter code, the IBM entry in
  [`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md) names the Enterprise COBOL Programming
  Guide as their source. No IBM prose is copied; the reasons are cobolwork's own words.
- **Fixtures are written for this repository.** No program from the corpus becomes a bench case or a
  test fixture. Most corpus repositories carry no licence, and one under GPL would be the
  `lib/words.mjs` problem again. A permissively licensed file may be used only with its notice, as
  the CardDemo fixtures are. A corpus measurement records counts, rule ids and paths, never source.
- **The credential shapes are cobolwork's own.** `rules/gitleaks-mainframe.toml` has one author, and
  loads none of gitleaks' defaults (`useDefault = false`). The shared list takes nothing from
  gitleaks' own rules, which are MIT and would need a notice.
- **The provenance record's shape is written here**, not vendored. If an in-toto schema is ever
  copied into `schema/`, it is Apache-2.0 and gets a notice, as CardDemo does.
