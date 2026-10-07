# The precompiler

A specification for `lib/precompile.mjs`, which translates embedded SQL and CICS into COBOL a compiler
accepts and the flow engine reads, line for line. Status: step 1 (SQL) built, 2026-09-27; step 3
(CICS) built, 2026-09-27, with its HANDLE branch unconfirmed until observed; step 4 (WEB, DOCUMENT,
INQUIRE and SET, APPC and the asynchronous API) built and step 6 (`build --precompile`) built,
2026-10-05. The tables of verbs and
options are filled from IBM's documentation as each family is built, and nothing here is a copy of
IBM's text or of another precompiler.

---

## 1. Why this exists

- **Programs the compiler refuses.** Over the 3,185 recently active repositories (cobolwork-a4,
  2026-09-27), 29,906 of 124,279 programs fail to compile with EXEC SQL, EXEC CICS or EXEC DLI in
  them. GnuCOBOL has no Db2 or CICS precompiler, so none of them can witness anything.
- **The stand-in is for grading.** `diag/precompiler.mjs` blanks each block so the compiler accepts
  the program while the parser reads the original. That is right for grading the parser and wrong
  for anything that runs: a blanked `EXEC SQL SELECT ... INTO :A` no longer writes `A`.
- **The flow engine reads EXEC blocks privately.** `lib/dataflow.mjs` re-parses each block's
  options to find sources and sinks. A translation into ordinary CALLs with direction makes the
  movement of data through SQL and CICS explicit, in one place.
- **The build gate compiles.** A rehosted estate compiling with `cobc` needs its CICS and Db2
  programs precompiled first.

## 2. What it produces

`precompile(src, { format, items, mapsets, copybook })` returns `{ text, map, copybooks, handlers,
stats }`: the program's text with each EXEC block replaced by a CALL naming the verb, written over
the block's own lines; what does not fit follows on added lines. Columns outside the blocks are
preserved. `map[i]` is the source line output line `i + 1` came from. `copybooks` holds the
stand-ins its COPY statements need that no repository holds (SQLCA, SQLDA, DFHEIBLK, DFHAID,
DFHBMSCA, and the symbolic maps of the `mapsets` given), and each COPY member that needed
translating, to be found ahead of the repository's copy. `handlers` lists the HANDLE, IGNORE, PUSH
and POP HANDLE commands with their options.

    EXEC SQL SELECT NAME INTO :WS-NAME FROM CUST WHERE ID = :WS-ID END-EXEC.
      becomes
    CALL 'CW-SQL-SELECT' USING BY CONTENT WS-ID BY REFERENCE WS-NAME SQLCA .

    EXEC CICS READ FILE('CUSTF') INTO(WS-REC) RIDFLD(WS-KEY) RESP(WS-RESP) END-EXEC.
      becomes
    CALL 'CW-CICS-READ' USING BY CONTENT 'CUSTF' BY REFERENCE WS-REC WS-KEY WS-RESP DFHEIBLK .

`items` are the program's data items as `lib/parser.mjs` reads them. Without them a host-variable
array is passed unsubscripted, which a compiler refuses, and a declaration a copybook makes is not
seen. `mapsets` are BMS mapsets as `lib/bms.mjs` parses them, for the repository's maps it holds
no copybook for. `copybook(name)` returns a COPY member's text, or null; without it no member is
translated.

## 3. Decisions

