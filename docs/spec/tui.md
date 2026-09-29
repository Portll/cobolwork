# The terminal interface

A specification for `cobolwork tui` and `cobolwork explain`, written before either exists. The
scenarios below are the tests: each `#### <id>` heading is the name of exactly one test, and
`test/tui-spec.test.mjs` fails if a heading has no test or a test names a heading that is not here.

Status: proposed, 2026-09-24. Slices T0, T1 and X1 are specified in full; the rest are listed so
the order is visible, and get their scenarios when they are started.

---

## 1. Why this exists

A report is a JSON document, and the people it is about read source in ISPF. Reading a report today
means reading JSON, and stating the estate facts three rules wait for means hand-editing a file
whose shape is in a README. The terminal interface is for the developer who lives at a terminal,
often over SSH, and would never open a web panel.

`explain` exists for a different reader: a person or a local model drafting a fix. A report carries
no source text, by design, so it can be passed on without the code. A fix cannot be drafted without
the code, so `explain` builds a packet for one finding from the source on this machine, and says in
its own output that it carries source.

## 2. Ubiquitous language

The terms of [`ruleset-contract.md`](ruleset-contract.md) §2 stand: finding, rule, rule set,
evidence, severity, coverage, estate. This adds:

| Term | Meaning |
|---|---|
| **panel** | One screen with one job: Home, Findings, Finding, Help. The panel stack is how F3 knows where to go back to |
| **command line** | The `Command ===>` field on every panel. Commands are words (`SORT RULE`), as in ISPF |
| **PF key** | A function key bound to an action. The legend on the last row says which |
| **keymap** | Which keys mean which actions. Two ship: `ispf` and `modern`. Every action is in both |
| **banner** | The coverage lines above any count. It says what was not read before anything says what was found |
| **fix packet** | One finding with the source lines of its trace, the declarations of the items on it, and the credited check. The only cobolwork output that carries source |

## 3. Ports and adapters

The interface is five contexts, and only one of them touches the terminal.

| Context | Holds | I/O |
|---|---|---|
| Analysis | the engine as it is | through `scanAll`, never reached into |
| Report | `lib/tui/model.mjs`: rows, banner, counts, who acts | none |
| Review | the session: panel stack, selection, sort, filter | none |
| Presentation | `lib/tui/app.mjs`, `lib/tui/screen.mjs`, `lib/tui/keys.mjs` | none |
| Terminal | `lib/tui/terminal.mjs`: a Node TTY adapter and a fake | the only one |

The core is `update(state, event) → { state, effects }` and `view(state) → Screen`. Both are pure,
so every panel is tested as text without a terminal. The renderer turns the difference between two
screens into escape sequences; the adapter writes them.

`explain` lives in `lib/explain.mjs`. It reads source through `readSource`, so EBCDIC members are
decoded as the rule sets decode them, and it refuses a path that resolves outside the root, which is
the containment every other reader keeps.

## 4. Invariants

1. **I1** The interface renders the engine's report. It never computes, drops or re-grades a finding.
2. **I2** Every panel that shows a count shows the banner above it.
3. **I3** Severity is a letter as well as a colour. Nothing is carried by colour alone.
4. **I4** Every action is reachable from both keymaps, and F1 is defined on every panel.
5. **I5** The terminal is restored on every exit path: a normal quit, Ctrl-C, and an error.
6. **I6** Every panel is complete at 80×24. A wider terminal adds columns, never required information.
7. **I7** No dependencies. The terminal is `node:readline` keypresses, raw mode and ANSI.
8. **I8** A fix packet is the only output that carries source, and it says so.
9. **I9** Text from a report reaches the terminal as text. Control and bidirectional characters are
   drawn as `?`, so a report cannot move the cursor, retitle the window or write the clipboard.

## 5. Slices

