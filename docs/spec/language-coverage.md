# Language coverage: BMS, IMS, DB2 DDL, HLASM and PL/I

An execution plan for reading the four mainframe languages cobolwork does not read, and the one
database definition language it half-reads through COBOL.

Status: proposed, 2026-09-20. Written for an engineer coming to it cold: it assumes the codebase,
not the discussion that produced it.

Measured against the working tree at that date: 9 rule sets, 79 rules, 206 tests, 48 benchmark
cases, and a 125-repository public COBOL corpus whose manifest records how it was selected;
[`diag/fetch-corpus.mjs`](../../diag/fetch-corpus.mjs) reproduces it.

Depends on: [`ruleset-contract.md`](ruleset-contract.md). Read that first. Every rule set below is
specified as a `defineRuleSet` adapter on the `SourceTree` port, and nothing here should be built
on the pre-contract shape.

---

## 0. What "100% parsing" has to mean

The request was 100% parsing and a full specification for each language. Two of the five cannot
have the first in any honest sense, and saying so now is cheaper than discovering it in month
three.

**COBOL's number is real because there is an oracle.** `diag/grade-against-gnucobol.mjs` compares
the parser against `cobc -t -Xref -ftsymbols` over held-out repositories, and reports recall and
precision per data item, per label, per call. The claim "99.6% recall over 21,624 files" means
something because a compiler disagreed 5,881 times and those disagreements were counted.

For the five languages here, the oracle situation differs, and the definition of done differs with
it:

| Language | Oracle | What 100% can mean |
|---|---|---|
| **BMS** | **None.** z390 does not ship IBM's `DFH` macro libraries | Round-trip plus hand-built fixtures. No assembler grade — say so in the README |
| **IMS DBD/PSB** | **None.** z390 ships no IMS emulation at all | Self-consistency against `BYTES=` totals, plus hand-built fixtures |
| **DB2 DDL** | A mature SQL parser as a differ, not a truth | Every statement type present in the corpus; anything else reported unparsed |
| **HLASM** | **z390 (GPL v2, HLASM-compatible) — confirmed** | **Not 100%.** See below |
| **PL/I** | Iron Spring PL/I (licence needs checking) | **Not 100%.** See below |

### The z390 question is answered, and two phases lose their oracle

Open question 1 in §10 gated three phases. **Answer: z390 does not ship IBM's `DFH` (CICS) or IMS
macro libraries.** They are proprietary and available only from IBM under licence. Specifically:

- **zCICS.** z390 ships an open-source transaction manager in `z390\CICS` with macro processors
  that parse `EXEC CICS` statements and emulate standard `DFH` *references* — `DFHRESP`,
  `DFHVALUE`, `DFHEIENT`, `DFHEISTG`. **Read that boundary carefully.** Those are
  command-interface macros. The BMS map-definition family — `DFHMSD`, `DFHMDI`, `DFHMDF` — is a
  different family, and nothing states zCICS provides it. **Do not assume zCICS gives phase 1 an
  oracle.** If someone later establishes that it does, that is a welcome finding; it is not the
  planning assumption.
- **IMS.** No emulation, no bundled macros. Assembling IMS macro source requires the user's own
  licensed IBM libraries, which cannot be a redistributable grading harness.
- **MVS.** Basic open-source MVS macros ship in `z390\mac`, and a public-domain MVS 3.8 macro
  library (`MVS.zip`) is separately available for reference. Neither contains modern CICS or IMS.

Three consequences for the plan:

1. **HLASM (phase 4) is the only phase whose oracle survives.** z390 is a genuine HLASM-compatible
   assembler, and the MVS 3.8 library is a usable citation source for phase 4's opcode table.
2. **BMS (phase 1) and IMS (phase 2) ship without an external oracle.** Their fallbacks were
   already written into their definitions of done — round-trip for BMS, `BYTES=` self-consistency
   for IMS — and those now become the primary method rather than the contingency. The README must
   say plainly that these are read, not assembled, in the same sentence-shape it already uses for
   the COBOL grade.
3. **It changes the risk profile, not the order.** BMS still leads on value per hour, and value is
   not oracle-dependent. But two of the first two phases now rest on fixtures the project writes
   itself, so the *quantity* of hand-built fixtures in phases 1 and 2 should go up, and the honesty
   claim in §0 does real work rather than being a caveat.