1. **One CALL per block, named by verb and option.** `CW-SQL-<verb>`, `CW-CICS-<verb>`, with
   `EXECUTE IMMEDIATE` as `CW-SQL-EXECUTE-IMMEDIATE`, DECLARE GLOBAL TEMPORARY TABLE as
   `CW-SQL-DECLARE-GLOBAL-TEMPORARY`, and a `WITH` common table expression as the `SELECT INTO` it is.
   The name says what the statement is; nothing IBM-internal is reproduced (no DFHEIV0 argument block).
   A block opens at `EXEC SQL`, or at `EXEC` ending a line with `SQL` opening the next, which Db2's
   coprocessor allows; the corpus has no EXEC CICS split that way. A CICS command is named by the
   words of IBM's command name, `CW-CICS-SEND-MAP`, `CW-CICS-READQ-TS`, `CW-CICS-HANDLE-CONDITION`:
   the longest name whose words follow the verb in order is taken first (`WEB READ HTTPHEADER`;
   `INQUIRE TRANSACTION`, though a PROGRAM option follows), then an option word anywhere tells a
   command from its namesakes (MAP makes SEND a SEND MAP), and where IBM's syntax makes one the
   default it is taken (READQ is READQ TS). A command outside the table is named by its verb and a
   following word that takes no argument, `CW-CICS-SPOOLOPEN-OUTPUT`. Blocks are found
   outside literals, and a literal continued onto a fixed-format continuation line resumes after the
   quote there; each program unit's own PROCEDURE DIVISION header says which of its blocks are
   statements.
2. **Direction in the argument list.** Operands read go `BY CONTENT`, operands written `BY
   REFERENCE`, then the status area; a variable read and written is in both. For SQL, from Db2 13's
   SQL Reference (SC27-8859), and the same in 12:
   - INTO writes the host variables it names, up to the clause that ends the list. `INSERT INTO` and
     `MERGE INTO` name a table, so an INSERT's VALUES are read.
   - SET writes its targets, in the list form `:A = x, :B = y` and the row form `(:A, :B) = (x, y)`;
     it evaluates every expression first, so `SET :N = :N + 1` reads and writes N. GET DIAGNOSTICS
     writes each `:V =` target, and ASSOCIATE LOCATORS its locator list.
   - A procedure's argument that is a lone variable, with or without its indicator, is read and may
     be written: whether it is IN, OUT or INOUT is in the procedure's definition on the server, which
     the program's source cannot show. An argument that is an expression, and `CALL :name`, are read.
   - `FETCH ... INTO DESCRIPTOR` and `USING DESCRIPTOR` are synonyms: the program fills the SQLDA and
     Db2 writes where it points, so the SQLDA is read and written. DESCRIBE and PREPARE `INTO :da`
     read its SQLN and write the rest; OPEN and EXECUTE read theirs.
   - Everything else is read, including every CONNECT operand.

   For CICS, from one table per command in `provenance/precompile.json`, read from each command's
   syntax and option descriptions in the CICS TS 5.3 Application Programming Reference (SC34-7402),
   the INQUIRE and SET commands from the System Programming Reference (SC34-7429), with the page for
   each, and the asynchronous API added after 5.3 (RUN TRANSID, FETCH, FREE CHILD) from IBM's CICS TS
   6.x pages, hashed: a data-value, name, filename, systemname, hhmmss or ptr-value is sent, a
   ptr-ref received, a cvda received by ASSIGN and sent everywhere else it is taken, and a data-area
   received unless its option says it is also sent or only sent.
   - Sent only, though typed data-area: every FROM, TOKEN on REWRITE, DELETE and UNLOCK, RIDFLD on
     STARTBR, RESETBR and DELETE, ABSTIME on FORMATTIME, RESOURCE on ENQ and DEQ, DATA on FREEMAIN,
     INPUTMSG, and the COMMAREA of XCTL and RETURN, whose contents go to a program that does not
     return here.
   - Both: LINK's COMMAREA, in which the linked program returns results; RIDFLD on READNEXT and
     READPREV, set to the key read; RIDFLD on READ (a generic read of a CICS-maintained data table
     that finds nothing clears it) and on WRITE (an output field under RBA or XRBA); LENGTH on READ,
     READNEXT, READPREV, RECEIVE, READQ TS, READQ TD and RETRIEVE, the maximum on the way in and the
     length on completion; FLENGTH on GET CONTAINER; ITEM on WRITEQ TS.
   - RESP and RESP2 receive on every command, and every option of ASSIGN and ADDRESS receives.
   - INQUIRE returns its options, and the one naming the resource is both, since a browse's NEXT
     returns the next name in it. SET is given its options. A cvda goes the way its description's
     verb says (SC34-7429 p. 8): "specifies" sends, "returns" receives.
   - Where a description says CICS returns a value in an option its syntax types data-value (WEB
     RECEIVE STATUSCODE, DOCUMENT RETRIEVE LENGTH), the description decides, with a note.
   - DATASET is the translator's synonym for FILE (SC34-7429 p. 647), and sends as FILE does.
   - RECEIVE MAP without INTO or SET writes the map's input record, `<map>I`, and SEND MAP without
     FROM or MAPONLY reads `<map>O`, as the reference says the name defaults, where the map is named
     by a literal.
   - A literal, a figurative constant, `LENGTH OF` or a `FUNCTION` goes BY CONTENT whatever its
     option, since nothing can write it; received and both-ways operands go BY REFERENCE.
   - The EIB, `DFHEIBLK`, goes last BY REFERENCE: every command sets EIBRESP, EIBFN and the rest.
   - A command the table lacks passes each data name BY REFERENCE and is counted in
     `stats.unknown`; an option the table lacks on a known command is counted in `stats.undirected`.
   Without direction every host variable reads as written.