| Slice | Delivers | Needs |
|---|---|---|
| T0 | Terminal adapter and fake, restore on exit, both keymaps, the 80×24 frame | - |
| T1 | A report: Home, Findings, Finding, Help, the banner, SORT/FILTER/FIND | T0 |
| X1 | `cobolwork explain`: the fix packet | fingerprints (landed) |
| T2 | Trace and Source panels, column zones, the layout lens | T1, X1 |
| T3 | Scans run in process, with progress and cancel | T1 |
| T4 | Help and glossary generated from this spec and the rule catalogue | T1 |
| T5 | The tour, on this repository's fixtures | T2, T4 |
| T6 | Setup: copybook libraries, estate facts, packs, with preview-and-confirm writes | T3 |
| T7 | Change review | T2 |
| T8 | Rules, compliance, export | T1 |
| T9 | Accept (through `lib/baseline.mjs`), compare reports, remediation | baselines; commitwork |

## 6. Specification (BDD)

Reports in these scenarios are produced by the engine from this repository's fixtures, on a
declared machine, never written by hand: a hand-written report tests the interface against a shape
the engine may not emit. A scenario about a report the engine would not write - hostile, malformed,
or not cobolwork's - edits an engine report, or builds only the wrong shape it is about.

### T0 — The terminal

#### T0.1 The terminal is restored when the interface quits

Given the interface started on a terminal, when it quits, then the alternate screen is left, the
cursor is shown and raw mode is off.

#### T0.2 The terminal is restored when an error escapes

Given the interface started on a terminal, when an error is thrown while handling a key, then the
terminal is restored before the error is reported.

#### T0.3 Without a terminal it refuses

Given standard output is not a terminal, when `cobolwork tui` runs, then it exits 2 and names
`scan` as the command that works without one.

#### T0.4 Every action is reachable from both keymaps

Given the `ispf` and `modern` keymaps, then every action the interface has is bound in each.

#### T0.5 Every panel fits 80×24

Given each panel at 80×24, then the screen has 24 lines, none longer than 80, and the last line is
the key legend.

#### T0.6 A terminal smaller than 80×24 is told so

Given a 60×20 terminal, then the screen says it needs 80×24 and shows the size it has.

#### T0.7 Only the rows that changed are redrawn

Given two screens that differ in one row, then the redraw writes that row and no other.

#### T0.8 The spec and the suite name the same scenarios

Given this document and the test files, then every scenario heading has one test of the same id,
and every test id has a heading.

#### T0.9 Text from a report cannot drive the terminal

Given a finding whose rule, path, detail, related entries and trace carry escape sequences and a
bidirectional override, when each panel draws it, then no cell holds a control character and the
output holds no escape the interface did not write itself.

#### T0.10 Ctrl-C quits and restores the terminal

Given the interface started on a terminal, on any panel, when Ctrl-C is pressed, then it quits and
the terminal is restored as it is by a normal quit.

### T1 — A report

#### T1.1 Coverage is read before counts

Given a report whose coverage is incomplete, when Home or Findings shows, then the banner names each
rule set that fell short with its reason, above the first count.

#### T1.2 A complete report says it is complete

Given a report whose coverage is complete, then the banner's first line says so. A rule set that
did not run for want of configuration - recon with no `cobolwork.site.json`, which is every public
repository - follows as a note, not a warning: a rule that was not asked to run is not a file that
was not read.

#### T1.3 Findings are ordered by severity, and severity is a letter

Given a report, when Findings shows, then rows run critical to info, then by rule, then by where,
and each row's severity is one of C, H, M, L, I.

#### T1.4 Enter opens a finding

Given Findings with a row selected, when Enter is pressed, then the Finding panel shows its rule,
severity, evidence and who acts on it, program, where, and fingerprint.

#### T1.5 A credited check shows what it lowered

Given a finding lowered by a check, when it is opened, then the panel says the severity it was
lowered from and where the check is.

#### T1.6 F3 goes back one panel, and quits from Home

Given the Finding panel opened from Findings, when F3 is pressed three times, then the interface
returns to Findings, then Home, then quits.

#### T1.7 F1 is help for the panel, and F1 again lists its keys

Given any panel, when F1 is pressed, then help for that panel shows; when F1 is pressed again, the
keys of the active keymap show.

#### T1.8 SORT, FILTER and FIND change the list

Given Findings, when `SORT RULE`, `FILTER tampering` or `FIND WS-` is entered, then the rows are
reordered or narrowed and the title says how; `RESET` restores them.

#### T1.9 An unknown command says so

Given any panel, when a command nobody implements is entered, then the message line names it and
points to F1, and nothing else changes.

#### T1.10 Paging keeps the selection on screen