HLASM and PL/I are large languages with macro facilities and, in PL/I's case, a preprocessor and a
famously context-dependent grammar with no reserved words. A full front end for either is a
multi-person-year project and is not what this product needs.

**The defensible target for those two is: 100% of what the corpus contains, measured, with
everything else reported as unparsed.** That is the same standard the rest of the tool already
holds itself to — `coverageIncomplete` exists because a finding count over source nobody read is
not a clean result. A PL/I reader that parses 94% of statements and *names the other 6%* is
honest and useful. One that silently skips them is neither, whatever percentage it claims.

Every phase below therefore has two numbers in its definition of done: what fraction of the corpus
parses, and what the tool says about the rest.

---

## 1. The architectural spine

The single most useful finding from the corpus census is structural, and it collapses four of the
five problems into one:

**BMS maps, IMS DBDs and IMS PSBs are HLASM macro source.** Same 72-column card format, same
`*`-in-column-1 comments, same non-blank-in-column-72 continuation, same
`label  operation  operands` shape. They differ only in which macros they invoke.

From the corpus, `.asm`/`.mac` files actually contain:

```
  114  real HLASM      (CSECT/START/DSECT)
   36  IMS DBD         (DBD/DATASET/SEGM/FIELD)
   32  IMS PSB         (PCB/SENSEG)
   10  BMS             (DFHMSD/DFHMDI/DFHMDF)
   35  unclear
```

So the extension tells you almost nothing and the content tells you everything — the same lesson
the extensionless-member work already taught, applied one level up.

### Build this first: extract `lib/cards.mjs`, then `lib/hlasm-cards.mjs`

**`lib/cards.mjs` is extracted** (2026-09-30): the column model (`cobolCard`, `statementCard`) and
operand splitting that respects nested parentheses and quotes (`splitOperands`, `parseOperands`,
`keywordSplit`). Continuation folding is still `foldStatements` in `lib/jcl.mjs`, with JCL's
columns 4-16; it moves when HLASM's reader gives it a second dialect.

The first draft of this plan said to "reuse its shape". That is how duplication gets written: in
practice it means copy it and let the two drift. **Extract it.**

`lib/cards.mjs` owns: the column model, continuation folding, `splitOperands`, `parseOperands`,
`keywordSplit`. `lib/jcl.mjs` is then a caller with JCL's own rules (`//` prefix, columns 4–16 for
continuation, `DD *` in-stream data). `lib/hlasm-cards.mjs` is a caller with HLASM's (`*` comment,
any non-blank in column 72, continuation columns 2–71).

The JCL tests must pass unchanged after the extraction. If they do not, the extraction changed
behaviour and is wrong.

### What `lib/hlasm-cards.mjs` adds

A card reader, not an assembler. It answers only: what are the statements, what are their label,
operation and operand fields, and which physical lines did each come from.

```js
export function readCards(text) -> {
  statements: [{ label, operation, operands, line, endLine, lines: [n], comment }],
  diags: [{ sev, line, text }],
}
export function parseOperands(field) -> { positional: [], keywords: Map }
```

Requirements, each of which a fixture must prove:

- Columns 1–71 are the statement; column 72 non-blank continues; 73–80 are the sequence area and
  are **not** the statement. This mirrors `lib/jcl.mjs`, which already does the same thing for JCL
  and should be read before writing this.
- A continued operand resumes in column 16 by convention, but HLASM accepts 2–71. Record the
  column; do not refuse the statement.
- `*` in column 1 is a comment. `.*` is a macro comment.
- Quoted strings may contain commas and parentheses, and may themselves continue across cards.
  This is `lib/cards.mjs`'s job, not this module's.
- A statement the reader cannot make sense of is emitted as `kind: 'unreadable'` and kept. Never
  dropped. This is the rule everywhere in this codebase.

**Effort: 6–10h for the extraction, 4–6h for the HLASM dialect on top.** Everything in phases 1, 2
and 4 sits on this, so it is worth over-testing.

---

## 1b. DRY: what to extract before adding anything

This section is a prerequisite, not advice. The duplication below is tolerable at nine rule sets.
At fourteen it is the thing that makes the codebase hard to change, and every one of these numbers
goes up by five if the phases below are built the way the existing sets were.