2a. **The status area.** An SQLCA the program includes, copies or writes out is passed after the
   operands. `INCLUDE SQLCA` brings a stand-in with Db2 for z/OS's 136-byte COBOL layout: SQLWARN0
   to SQLWARN7 in SQLWARN, then SQLWARN8, SQLWARN9, SQLWARNA and SQLSTATE in SQLEXT, with the
   STDSQL(YES) names SQLCADE and SQLSTAT redefining SQLCODE and SQLSTATE. A program with no SQLCA
   and a standalone SQLCODE, as STDSQL(YES) and SQLCA-less programs declare, passes SQLCODE.
   `INCLUDE SQLDA` brings an SQLDA stand-in from the field names and pictures IBM documents.
3. **Lines one for one where the CALL fits.** The CALL's words fill the block's lines, the
   continuation lines from area B, and where only a period follows `END-EXEC` the rest of that
   line's code area too. What still does not fit goes on lines added after the block, with the
   block's trailing period or sentence after it, and `map` sends each added line to the block's
   last line. A finding lands on its source line either way.
4. **INCLUDE becomes COPY.** The compiler needs the copybook; the parser reads the original source,
   where it already expands `EXEC SQL INCLUDE` (97d9edf), so nothing is expanded twice.
5. **WHENEVER becomes the branch it is.** WHENEVER is a declaration applying in listing order, not
   in flow: from the statement on, each later executable block adds, per condition in force,
   `IF <test> GO TO X END-IF` after its CALL, and `WHENEVER <condition> CONTINUE` ends it. The label
   may be written with a colon. The tests, from Db2's definitions of the conditions: SQLERROR
   `SQLCODE < 0`, NOT FOUND `SQLCODE = 100`, SQLWARNING `SQLWARN0 = 'W' OR (SQLCODE > 0 AND SQLCODE
   NOT = 100)`, and with only a standalone SQLCODE its SQLCODE half. They are written in that fixed
   order: IBM does not document the code it generates, nor which branch wins when two conditions
   hold. With no status area there is nothing to test, and no test is written. Modelling the branch
   in `lib/control.mjs`, for the §11a rule in `build-gate.md`, is its own step.
5a. **Declarations leave nothing behind.** In the data division a block is blanked with its period;
   a cursor's `DECLARE` records the host variables its query sends, which its `OPEN` then sends.
   In the procedure division DECLARE CURSOR, STATEMENT, TABLE and VARIABLE, `WHENEVER` and
   `BEGIN`/`END DECLARE SECTION` become `CONTINUE`, so a sentence keeps its shape. DECLARE GLOBAL
   TEMPORARY TABLE is executable and is translated.
5b. **A host-variable array passes its first element.** A compiler refuses an OCCURS item named
   without a subscript, and the first element is where the array starts, which is also where Db2's
   descriptor points for an array. `:T-NAME` under one OCCURS is passed as `T-NAME (1)`, with one
   subscript for each OCCURS on it or a group above it. Db2 documents only one-dimensional arrays at
   levels 2 to 48, so a nested one compiles here but may be refused by Db2. A rowset FETCH or INSERT
   touches up to n elements, which the flow engine has to read from the statement, not the CALL.
