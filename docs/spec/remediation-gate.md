# The remediation gate

A specification for `cobolwork gate`, the deterministic check a drafted fix must pass before a person
is asked to apply it, and the check that later confirms the fix held. The scenarios below are the
tests: each `#### <id>` heading is the name of exactly one test, and `test/gate.test.mjs` fails if a
heading has no test or a test names a heading that is not here.

Status: built. Every scenario below has its test in `test/gate.test.mjs`.

---

## 1. Why this exists

The remediation pipeline (the "Now and Next" design) has a model propose a patch and a deterministic
gate dispose of it. `cobolwork diff --base` already compares two trees, so the gate looks like a
reading of its output. It is not, for two reasons.

**The identity of a finding includes its line's text.** A fingerprint hashes the rule, the named
scope, the subject and the statement's code text (`lib/kernel/identity.mjs`). That is right for a
report, where code moving above a finding must not change it. For a patch it means that editing the
flagged statement itself - `CALL 'SYSTEM' USING WS-CMD` reworded, the route left intact - reads in
`diff` as the target resolved and an unrelated finding introduced.

**A finding can leave a report without being fixed.** Each of these makes the target disappear from
`diff`'s comparison, and none is a fix:

- the scan of the patched tree stopped at the memory reserve, which on this project's machine is
  common, not rare;
- the patch removed the site-file fact a rule needs, so the rule did not run;
- the patch added a baseline entry that suppresses the target;
- the patch deleted the program;
- the patch deleted the flagged statement, or the statement the input comes from, so the program no
  longer does what it did;
- the patch routed the value through something the flow engine does not follow, so the route is
  still there and the engine no longer sees it.

The gate therefore passes only a disappearance it can explain, and says which explanation it
accepted. Anything it cannot explain goes to a person as undecided. It never guesses toward pass.

The same command is the pipeline's last step. Run on the merged revision against the one before
it, a pass is what `verified-fixed` means.

## 2. Ubiquitous language

The terms of [`ruleset-contract.md`](ruleset-contract.md) §2 and [`tui.md`](tui.md) §2 stand. This
adds:

| Term | Meaning |
|---|---|
| **target** | The finding the patch is meant to fix, named by its fingerprint in the base revision |
| **patch** | The difference between the base revision and the head: a revision, or the working tree |
| **inserted line** | A line of the head the line diff (§8) says the patch wrote |
| **deleted line** | A line of the base the line diff says the patch removed. A reworded line is both: deleted from the base, inserted in the head |
| **pairing** | Recognising one finding in both trees when its fingerprint changed because its line was edited |
| **outcome** | What happened to the target: one of the eight in §5 |
| **verdict** | `pass`, `fail` or `undecided`, from the checks in §4 |
| **reason** | A sentence saying why a check did not pass, written for the drafter's next attempt |

## 3. The command

```
cobolwork gate <repo> --base <ref> [--head <ref>] --target <fingerprint> [--ironwork <path> | --cobc <path>] [--exit-code]
```

- `--head` defaults to the working tree, as `diff` does: tracked files and untracked ones git does
  not ignore. The pipeline applies a draft in a scratch worktree and gates that worktree.
- The output is one JSON document (§7). There is no SARIF form: a verdict is not a list of findings.
- Exit 0 means the gate ran, whatever the verdict. Exit 2 means it could not run: not a git
  repository, a revision that does not resolve, a fingerprint the base does not hold, or `--repos`.
  The verdict is in the document, so a crash is never read as a fail.
- `--exit-code` is for a caller that reads only the exit status: 0 pass, 1 fail, 3 undecided, and
  2 still could-not-run.
- `--target-only` is for step 9, the resweep of a later revision: only the `target` and `coverage`
  checks decide. A branch that others committed to since the fix holds their findings and their
  layout changes, and those are not the fix's to answer for. The gate's own run keeps all seven.
- `--only`, `--repos`, `--baseline` and `--no-baseline` are refused. Every rule set runs on both
  sides, or a finding the patch adds in a set left out goes unseen; and a suppression is not a fix,
  so the gate reads findings as the engine reports them.
- Gate a revision rather than a working tree that anything else can write to. The scan, the line
  diff and the compiler each read the head, at different moments, and a file that changes between
  them makes the document describe a state that never existed whole. The pipeline commits the
  draft in its scratch worktree and passes `--head <sha>`; the working tree is for a person at a
  terminal.

## 4. The verdict

Seven checks. Each is `true` (passed), `false` (failed) or `null` (could not be decided).

