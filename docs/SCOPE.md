# Scope: what cobolwork reads, refuses and leaves unmeasured

For a reader deciding whether cobolwork fits their estate. Each statement names where to check it.
The rules themselves are in [rule-sets.md](rule-sets.md); `cobolwork capabilities --json` lists the
commands, options, document versions and source kinds of the build you have.

## What it needs

- Node 22 or later (`engines` in `package.json`). No dependencies, runtime or development.
- Nothing else for `scan`, `flow`, `inventory`, `diff`, `parse`, `sbom`, `baseline`, `explain` and `tui`.
- ironwork, a COBOL compiler and runtime, is optional. `build`, `gate` and `advise --ironwork` use it
  to compile and check programs; run-based evidence (`COBOLWORK_EXECUTION`, `COBOLWORK_ABENDS`) comes
  from its runs. Without it a report says which parts were not compiled or measured.
- GnuCOBOL is needed only to regrade the parser or validate benchmark cases.

## What it reads

A file is classified by extension, and a file with no extension by its first kilobytes
(`lib/sources.mjs`). EBCDIC members are decoded, including fixed 80-byte records with no line ends.
`--pds-export` reads a directory of partitioned data set members.

| Kind | Extensions, or content when there is none | Reader |
|---|---|---|
| COBOL programs | `.cbl` `.cob` `.cobol` `.sqb` `.pco` | `lib/parser.mjs` |
| Copybooks | `.cpy` `.copy` `.inc` | `lib/parser.mjs`, `COPY` and `REPLACING` resolved |
| JCL | `.jcl` `.job` `.proc` `.prc` `.cntl` | `lib/jcl.mjs` |
| CICS BMS maps | `.bms`, or a `DFHMSD` macro | `lib/bms.mjs` |
| CICS system definition | `.csd` (transactions, transient-data queues, TCP/IP services, URI maps) | `lib/csd.mjs` |
| Db2 SQL | `EXEC SQL` in programs; DDL in `.sql` `.ddl` `.db2` | `lib/embedded-sql.mjs`, `lib/db2/read.mjs` |
| IMS | DBD and PSB in `.dbd` `.psb`; DL/I calls (`CBLTDLI`, `AIBTDLI`, `EXEC DLI`) in programs | `lib/ims/` |
| PL/I | `.pli` `.pl1` `.plx` | `lib/pli/` |
| HLASM | `.asm` `.mac` `.mlc` `.hlasm` `.assemble`, or assembler content | `lib/hlasm/` |
| Build files | compiler options and pinned compiler versions in shell, batch, PowerShell, Makefile and task files | `lib/options.mjs` |
| Tool configuration | Zowe and MCP client configuration files | `lib/sets/zowe.mjs` |

COBOL source formats: fixed, free, variable and terminal. The format is detected from the text, and a
`>>SOURCE` or `$SET SOURCEFORMAT` directive in the source changes it. `CBL` and `PROCESS`
option cards, `>>IF` and Micro Focus `$IF` conditional compilation, and tabs are read.

COBOL dialects: IBM Enterprise COBOL is the reference for what a statement means. GnuCOBOL and Micro
Focus forms are read where the parser handles them (Micro Focus directives and headerless programs,
GnuCOBOL's command-line `ACCEPT` and free-format comment rules), and its reserved-word and dialect lists
come from GnuCOBOL's. There is no dialect switch for COBOL. `--mvs38-forms` and `--no-mvs38-forms` decide
whether assembler operands that only MVS 3.8's macros take are read or refused. `--hlasm-optable`
sets the HLASM operation code table. PL/I is read as IBM's language; HLASM is read, not assembled.

How far each reader goes:

- COBOL is graded against GnuCOBOL's listing on held-out repositories (README, "How accurate it is").
  A program GnuCOBOL does not accept is not in that grade.
- HLASM is graded against z390 on the values both of its runs agree on. Macros are not expanded and
  conditional assembly is not evaluated.
- PL/I has no compiler that may grade it. Its reader is measured by the share of statements it parses.
- BMS and IMS have no assembler to grade against. They are checked against hand-built fixtures and
  against the names CICS generated for real maps.

## What it refuses or leaves out, and how a report says so

A reader that does not recognise something names it. It does not guess and it does not skip silently.
A report lists what was not read, and `summary.coverageIncomplete` is true whenever any of these happened:

- A copybook the tree does not hold, or whose `COPY` names a file outside the tree, is reported as
  unresolved or refused. `--copylib`, `COBCPY` and `COBOLWORK_COPYPATH` name libraries to search.
- A file that could not be read, a directory that could not be listed, and a symlink leading out of
  the tree.
- A Db2 statement in another SQL dialect, a DBD operand the IMS reference does not list, and every PL/I
  statement the reader could not parse are each counted by kind.
- HLASM macros not expanded, `COPY` members the tree does not hold, and statements that could not be read
  are each named.
- Pointer, entry-variable and preprocessor flow in PL/I is listed as coverage and not followed.
- A scan that stops before exhausting memory says how much it read. `COBOLWORK_FREE_MEMORY_MB` states
  your share of the machine.
- A PL/I member with no extension is not recognised as PL/I. `COBOLWORK_PLI=0` leaves PL/I out.
- A rule that needs a fact no repository holds (which qualifiers are production, which DDs reach the
  internal reader, the compiler options in force) does not run without it, and `summary.setsIncomplete`
  names the rule set and the file, `cobolwork.site.json`, that would supply it.

Not read at all: a source language not listed in the table above, and any runtime behaviour. `scan` does
not run the program. A route found by reading the code is a `path` finding; only a run confirms it.
Whether anyone may start the transaction or job that reaches a route lives in RACF, not in a
repository, so without a `cobolwork.site.json` entry or a reduced RACF unload (`COBOLWORK_REACH`) the
strongest exploitability verdict is `attacker-driven`.

## What stays unmeasured

Accuracy of the parser is in the README. The accuracy of the rules is measured separately, and not
for every rule. `bench/precision.mjs` takes label files and prints, per rule, how many findings were
right, wrong and unknown, and a precision range in which an unknown counts both ways. Each number
names the stratum its labels came from, and strata are never pooled:

| Stratum | Source | Label made by |
|---|---|---|
| Execution | `execution` | running the finding's verification plan in ironwork (reach.md §9.6) |
| Planted | `planted` | putting a flaw, or a near-miss of one, into a real program (`bench/seed.mjs`) |
| Synthetic | `generated` | programs built with a known answer (`bench/negatives.mjs --labels`) |
| Model | `model` | the Opus judge's verdict on a finding whose execution label is unknown, or the operator's rescoring where there is one (operator's rule of 2026-10-08) |

Labels from code rewritten for a run, or run under `--compliance extended`, are further strata of their
own (for example `execution-rewritten`). Model labels are a judgement, not a run. Synthetic labels are
for programs this project wrote.

On the current labels, 37 error-severity rules have no label that is right or wrong in any stratum.
Their precision is not known. `bench/precision.mjs` lists them as unmeasured, by rule id, under each
table it writes; run it on the label files for the list.

Other things stay unmeasured:

- `path` precision on an independently labelled corpus of other people's findings. The benchmark
  cases (`bench/cases/`) are written by this project.
- Recall outside the planted and synthetic strata. A flaw nobody planted and no rule reports is not
  counted anywhere.
- The BMS, IMS and PL/I readers against a compiler or assembler. See above.
- Anything a report marks `unknown` or `unmeasured`.