5c. **HANDLE becomes the branch the translator writes, unconfirmed.** HANDLE CONDITION, HANDLE AID
   and HANDLE ABEND LABEL become their CALL followed by `GO TO <labels> DEPENDING ON DFHEIGDI`, one
   label per labelled option in the order written. For HANDLE ABEND LABEL the reference says control
   returns to the HANDLE ABEND command and a COBOL GO TO then runs; that the GO TO is a DEPENDING ON
   over DFHEIGDI, and that HANDLE CONDITION and HANDLE AID are written the same way, comes from two
   published studies of translated COBOL (van den Brand, Sellink and Verhoef 1997; Sellink, Sneed
   and Verhoef), and is recorded as secondary. DFHEIGDI is the EIB halfword IBM's APAR PI88564 and
   C5 translator option name, declared `S9(4) COMP` after EIBTRMID in the EIB stand-in; it is 0 when
   the HANDLE runs, so control falls through. SERVICE LABEL, which IBM's translators write between the
   CALL and the GO TO, is left out: GnuCOBOL 3.2 refuses it. A HANDLE applies in execution order, from
   when it runs until an IGNORE CONDITION or another HANDLE for the condition, per program and link
   level, and a command with RESP or NOHANDLE is exempt; so no branch is written after later commands,
   as WHENEVER's is. Drawing the edge from each later command to the label is the control model's.
   IGNORE CONDITION, PUSH HANDLE and POP HANDLE become their CALL; all six are returned in
   `handlers`. Unobserved until IBM's translator is run.
5d. **The EIB, and DFHCOMMAREA where it is named, go into the LINKAGE SECTION.** The CICS
   Application Programming Guide (SC34-7401) says the translator makes each program's LINKAGE
   SECTION, which it creates when there is none, declare DFHEIBLK and DFHCOMMAREA. Each program unit
   with CICS in it, or naming an EIB field, gets `COPY DFHEIBLK.` after its LINKAGE SECTION header, or
   before its PROCEDURE DIVISION header under a LINKAGE SECTION (and DATA DIVISION) added for it,
   unless it declares DFHEIBLK itself. `01 DFHCOMMAREA PIC X.` is added only where the unit names
   DFHCOMMAREA without declaring it: a declaration nothing names changes nothing a compiler or a
   reader sees, and the one-byte size is this project's choice, the guide giving none. Added lines map
   to the header they follow or precede. The PROCEDURE DIVISION header keeps its USING as written: a
   compiler needs none to accept a program that names a LINKAGE item.
5e. **DFHRESP and DFHVALUE become IBM's numbers.** Outside the blocks and as an argument, in their own
   columns, padded to the length of what they replace. The RESP numbers are the EIBRESP table of the
   Application Programming Reference, Appendix A, with BUSY (128) from CICS TS 6.x; the CVDA numbers
   are the System Programming Reference's (SC34-7429) alphabetic and numeric tables, taken where they
   agree, which is everywhere but ADDRESS. A name neither table holds is left as written, which a
   compiler then refuses, and counted in `stats.unresolved`.
5f. **COPY members are translated, as the integrated translator does.** IBM's separate translator
   never sees a COPY member and refuses one holding a command; the integrated translator, the
   compiler's CICS option, translates members. The corpus's members holding EXEC CICS belong to
   integrated builds, so a member the `copybook` resolver returns is translated where it is copied,
   in listing order with the program's own blocks (so WHENEVER runs through it), in the division the
   COPY sits in, and returned under its name in `copybooks` when anything in it changed. A member that
   brings in the PROCEDURE DIVISION header starts the procedure division at its COPY.