Given more findings than fit, when F8 or Page Down is pressed, then the list scrolls a page and the
selected row stays visible.

#### T1.11 A report that is not cobolwork's is refused

Given a JSON document that is not a cobolwork findings report, when it is opened, then it is refused
with a reason rather than shown as an empty list.

#### T1.12 A report whose findings are not findings is refused

Given a cobolwork report with a finding that is not an object, a path that is not text, a trace that
is not a list, a lowered severity with no check named, or an incomplete set with no name, when it is
opened, then it is refused with the finding it failed on rather than failing while it is drawn.

#### T1.13 A command on an open finding keeps that finding open

Given a finding opened from the list, when SORT, FILTER, FIND or RESET is entered on it, then the
same finding stays open, its position says where it sits in the new view or that the view leaves it
out, and F3 returns to the list in the new view.

#### T1.14 A report with no findings says so rather than opening nothing

Given the engine's report of a tree with nothing in it, then Home says nothing was read, Findings
says it has no rows, and Enter on Findings says there is no finding to open and stays on the list.

#### T1.15 KEYS switches the keymap and its legend

Given the ispf keymap, when KEYS MODERN is entered, then the legend is the modern one and a modern
key moves the selection; KEYS ISPF switches back, and KEYS with anything else says what it takes.

#### T1.16 FINDINGS returns to the list rather than stacking another

Given a finding or its help open over the list, when 1 or FINDINGS is entered, then the list it came
from is shown with its selection, and F3 from there goes to Home, not back into the finding.

### X1 — The fix packet

#### X1.1 A packet carries the trace with its source lines

Given the cross-program finding in `test/fixtures/dataflow`, when it is explained, then the packet
lists its four hops, each with the source line it names, and the sink's line.

#### X1.2 A packet names each item's declaration

Given the same finding, then the packet gives each traced item's level, picture, size and section
as the parser computed them.

#### X1.3 A packet says it carries source

Given any packet, then it states that it contains source text, which a report never does.

#### X1.4 An unknown fingerprint is refused

Given a report, when `explain` is asked for a fingerprint it does not hold, then it exits 2 and
names the fingerprint.

#### X1.5 A path outside the root is not read

Given a finding whose path resolves outside the root, when it is explained, then no line is read
from it and the packet says why.

#### X1.6 A packet carries the rule's impact and standard fix

Given a defect finding, when it is explained, then the packet carries what the finding lets someone
do and the standard fix; an info finding carries neither.

#### X1.7 A hop with no location of its own is not given another's

Given a trace hop whose `via` names no location and whose file has no related entry, when the
finding is explained, then that hop carries its own file and no line, never another hop's.

#### X1.8 A suppressed finding is still explained

Given a finding a baseline has moved into `suppressed`, when it is explained, then the packet is
built as for a live finding and carries the judgement that suppressed it.

#### X1.9 A packet quotes only a line's code area

Given a fixed-format line with text in columns 73 to 80, when it is quoted, then the packet holds
columns 8 to 72 and marks that bytes were dropped. Columns 73 to 80 are where the hidden rule set
finds payloads, and the packet is written for a model to read.

#### X1.10 A line the hidden rule set flagged is withheld

Given a report with a hidden-set finding on a line the packet would quote, then that line is not
quoted and the packet names the rule instead.

#### X1.11 The packet resolves COPY as the scan does

Given a program whose `COPY` names a copybook outside the root, when its items are declared in the
packet, then that copybook is not read: the packet parses with the scan's file index, and the
scan refuses the same `COPY`.

#### X1.12 Only source files are quoted

Given a report whose finding names a file under the root that cobolwork does not read, such as
`.env`, then the packet quotes nothing from it and says why.

#### X1.13 An error cannot write to the terminal

Given an error whose message carries control characters, when any command reports it, then the
characters reach standard error replaced, and the message is capped in length.

## 7. Out of scope, deliberately

- **Mouse input.** A 3270 has none, and nothing here needs it.
- **Colour themes.** Severity colours plus `NO_COLOR`. A theme system is a second thing to test.
- **A real-terminal test harness.** Driving a TTY from a test needs a pty dependency this project
  does not take. The adapter's escape sequences are tested through the fake; real terminals are a
  dated manual check, recorded here when it is done.