| Check | Passes when | Fails when | Undecided when |
|---|---|---|---|
| `target` | its outcome is one §5 accepts | its outcome is one §5 refuses | its outcome is one §5 leaves to a person |
| `added` | the head holds no finding the base did not, after pairing (§6) | it does; each is named | - |
| `layout` | no program the patch did not edit has a field that moved, and no interface record moved | either happened | - |
| `calls` | no program calls or transfers to a program it did not before, and no new call target is a variable | either happened | - |
| `configuration` | the patch leaves `cobolwork.site.json` and `cobolwork.baseline.json` as they were | it changes either | - |
| `coverage` | both scans are complete and every rule set that ran on the base ran on the head | - | either scan is incomplete, or a set ran on the base and not on the head |
| `compile` | every program file the patch changed compiles if it compiled before | one compiled before and does not now | no compiler, or it failed before and after (`compiled` says which) |

The verdict is `fail` if any check is `false`, otherwise `undecided` if any check other than
`compile` is `null`, otherwise `pass`. `compile` alone being `null` does not stop a pass, because
most machines that run this have no COBOL compiler. The document then says `not compiled`, and "not
compiled" is never read as "compiles".

## 5. What happened to the target

Tried in this order; the first that holds is the outcome.

| Outcome | When | `target` |
|---|---|---|
| `still-reported` | the head holds a finding with the target's fingerprint, or one paired with it (§6), at the same severity or higher | `false` |
| `lowered-by-check` | the head holds it, paired, at a lower severity, with a `guard` at an inserted line | `null` |
| `program-removed` | the target's file is not in the head, or its program is not | `false` |
| `cleared-by-check` | the head's `checked` list holds the target's route, paired, with a guard that stops it | `true` |
| `statement-removed` | for `path` evidence, the target's line is a deleted line, and no sink of the target's kind in its program stands at an inserted line (§5a) | `false` |
| `source-removed` | for `path` evidence, the line of the source the target's trace starts at is a deleted line, and no source of that kind in the program stands at an inserted line | `false` |
| `no-longer-fires` | for any other evidence, the patch changed the target's file and the rule no longer fires there | `true` |
| `gone-unexplained` | none of the above | `null` |

`statement-removed` and `source-removed` fail. A fix keeps the program's statements and stops the
route, because deleting the statement removes what the program did along with the flaw: a printing
program that no longer prints still reports that it printed. Both outcomes are still named, so the
reason says what the patch did. Run under ironwork with DD PRINTER, its virtual printer, such a
patch also diverges in `ironwork compare` ([evidence.md](evidence.md) §12), so the build's
equivalence check sees the lost print by running the program.

`lowered-by-check` is undecided rather than a pass: a check that lowers without stopping may not
turn away everything it should, which is why the engine lowered rather than cleared. A finding held
at a lower severity with its guard at an unchanged line is `still-reported`: the patch did not add
the check that lowered it.

`gone-unexplained` is the case a person must look at. Its commonest honest cause is a route cut
between its ends - the `MOVE` that carried the value deleted - which the gate cannot place, because
a trace's hops name the program, item and file but not the line. Its dishonest cause is a patch
that sends the value through a construct the engine does not follow, which removes the finding and
leaves the flaw. The gate cannot tell the two apart, and its reason says so.

### 5a. Why the listings

A changed line is a text fact: it says the patch touched the statement, not that the statement is
no longer what the rule looked for. A sink reworded into a form one recogniser misses would read as
removed. The flow engine already lists every sink its graph holds, reached or not
(`analyze(..., { listSinks: true })`), and lists sources the same way when asked; `statement-removed`
and `source-removed` rest on those listings, as `cleared-by-check` rests on `checked`, so each
outcome is a fact the engine states, not an inference from the text.

The question the listing answers is whether the patch wrote the statement back, so it looks only
at inserted lines. A program with a second sink of the same kind that the patch did not touch
still has it, and that says nothing about the one the patch removed.

The kinds come from the rule. A path rule's id is its source kind and its sink kind joined by
`-to-`, and on 2026-09-24 each of the 97 path rules spelled exactly one pair of the engine's 9
source and 22 sink kinds. A test holds every path rule to that. A rule that spelled none would have
no listing outcome, and could only be `gone-unexplained`.

### 5b. A command that reads a variable

A fix to an `os-command` sink can stop building the command from the input and run a fixed command
that reads the value from an environment variable, as the reviewed fix to CH7ASG02 does (commitwork-sidecar
`evaluations/hazop_2026-10-01_ch7asg02-printer-command.md`). The flow engine follows the value into
the variable and on to the command, and credits it only where all of these hold (operator ruling,
2026-10-07):