Measured in `lib/` at 2026-09-20:

| Duplicated | Files today | After five languages |
|---|---|---|
| `const byText = (a, b) => …` | 12 | 17 |
| `buildFileIndex(root)` | 11 | 16 |
| `relPath(root, f)` | 10 | 15 |
| `readSource(f).text` in a try/catch | 9 | 14 |
| `byRule[f.rule] = (byRule[f.rule] \|\| 0) + 1` | 8 | 13 |
| `f.sev = meta.sev; f.cwe = meta.cwe` | 3 | 8 |
| `const where = (x, path) => …` | 2 | 7 |

[`ruleset-contract.md`](ruleset-contract.md) already diagnoses the cause: the rule sets do their own
I/O, and every duplicated helper is a symptom of that. Its `defineRuleSet` removes most of this
list by construction — `byText`, `byRule`, the severity stamping and `where` all belong to the
framework, not to each set.

**So: land the rule-set contract before the language work, or land the language work as adapters on
it.** Building five more pre-contract rule sets means rewriting five instead of zero.

### Three extractions the languages specifically need

| Extract | From | Used by | Why |
|---|---|---|---|
| `lib/cards.mjs` | `lib/jcl.mjs` | JCL, HLASM, BMS, IMS DBD, IMS PSB | Column model, continuation, operand parsing. Five callers, one implementation |
| `lib/layout.mjs` | `lib/parser.mjs` | COBOL, PL/I, BMS symbolic maps, IMS segments | Level numbers → byte offsets and sizes. This is the graded part of the COBOL parser; a second implementation would be a second thing to grade |
| `lib/embedded-sql.mjs` | `lib/dataflow.mjs` | COBOL, PL/I | `sqlHostVars`, `sqlIntoRange`. PL/I embeds `EXEC SQL` identically |

`lib/layout.mjs` is the one that matters most. Offsets and sizes are what the byte-range taint model
runs on and what `diag/grade-against-gnucobol.mjs` measures. If PL/I computes its own offsets, the
project has two layout engines and one grade, and the README's accuracy table quietly stops covering
half the tool.

### The test for whether an extraction was right

The existing tests pass unchanged. Not "updated to match" — unchanged. An extraction that needs its
callers' tests rewritten has changed behaviour, and behaviour change is a separate commit.

### How the language readers relate

```
                         lib/hlasm-cards.mjs
                    (statements, operands, continuations)
                                   │
        ┌──────────────┬───────────┴───────────┬──────────────┐
        │              │                       │              │
   lib/bms.mjs    lib/ims-dbd.mjs        lib/ims-psb.mjs   lib/hlasm.mjs
   DFHMSD/MDI/MDF  DBD/SEGM/FIELD         PCB/SENSEG        CSECT/macros
        │              │                       │              │
   rules-bms       ─── rules-ims ───────────────┘         rules-hlasm

   lib/db2-ddl.mjs   (independent: SQL, not cards)  ──>   rules-db2
   lib/pli.mjs       (independent: free format)     ──>   rules-pli
```

`lib/pli.mjs` is independent of the card reader but **not** independent of the COBOL engine: PL/I
declares structures with level numbers (`1 HV_CUSTOMER, 5 HV_CUST_NUMBER CHAR(10)`) and embeds
`EXEC SQL` exactly as COBOL does. It consumes `lib/layout.mjs` and `lib/embedded-sql.mjs` from
phase 0 — see section 1b. It must not compute its own offsets.

---

## 2. Phase 1 — BMS

### Why first

474 COBOL files across 32 repositories issue `EXEC CICS SEND MAP` or `RECEIVE MAP`. Today the flow
engine treats a `RECEIVE MAP` as a terminal source and stops there, because it has no idea what
fields the map contains. **BMS is where CICS terminal input is actually defined** — the map defines
the field names, their lengths, and whether they are input, output or both.

Without it, `cics-terminal` taint enters a symbolic map the engine cannot see inside. With it, each
input field becomes a source of known length, and a length mismatch between map and program becomes
checkable the way `cics-commarea-length-exceeds-area` already is.

Corpus: 357 `.bms` files in 29 repositories, plus ~10 more hiding in `.asm`.