6. **Stand-ins are lifted, not copied.** The EIB declaration and the BMS symbolic-map writer come
   from `diag/precompiler.mjs` (8769b1d): the writer now lives in `lib/precompile-cics.mjs`, which the
   stand-in imports. The stand-in's DFHRESP and DFHVALUE literal is always 0; the translator writes
   IBM's number (5e). The DFHAID and DFHBMSCA names are read from `provenance/words.json`, each
   declared as one character. `lib/cics-commands.mjs` is generated from `provenance/precompile.json`
   and `provenance/words.json` by `diag/generate-precompile.mjs`, and a test holds the two equal.
7. **Facts from IBM's documentation, confirmed by compiling.** Each verb's operands and their
   direction are recorded in `provenance/precompile.json` with the document that attests them, and
   each translated family is confirmed with `cobc`. IBM's own behaviour waits on a z/OS system
   whose terms of use permit it; until then an IBM behaviour the documentation states is recorded
   as unobserved. Unobserved for SQL: the code Db2
   generates for WHENEVER and the order of its tests; WHENEVER with only a standalone SQLCODE; which
   nested arrays Db2 accepts; nested INCLUDE under the coprocessor, where IBM's manuals disagree.
   Unobserved for CICS: the HANDLE branch (5c); whether READ with GENERIC or GTEQ, STARTBR or RESETBR
   write RIDFLD back; where the translator puts DFHEIBLK among the program's LINKAGE items and how it
   declares DFHCOMMAREA; DFHRESP and DFHVALUE in a VALUE clause. Nothing is taken from
   Open-COBOL-ESQL, GnuCOBOL or IBM's translators (`build-gate.md` §16).

8. **The flow engine reads the table's reading, not the CALL text.** The translation is the compile
   artifact. The flow engine, the rule sets and the control analysis read each EXEC block through
   `lib/exec-reading.mjs`: its options' argument tokens, its words, the command the table names and
   each option's direction. The block stays a node on its own line, so a finding's fingerprint, the
   end a RETURN or XCTL makes and the unconfirmed HANDLE and WHENEVER branches (5, 5c) stay out of
   the flow graph; a CALL would return, and its arguments name no option.
   - 5a: every reader takes the command from the reading.
   - 5b: the control analysis takes an option as written only where the table says CICS returns a
     value in it, receives or both. A command or option the table lacks is read as before.
   - 5c: a value CICS returns is a source where it comes from outside the program. A web request's
     form field, query parameter and header, which WEB READ, WEB READNEXT and WEB EXTRACT return,
     are `cics-web`. An item READQ TS or READQ TD returns, and the data a START passed that RETRIEVE
     returns, are `cics-queue`: stored by another task, whoever can write the queue or start the
     transaction controls it, and it is data at rest as a file record is. Its 16 rules mirror the file
     record's and warn in the build gate until their precision is measured. What CICS returns about
     itself is no input and reaches only what a web caller is sent: ASSIGN's abend detail (ABCODE,
     ABPROGRAM, the ASRA fields) is `system-response`, as RESP is, and what ASSIGN returns about the
     region (APPLID, SYSID, NETNAME, QNAME) and INQUIRE about a resource is `cics-system-info`
     (CWE-497), whose two rules warn until measured. The task's own user and QUERY SECURITY's access
     decision are no source.

## 4. Order of work

| Step | Family | Measured by |
|---|---|---|
| 1 | SQL: SELECT INTO, INSERT, UPDATE, DELETE, WHENEVER | cobc acceptance of programs with only these |
| 2 | SQL: cursors (DECLARE, OPEN, FETCH, CLOSE), PREPARE, EXECUTE | same, plus dynamic-SQL flow findings unchanged |
| 3 | CICS: file control, program control, RETURN, RESP; HANDLE CONDITION as `GO TO ... DEPENDING`, unconfirmed until observed; and what the probe showed common: BMS and terminal SEND and RECEIVE, TS and TD queues, time, storage, START and RETRIEVE, containers, counters, ASSIGN, ADDRESS, SYNCPOINT, ENQ and DEQ | cobc acceptance; commarea and transfer findings unchanged |
| 4 | CICS: WEB and DOCUMENT, the system programming commands (INQUIRE, SET), the rest of terminal control | cobc acceptance; web and terminal flow findings unchanged |
| 5 | The flow engine reads the table's reading of each block instead of re-parsing it (decision 8): 5a the command, 5b the direction, 5c returned values as sources | 5a and 5b: every finding over the corpus's CICS repositories unchanged or explained; 5c: each new finding explained |
| 6 | `cobolwork build --precompile` checks each EXEC program's translation with the caller's cobc or gcobol before its compile runs (`build-gate.md` §8b) | the build scenarios B6.12 to B6.15, with a CICS program |