- The program sets the variable by name: `DISPLAY 'NAME' UPON ENVIRONMENT-NAME` then `DISPLAY value
  UPON ENVIRONMENT-VALUE` in the same paragraph, or `SET ENVIRONMENT 'NAME' TO value`.
- The command is a literal, and every place it reads the variable is inside double quotes, as an
  argument of a simple command whose program is literal text, outside any command substitution and
  not a redirection's target (`lib/shell-command.mjs`). The shell expands such a reference to one
  word and never reads it as syntax. A program that runs its arguments - a shell, `eval`, `env`,
  `xargs`, `sudo`, an interpreter and the like - does not count.
- On every route, before the value is set, the whole field passed a test against a class
  SPECIAL-NAMES defines, and none of the class's characters is one a shell reads as syntax or a
  control character. A space may be in it: the field is padded with spaces, and the quotes keep them.
  A range is read in both ASCII and EBCDIC, so `'A' THRU 'Z'` also holds `}` and `\`, and is written
  `'A' THRU 'I' 'J' THRU 'R' 'S' THRU 'Z'` instead.
- The value cannot be read as an option: the class has no `-`, or a test `X(1:1) NOT = '-'` holds.

The route is then in `checked` with a guard that stops it, and the outcome is `cleared-by-check`. A
reference that fails any of these leaves the finding reported at the command, lowered where a check
ran.

## 6. Pairing

A finding in the head is paired with one in the base when they agree on:

1. `fingerprint`: the fingerprint; or
2. `scope`: the rule and every input to the fingerprint except the line's text - repository, scope
   and subject; or
3. `route`: for `path` evidence only, the rule, the program, and the file and code text of the
   source statement its trace starts at.

It is a matching of two lists, not a lookup. Every level 1 match is made first, across all
findings; level 2 then pairs only what level 1 left, and level 3 only what level 2 left. Two
findings of one rule in one paragraph share a level 2 key, and a lookup would pair the target
with its neighbour after the patch fixed the target alone.

Pairing for the target only ever makes the verdict stricter: a paired finding is the target still
reported, and `pairedBy` in the document says which level found it. Pairing for any other finding
stops an edit to its line from reading as a finding added, and applies only where the paired head
finding is not more severe than the base one. A finding whose severity rose is added.

Measured on 2026-09-24: an allow-list added before the sink leaves the route in `checked` under the
base fingerprint; `CALL "SYSTEM"` for `CALL 'SYSTEM'` changes the fingerprint and is found at level
2; the call moved into a `PERFORM`ed paragraph changes the scope and is found only at level 3.

## 7. Output

```json
{
  "tool": "cobolwork-gate",
  "schemaVersion": 3,
  "verdict": "fail",
  "target": { "fingerprint": "...", "rule": "...", "sev": "crit", "path": "...", "line": 10, "program": "P2" },
  "outcome": "still-reported",
  "pairedBy": "scope",
  "checks": { "target": false, "added": true, "layout": true, "calls": true, "configuration": true, "coverage": true, "compile": null },
  "compiled": "not compiled: no ironwork on PATH outside the repository, and no cobc on PATH outside the repository",
  "reasons": ["..."],
  "repositoryText": ["target.path", "target.program", "reasons"],
  "summary": { "mode": "gate", "base": "HEAD", "head": "3f2a9c1", "flowModel": "...", "toolVersion": "...", "introduced": 0, "resolved": 0, "changedFiles": 1, "coverageIncomplete": false }
}
```

`reasons` are built from rule ids, the rule's own text, paths, line numbers, severities and counts.
They never carry a finding's `detail` or any source text, because the pipeline hands them to the
drafter verbatim as its next instruction, and a detail can hold names the scanned repository chose.
At most twenty; each passes through `printable`.

A path is still text the repository chose, and a file can be named for an instruction. Paths in a
reason are capped at 120 characters and pass through `printable`, which removes control and
bidirectional characters but not words. `repositoryText` lists the fields that hold such text, so a
consumer does not have to know: commitwork passes them to a model only inside its untrusted-text
envelope, as it does `explain`'s packet.

## 8. Changed lines

The gate computes the line diff itself, in JavaScript, per file it needs, and never asks git for
one: `git diff` runs the textconv and external-diff drivers a repository's configuration names.
Lines are compared as the fingerprint compares them, sequence area and trailing blanks removed, so
renumbering a program changes none of its lines. Common leading and trailing lines are set aside
first, and the rest is Myers' diff, whose working memory grows with the square of the edit
distance, and whose time grows with the lines times the edits. Past 2,000 edited lines, or 200,000
lines between the two files, a pair is too large to attribute, and every outcome that needs its
changed lines is undecided. Whether a file changed at all is a byte comparison, and only the
target's files, and the files of the sinks and sources its outcome reads, are diffed by line.

## 9. The compiler

Optional, and never taken from the reviewed tree. The compiler is ironwork where there is one and
cobc otherwise: `--ironwork <path>` names ironwork, `--cobc <path>` names cobc, and with neither the
gate takes the first `ironwork` on `PATH`, then the first `cobc`, each resolved to an absolute file
and skipping any `PATH` entry that is relative or lies inside the repository. `compiled` names the
compiler that ran, and where it is cobc found on `PATH`, that no ironwork was. ironwork runs as
`ironwork check --diagnostics json` and a program compiles at return code 0 or 4, as in the build
gate ([build-gate.md](build-gate.md) §8a); cobc runs as `cobc -fsyntax-only`. ironwork's errors are
read by id as the build gate reads them: a head whose errors are none of them the program's own, such
as a construct ironwork refuses by name (IWR), or whose check ended some other way, is undecided
rather than a regression, `compile` is null, and `compiled` and `reasons` say so with its error lines. Either runs with a working
directory outside the repository, base and head alike, with the directories that hold the tree's
copybooks, on every program file the patch changed and every program whose resolved `COPY`
statements include a file the patch changed: a one-line copybook edit breaks the programs that copy
it, not the copybook. Only a regression fails: a program that did not compile before cannot fail
the gate for not compiling after, because the gate cannot tell a missing copy library from a broken
patch. A program that stopped compiling adds up to three of the compiler's error lines to
`reasons`, each as `the compiler: <path>:<line>: error: ...` from cobc or
`the compiler: <path>:<line>: IWC0001-S ...` from ironwork, with the path as the repository names it
and ironwork's quoted literals replaced by `'…'`, so a drafter's next attempt knows where its patch
broke the program.

Each run of the compiler is stopped at 60 seconds, at most 50 programs are compiled, and the whole
check has one budget of 10 minutes; past either limit `compile` is null and `compiled` says which.
Without the budget, a copybook that fifty programs copy and a source built to hang the compiler
would hold the gate for over an hour, and the heavy-job queue behind it with it.

## 10. Invariants

1. **G-I1** The gate never passes when either scan's coverage is incomplete.
2. **G-I2** A patch that changes `cobolwork.site.json` or `cobolwork.baseline.json` never passes.
3. **G-I3** Pairing never lets the target pass.
4. **G-I4** No output carries source text or a finding's detail.
5. **G-I5** Nothing the reviewed repository configures runs: git is used as `diff` uses it, the line
   diff is computed in process, and the compiler comes from outside the tree.
6. **G-I6** The same revisions and target give the same document when both scans are complete. A
   scan the memory guard stops is undecided, so on a loaded machine a verdict can move between
   undecided and the complete answer, never between pass and fail.
7. **G-I7** The exit code says whether the gate ran, never what it decided.

## 11. Specification (BDD)

Every scenario builds a git repository from this repository's fixtures, commits the base, and
applies the patch to the working tree or a second commit.

### G1 - The target

#### G1.1 A check the patch adds that stops the route passes
    Given a program that passes command-line input to CALL 'SYSTEM'
    When  the patch adds an EVALUATE that lets two names through and ends the run on the rest
    Then  the outcome is cleared-by-check and the verdict is pass

#### G1.2 A check the patch adds that only lowers the finding is undecided
    Given the same program
    When  the patch adds a numeric test that sets a flag the call is made under
    Then  the outcome is lowered-by-check and the verdict is undecided

#### G1.3 Removing the flagged statement fails
    When  the patch deletes the CALL 'SYSTEM'
    Then  the outcome is statement-removed, target is false and the verdict is fail

#### G1.4 Rewording the flagged statement is not a fix
    When  the patch changes the CALL's line and the route still reaches it
    Then  the outcome is still-reported, and no finding is reported as added for it

#### G1.5 Removing the source fails
    When  the patch deletes the ACCEPT
    Then  the outcome is source-removed, target is false and the verdict is fail

#### G1.6 Deleting the program fails
    When  the patch deletes the program's file
    Then  the outcome is program-removed and the verdict is fail

#### G1.7 A construct the patch repairs no longer fires
    Given a CICS program that reads its COMMAREA without testing EIBCALEN
    When  the patch adds the test
    Then  the outcome is no-longer-fires and the verdict is pass

#### G1.8 A route cut between its ends is undecided
    When  the patch deletes the MOVE that carried the value from the ACCEPT to the CALL
    Then  the outcome is gone-unexplained, the verdict is undecided, and a reason says a person decides

#### G1.10 A fixed command reading the checked field as one quoted argument passes
    Given a program that passes command-line input to CALL 'SYSTEM'
    When  the patch tests the field against a class with no shell syntax and for a leading '-',
          sets it in an environment variable, and runs a literal command that reads the variable
          as one quoted argument
    Then  the outcome is cleared-by-check and the verdict is pass

#### G1.11 A command reading the variable any other way, or a weaker check, is not a pass
    When  the command reads the variable unquoted, or through sh -c, or the class is one EBCDIC
          range, or holds a shell metacharacter, or nothing tests the first character
    Then  the outcome is still-reported or lowered-by-check, and the verdict is not pass

#### G1.9 An unknown fingerprint is refused
    When  the target names a fingerprint the base does not hold
    Then  the gate exits 2 and writes no verdict

### G2 - The rest of the patch

#### G2.1 A finding the patch adds fails, and is named by rule and place
    When  the patch fixes the target and adds a second CALL 'SYSTEM' elsewhere
    Then  the verdict is fail, added is false, and a reason names that rule, file and line

#### G2.2 An edited line of another finding is not a finding added
    When  the patch rewords the line of a finding it does not target
    Then  added is true

#### G2.3 A change to the site file or the baseline fails
    When  the patch adds a baseline entry that suppresses the target
    Then  the verdict is fail and configuration is false

#### G2.4 A layout moved in a program the patch did not edit fails
    When  the patch widens a field in a copybook another program copies
    Then  layout is false

#### G2.5 A new call target fails
    When  the patch makes the program call one it did not
    Then  calls is false

#### G2.6 Incomplete coverage is undecided, never pass
    When  the patch removes a copybook the program copies, which also removes the target
    Then  coverage is null and the verdict is undecided

#### G2.7 A fixed finding is not paired with its neighbour
    Given two CALL 'SYSTEM' statements in one paragraph, both reached
    When  the patch deletes the one the target names
    Then  the outcome is statement-removed, and the neighbour is not reported as added

#### G2.8 A statement written back elsewhere is not removed
    When  the patch deletes the CALL the target names and writes a CALL 'SYSTEM' on another line
    Then  the outcome is not statement-removed

#### G2.9 --target-only answers for the target and coverage alone
    When  the patch fixes the target and adds an unrelated finding
    Then  with --target-only the verdict is pass, and without it the verdict is fail

### G3 - What the gate emits and runs

#### G3.1 No output carries source text
    Given a program whose statements hold a marker string
    Then  the gate's document does not contain it

#### G3.2 The compiler is not taken from the reviewed tree
    Given a PATH whose only cobc is inside the repository
    Then  the gate reports not compiled

#### G3.3 A program that stopped compiling fails; one that never compiled does not
    Given a compiler that fails the head and passed the base
    Then  compile is false and the verdict is fail
    And   given one that fails both, compile is null

#### G3.3a A program that stopped compiling carries the compiler's error lines
    Given a compiler that fails the head with four error lines
    Then  reasons carry the first three, each named by the path in the repository

#### G3.3b A program the compiler cannot decide after the patch leaves compile undecided
    Given a compiler that passed the base and cannot decide the head, as ironwork cannot at an IWR id
    Then  compile is null, compiled says so, and reasons carry its error lines

#### G3.4 The same inputs give the same document
    When  the gate runs twice on the same revisions
    Then  the documents are identical

#### G3.5 The spec and the suite name the same scenarios

#### G3.6 --exit-code turns the verdict into the exit status
    When  the gate runs with --exit-code on a patch that fails
    Then  it exits 1, and without the flag it exits 0 on the same patch

#### G3.7 The compiler has one budget for the whole check
    When  the budget is spent before a program is compiled
    Then  compile is null and compiled names the budget

#### G3.8 A baseline is refused rather than ignored
    When  the gate is given --baseline or --no-baseline
    Then  it exits 2

## 12. Out of scope, deliberately

- **Applying the patch, or choosing a worktree.** The pipeline does that; the gate reads two trees.
- **Running the program.** The gate is static, like the rest of cobolwork.
- **More than one target per run.** A patch that fixes two findings is gated twice.
- **Posting anywhere.** commitwork's lane reads the document and decides what to lodge.