### Specification

Parse three macros, in this nesting:

| Macro | Meaning | Operands that matter |
|---|---|---|
| `DFHMSD` | Map set | `TYPE`, `MODE` (IN/OUT/INOUT), `LANG`, `TIOAPFX`, `CTRL`, `STORAGE` |
| `DFHMDI` | Map within the set | `SIZE=(rows,cols)`, `LINE`, `COLUMN`, `JUSTIFY` |
| `DFHMDF` | Field within the map | `POS=(r,c)`, `LENGTH`, `ATTRB`, `INITIAL`, `PICIN`, `PICOUT`, `OCCURS` |

Produce:

```js
{ mapsets: [{ name, mode, lang, maps: [{ name, size: {rows, cols},
    fields: [{ name, pos: {row, col}, length, attrb: [], initial, picin, picout, line }] }] }],
  diags: [] }
```

**The symbolic map is the deliverable, not the screen.** For `LANG=COBOL`, BMS generates a copybook
whose structure is mechanical: for each named field, a group with `xxxL` (halfword length), `xxxF`
(flag), `xxxI`/`xxxO` (input/output data of `LENGTH` bytes). Generate that layout and hand it to the
existing engine as if it were a copybook. That is what makes this phase worth doing: the flow
engine needs no change at all.

### Rules unlocked

| Rule | Severity | What it catches |
|---|---|---|
| `bms-unprotected-input-field` | info | Fields a terminal user can type into — the taint sources, enumerated |
| `bms-field-longer-than-program-item` | high | A map field longer than the COBOL item receiving it |
| `bms-map-not-found` | info (coverage) | `RECEIVE MAP` naming a map no `.bms` in the tree defines |
| `bms-dark-field-with-initial` | med | `ATTRB=DRK` with an `INITIAL` value — data on screen but not displayed |

Plus: `cics-terminal` flow sources gain the real field name and length.

### Oracle and definition of done

1. Every `.bms` in the corpus parses with zero `sev: 'error'` diagnostics, or the file is named.
2. Round trip: reserialise each statement, compare to the original modulo whitespace.
3. **No assembler oracle — this is settled (§0).** z390 does not ship IBM's `DFH` macro libraries,
   and zCICS emulates the command-interface macros (`DFHRESP`, `DFHVALUE`, `DFHEIENT`,
   `DFHEISTG`), not the BMS map-definition family (`DFHMSD`, `DFHMDI`, `DFHMDF`). Round-trip and
   fixtures are the method. **The README says BMS maps are read, not assembled**, in the same
   sentence-shape used for the COBOL grade.
4. Hand-built fixtures for: continuation inside a quoted `INITIAL`, `OCCURS` on a field, a map set
   with multiple maps, `ATTRB` as both single value and list.
5. Four benchmark case pairs.

**Effort: 10–16h** on top of the card reader.

---

## 3. Phase 2 — IMS

### Why second

122 call sites across 16 repositories (`CALL 'CBLTDLI'`, `EXEC DLI`), 93 DBD/PSB files. IMS is a
complete database tier the engine does not model: today a program reading an IMS segment shows no
`database` source at all, so a taint path from IMS to a sink is invisible.

The security-interesting part is not the data model, it is the **authorization model**. A PSB
declares, per program, which segments it may touch (`SENSEG`) and what it may do to them
(`PROCOPT`). `PROCOPT=A` is all operations including delete; `PROCOPT=G` is get only. That is an
access-control declaration sitting in a repository, and nothing reads it.

### Specification

**DBD** (`lib/ims-dbd.mjs`):

| Macro | Operands that matter |
|---|---|
| `DBD` | `NAME`, `ACCESS=(method,organisation)`, `PASSWD`, `ENCODING` |
| `DATASET` | `DD1`, `DEVICE`, `SIZE` |
| `SEGM` | `NAME`, `PARENT`, `BYTES`, `RULES` |
| `FIELD` | `NAME=(name,SEQ,U/M)`, `BYTES`, `START`, `TYPE` |
| `LCHILD`, `XDFLD` | secondary indexing — record, do not model initially |

Produce a segment hierarchy with byte offsets, which is the same shape as a COBOL record layout and
should reuse the same representation.