Step 1, measured 2026-09-27 with `diag/precompile-probe.mjs` over the 500-repository set, up to 40
programs a repository with EXEC SQL and no EXEC CICS or DLI: of 317, cobc accepts 98 translated
against 89 with the grading stand-in; 18 spill. The one program only the stand-in passes names a
host variable it never declares, which blanking hides.

Step 3, measured 2026-09-28 with `diag/precompile-probe.mjs` over the same set of 500 random
repositories, up to 40 programs of each kind a repository, EXEC DLI
left out, the translator reading COPY members from the directories cobc searches and both sides given
the symbolic maps of mapsets the repository holds no copybook for:

| Programs | Of | Translated | Stand-in | Only translated | Only stand-in |
|---|---|---|---|---|---|
| CICS, no SQL | 776 | 413 | 320 | 95 | 2 |
| CICS and SQL | 198 | 113 | 29 | 84 | 0 |
| SQL only | 317 | 106 | 89 | 18 | 1 |

137 of the 179 CICS and mixed programs only the translation passes needed a COPY member translated:
EXEC CICS, DFHRESP or the PROCEDURE DIVISION header in a copybook, which the stand-in leaves for the
compiler to refuse. The two CICS programs only the stand-in passes carry a CBL card, which is the
compiler's to read, and an INTO naming an item the program never declares, which blanking hides. The
SQL-only set passes 106, up from step 1's 98, the eight more through translated members. 36 CICS
programs hold a command outside the table, the system programming SET and INQUIRE leading. Every
error the translated CICS and mixed programs still meet the stand-in meets too; the commonest are
names the program never declares (paragraphs and a KICKS routine), symbolic maps whose REDEFINES
GnuCOBOL refuses, a DFHCOMMAREA group with no PICTURE, and copybooks no repository holds.

Step 4, measured 2026-10-05 over the same 500 repositories: of 205,951 EXEC CICS blocks in 13,671
files, the 255 in 34 commands the table lacked are 1, a misspelt ASKTTIME, and the 7,500 or so that
name a file with DATASET pass it as FILE is passed. Every block a command of step 3 named still names
it. `diag/precompile-probe.mjs` gives step 3's counts, 413 of 776 CICS programs, 113 of 198 mixed
and 106 of 317 SQL-only: a command outside the table already compiled, with every name passed BY
REFERENCE, so what step 4 changes is the direction step 5 reads.

Step 5, measured 2026-10-07 by full scans of the 72 repositories of the 500 that hold EXEC CICS,
with `COBOLWORK_FREE_MEMORY_MB=16000` so that no scan stopped for memory: 5a and 5b leave all 27,703
findings as they were. 5c adds 161 and changes none: 107 `cics-queue-to-cics-dynamic-transfer`, 30
`cics-queue-to-socket-send`, 16 `cics-queue-to-queue-name`, 5 `cics-queue-to-dynamic-file-path` and 3
`cics-web-to-reference-modification`, from a length WEB EXTRACT returns. In BankDemo's SBANK00P a
READQ TS restores saved state whose next program is LINKed to. Its queue-name routes are false: the
RETRIEVE fills the queue name, which two MOVEs overwrite before the DELETEQ, and a write kills no
route in the flow engine, for any source.

## 5. Out of scope

- A runtime. The CALLs name routines nothing implements; compiling is the goal, not running.
- EXEC DLI (IMS). Measured first; built if the corpora show it matters.
- Byte-for-byte compatibility with IBM's translator output.