**PSB** (`lib/ims-psb.mjs`):

| Macro | Operands that matter |
|---|---|
| `PCB` | `TYPE` (DB/GSAM/TP), `DBDNAME`, `PROCOPT`, `KEYLEN`, `PROCSEQ` |
| `SENSEG` | `NAME`, `PARENT`, `PROCOPT` |
| `SENFLD` | `NAME`, `START` |
| `PSBGEN` | `LANG`, `PSBNAME`, `IOASIZE` |

**The DL/I call interface** (extends `lib/dataflow.mjs`):

`CALL 'CBLTDLI' USING function-code, pcb, io-area [, ssa...]`. The function code is a 4-character
literal or item: `GU`, `GN`, `GHU`, `ISRT`, `REPL`, `DLET`.

- `GU`/`GN`/`GHU` fill the **io-area** → a `database` source, exactly like `EXEC SQL ... INTO`.
- `ISRT`/`REPL` read the io-area → a sink for data at rest, like an SQL write.
- `DLET` deletes → relevant to the destructive-operation rules.
- The PCB argument identifies which database, via the PSB. Link it.

`EXEC DLI` is the command-level equivalent and maps to the same model.

### Rules unlocked

| Rule | Severity | What it catches |
|---|---|---|
| `ims-procopt-broader-than-used` | high | PSB grants `PROCOPT=A`; the program only ever issues `GU`. Least privilege, measurable from source |
| `ims-segment-not-sensitive` | high | A program references a segment its PSB does not declare — it will fail, or the PSB is stale |
| `ims-dbd-password-none` | med | `PASSWD=NO` on a DBD holding sensitive segments |
| `ims-unqualified-destructive-call` | high | `DLET`/`REPL` with no SSA — operates on whatever is positioned |
| `ims-to-*` flow rules | crit/high | IMS segment data reaching the existing sink set |

`ims-procopt-broader-than-used` is the one to lead with. It is a real least-privilege finding,
computed by comparing two files neither of which mentions the other, and it maps cleanly to
DORA 9(4)(c), NIST AC-6 and FFIEC IS II.C.7.

### Definition of done

1. Every DBD and PSB in the corpus parses clean, or is named.
2. Segment byte offsets computed and checked against `BYTES=` totals — a self-consistency oracle
   that needs no external tool.
3. A DL/I taint path demonstrated end to end in `bench/cases/`, with its near-miss negative.
4. `ims-procopt-broader-than-used` proven on a hand-built PSB/program pair.
5. Corpus measurement: fire rate per rule, per repository share.

**Effort: 24–32h.**

---

## 4. Phase 3 — DB2 DDL

### Why third

304 `.sql`/`.ddl` files across 22 repositories. Cheapest of the five and independently useful: the
DDL says which tables exist, which columns they have, and — the security-relevant part — who was
`GRANT`ed what.

This is also the phase that makes the existing SQL rules better. Today `EXEC SQL` host variables are
tracked without knowing the column they came from. With the DDL, a host variable filled from a
column the DDL marks sensitive can be reported differently from one filled from a status flag.

### Specification

Parse, at minimum, the statements the corpus contains — census before writing:

- `CREATE TABLE` (columns, types, `NOT NULL`, constraints), `CREATE INDEX`, `CREATE VIEW`
- `ALTER TABLE ... ADD/DROP COLUMN`
- `GRANT` / `REVOKE` — privilege, object, grantee, `WITH GRANT OPTION`
- `CREATE PROCEDURE` / `FUNCTION`, including `EXTERNAL NAME` (a link to a load module)
- z/OS specifics: `IN DATABASE`, `IN TABLESPACE`, `CCSID`, `EDITPROC`, `VALIDPROC`, `FIELDPROC`

`EDITPROC`/`VALIDPROC`/`FIELDPROC` name **exit programs that run inside DB2** — an execution path
that no COBOL rule set would ever find. Treat them as first-class.

### Rules unlocked

| Rule | Severity | What it catches |
|---|---|---|
| `db2-grant-to-public` | crit | `GRANT ... TO PUBLIC` — every user on the system |
| `db2-grant-with-grant-option` | high | Grantee may re-grant; the privilege escapes the model |
| `db2-exit-routine-declared` | med | `EDITPROC`/`VALIDPROC`/`FIELDPROC` names a program that runs inside DB2 |
| `db2-table-not-in-source` | info | A table the DDL defines that no program in the tree references, and the reverse |

### Definition of done

1. A census of statement types present in the corpus, committed, so coverage is stated not assumed.
2. Every statement type in that census parses; anything else is reported as unparsed with its text.
3. Differential check against a mature SQL parser on the subset both accept — used to find
   disagreements, not as truth, since neither speaks Db2 for z/OS exactly.
4. Three benchmark case pairs, `GRANT ... TO PUBLIC` among them.

**Effort: 12–18h.**

---

## 5. Phase 4 — HLASM

### Scope, stated honestly

114 genuine HLASM files across the corpus. Assembler matters because assembler stubs are where
programs do what COBOL cannot: issue supervisor calls, modify their own storage, switch into
supervisor state.

**A full HLASM front end is out of scope and should stay out of scope.** The macro facility alone
is a programming language; conditional assembly with `AIF`/`AGO`/`SETA` is Turing-complete in
practice. Building it would consume the whole budget for the least corpus evidence of the five.

### What to build instead: a privileged-operation reader

The card reader already gives statements. This phase adds a table of opcodes and macros that matter
and reports their use, without pretending to assemble anything.

| What | Why it matters |
|---|---|
| `SVC` (any), `MODESET` | Supervisor call; `MODESET KEY=ZERO` is a state change |
| `PC`, `PR`, `SSAR`, `LASP` | Cross-memory services — reaching another address space |
| `MVCL`, `MVCP`, `MVCS` | Long and cross-key moves; the usual buffer overflow |
| `EX`, `EXRL` | Executes an instruction built at run time. Self-modifying by design |
| `STORAGE OBTAIN/RELEASE`, `GETMAIN/FREEMAIN` | Storage management, and a leak surface |
| `LINK`, `LOAD`, `XCTL`, `ATTACH` | Loads and transfers to a module named at run time |
| `RACROUTE`, `RACHECK`, `RACINIT` | The security product interface, called directly |
| `CSECT`, `DSECT`, `ENTRY`, `EXTRN` | Structure, and the linkage the COBOL side may call |

The one piece of real analysis worth doing: **resolve `ENTRY` and `CSECT` names and match them
against COBOL `CALL` targets.** That closes a hole the COBOL engine has today — a `CALL 'SUBRTN'`
resolving to an assembler module currently reports `jcl-exec-pgm-unresolved` or nothing at all.

### Rules unlocked

| Rule | Severity | What it catches |
|---|---|---|
| `hlasm-supervisor-state-change` | crit | `MODESET KEY=ZERO` / `MODE=SUP` |
| `hlasm-executes-built-instruction` | high | `EX`/`EXRL` |
| `hlasm-cross-memory-service` | high | `PC`/`SSAR`/`LASP` |
| `hlasm-calls-security-product` | med | `RACROUTE` and relatives — inventory, not defect |
| `hlasm-provides-called-module` | info | Closes the COBOL `CALL` that currently resolves to nothing |

### Definition of done

1. Every `.asm`/`.mac` in the corpus reads as cards with zero errors, or is named.
2. z390 assembles the corpus files that are real HLASM; count how many, and report the rest.
3. The opcode table is a committed data file with a source citation per entry — the same discipline
   as `rules/advisories.json`, and for the same reason.
4. A COBOL `CALL` resolving to an assembler `ENTRY` is demonstrated in `bench/cases/`.
5. **The README states plainly that HLASM is read, not assembled.**

**Effort: 20–28h** for the reader and rules. Not a front end.

---

## 6. Phase 5 — PL/I

### Scope

78 `.pli` files across 11 repositories. The corpus sample shows PL/I used exactly as COBOL is:
`PROCEDURE OPTIONS(MAIN)`, level-numbered structures, `EXEC SQL INCLUDE SQLCA`, embedded SQL with
host variables.

PL/I's grammar is genuinely hard: no reserved words, so `IF IF = THEN THEN THEN = ELSE` is valid.
A full front end is out of scope for the same reason as HLASM.

**Target the subset the corpus uses**, measure it, and name the rest.

### Specification

1. **Statement splitting.** Semicolon-terminated, respecting `/* */` comments (which nest in some
   dialects), quoted strings, and the `%` preprocessor statements. Get this right before anything
   else; everything depends on it.
2. **`DECLARE`/`DCL` structures.** Level numbers and attributes: `CHAR(n)`, `FIXED BIN(n)`,
   `FIXED DEC(p,q)`, `PIC`, `BIT(n)`, `VARYING`, `BASED`, `UNION`, `LIKE`.
   **Compute byte offsets and total sizes**, and represent them in the same structure
   `lib/parser.mjs` uses for COBOL items. This is the single highest-value piece: it makes the
   existing dataflow engine work on PL/I with no change.
3. **`PROCEDURE`/`ENTRY`** declarations and their parameters — the equivalent of `PROCEDURE
   DIVISION USING`, and the crossing point for JCL `PARM`.
4. **`EXEC SQL`** — identical handling to COBOL. Reuse `sqlHostVars` and `sqlIntoRange`.
5. **`CALL`**, and `FETCH`/`ENTRY VARIABLE` for dynamic dispatch.
6. **`READ`/`WRITE`/`GET`/`PUT`** file I/O as sources and sinks.

### Rules unlocked

Mostly the existing flow rules, which is the point: once PL/I items carry offsets and sizes, the
byte-range taint model applies unchanged, and every `*-to-*` rule works. Plus:

| Rule | Severity | What it catches |
|---|---|---|
| `pli-based-storage-addressing` | info | `BASED` variables — the PL/I equivalent of `SET ADDRESS OF`, and belongs in the `opaque` set |
| `pli-entry-variable-call` | high | Dynamic dispatch through an entry variable |
| `pli-preprocessor-in-use` | info (coverage) | `%INCLUDE`/`%IF` — the source read is not the source compiled |

### Definition of done

1. **A measured parse rate over the corpus**, per statement, published the way the COBOL parser's
   grading table is. Not "100%" unless it is 100%.
2. Structure offsets checked against a hand-built fixture set with known sizes; against Iron Spring
   PL/I if its licence permits redistribution of a grading harness — **verify the licence before
   depending on it**.
3. Every unparsed statement counted and reported; `coverageIncomplete` set when any exist.
4. An `EXEC SQL` taint path through PL/I demonstrated in `bench/cases/`.

**Effort: 32–44h** for the corpus subset. A full front end is several times that and is not
recommended.

---

## 7. Sequencing, and why this order

```
  PHASE 0  ruleset contract  ──┐
           lib/cards.mjs       ├── nothing below starts before these
           lib/layout.mjs      │
           lib/embedded-sql    ──┘
                     │
      ┌──────────────┼───────────────┬──────────────┐
      │              │               │              │
   hlasm-cards ──┬── BMS ────────┐   db2-ddl       pli
                 ├── IMS ────────┤   (parallel)    (needs layout.mjs)
                 └── HLASM ──────┘
                                 └── measure ── ship after each
```

0. **Extractions and the contract.** Not optional and not deferrable. Five new rule sets built the
   old way is five rewrites; `lib/cards.mjs` alone has five callers.
1. **BMS** — highest value per hour, and it improves an existing rule set rather than adding an
   isolated one.
2. **IMS** — largest genuine capability gain; `ims-procopt-broader-than-used` is the strongest
   single rule in this document.
3. **DB2 DDL** — cheap, parallelisable, improves existing SQL rules.
4. **HLASM** — bounded scope, closes the unresolved-`CALL` hole.
5. **PL/I** — last because it is the largest and least evidenced, and because it consumes
   `lib/layout.mjs`, which BMS will already have exercised through symbolic-map generation.

| Phase | Hours |
|---|---|
| 0 — extractions (`cards`, `layout`, `embedded-sql`) | 14–22 |
| 1 — BMS | 10–16 |
| 2 — IMS | 24–32 |
| 3 — DB2 DDL | 12–18 |
| 4 — HLASM | 20–28 |
| 5 — PL/I | 32–44 |
| **Total** | **112–160** |

For calibration, the engine as it stands took roughly 14 hours of engineering time. This is eight to
eleven times the existing tool. That is not an argument against doing it; it is an argument for
doing phase 0 first, shipping after each phase, and not committing to all five before the first has
been measured.

Phase 0 looks like pure cost and is not: it removes roughly 20 duplicated helpers that would
otherwise be written five more times, and it is the difference between one graded layout engine and
two ungraded ones.

---

## 8. Invariants every phase must hold

These are not new. They are what the existing code already does, and a new language that breaks
them will be wrong in a way the tests will not catch.

1. **Two-phase.** `perFile` returns a summary, never a parse tree. `finish` computes findings from
   summaries. `rules-cics.mjs` exhausted an 8 GB heap by ignoring this.
2. **Guarded traversal.** Use `eachWithinMemory` from `lib/memory.mjs`. A byte budget does not bound
   a structure whose size is not measured in bytes.
3. **Nothing is dropped silently.** An unreadable file, an unparsed statement, an unresolved
   `%INCLUDE` or `COPY` — each is counted, named, and sets `coverageIncomplete`.
4. **A new rule brings a benchmark pair.** One positive, one near-miss negative, CWE-labelled.
5. **A finding names its location by where the compiler would see it**, not where the text sits —
   a construct from a copybook or `%INCLUDE` is reported at the included file's line.
6. **No root paths.** Everything goes through the `SourceTree` port.
7. **Rule counts are tripwires.** `test/feed.test.mjs` asserts `CATALOGUE.size`; update it
   deliberately, and let it fail first.
8. **One implementation per concept.** Before writing a helper, grep `lib/` for it. `byText`,
   `where`, the severity stamping and the `byRule` tally are the framework's, not a rule set's. A
   second copy of the column model or the layout computation is a defect, not a convenience —
   `lib/layout.mjs` in particular is the graded part of the tool, and a second one would be
   ungraded by definition.
9. **Extraction preserves behaviour.** Callers' tests pass unchanged, or it was not an extraction.

---

## 9. Risks, and what to do about them

| Risk | Mitigation |
|---|---|
| ~~**z390 does not ship `DFH`/IMS macros**~~ — **CONFIRMED, not a risk any more** | Settled in §0. BMS and IMS have no external oracle; round-trip and `BYTES=` self-consistency are the method, and the README states they are read, not assembled. Budget more hand-built fixtures in phases 1 and 2 accordingly |
| **Iron Spring PL/I's licence forbids a redistributable harness** | Check before phase 5. Fall back to fixtures with hand-computed offsets |
| **Scope creep into a real assembler or PL/I front end** | The definition of done for phases 4 and 5 is a *measured subset*. If a pull request starts implementing conditional assembly, it has left the plan |
| **Corpus bias** | The corpus is star-ranked public GitHub COBOL: teaching material, vendor demos and tooling. Its manifest says so. A rule quiet here is quiet on *that* population, not on a bank |
| **Five half-parsers** | Ship after each phase. The project's credibility rests on one parser being genuinely graded; four ungraded ones would cost more than they add |
| **Phase 0 gets skipped under delivery pressure** | It is the phase with no visible output, so it is the one that gets cut. Cutting it means five more copies of twenty helpers and a second, ungraded layout engine. Treat it as the gate on phase 1, not as preparation for it |

## 10. Open questions for whoever picks this up

1. ~~Does z390 ship the `DFH` and IMS macro libraries, or only the assembler?~~ **ANSWERED (§0).**
   It does not — they are IBM-proprietary and licensed. zCICS covers the `EXEC CICS` command
   interface, not the BMS map-definition macros; IMS has no emulation at all. HLASM keeps its
   oracle; BMS and IMS do not. One open sub-question remains worth an hour: does anything in
   zCICS or the public-domain MVS 3.8 library resolve `DFHMSD`/`DFHMDI`/`DFHMDF`? Assume not.
2. Should the BMS symbolic map be generated as a synthetic copybook and fed through the existing
   `COPY` resolver, or represented natively? The former is less code and reuses a graded path; the
   latter is cleaner. Recommend the former and record the decision.
3. Is PL/I a cobolwork feature or a separate product? It shares the engine but not the name, and
   the answer changes how it is packaged and licensed.
4. `.asm` in the corpus is 36% IMS. Should IMS DBD/PSB detection be content-based, like the
   extensionless-member work, rather than extension-based? Recommend yes, and reuse `sniffKind`.
