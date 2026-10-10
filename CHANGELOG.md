# Changelog

One section per release, newest first, listing the commits since the release before it by their
subjects. Chore, test, refactor, CI, build and style commits are not listed. `diag/changelog.mjs`
writes each section at the cut (RELEASING.md step 3), and a section is not edited after it.

## 0.9.0 - 2026-10-07

### Features

- **label:** record taint at a job's operations under --trace-input
- **diag:** set a listing with a missing copybook apart
- **label:** run a finding's job through its step, on z/OS records
- **label:** label in-stream findings by running their job
- **diag:** read IBM listings and grade sizes, offsets and refusals
- **layout:** size a pointer at 4 bytes under the IBM standard
- **flow:** credit a command that reads a checked field as one argument
- **diag:** read IBM listings and run-time output from public repos
- **label:** run a program with a mid-record RENAMES under extended
- **flow:** report input cut short, truncated or matching no branch
- **gate:** report statuses a program never tests after I/O, SQL or CICS

### Fixes

- **diag:** scan for copybooks after the IDENTIFICATION DIVISION
- **diag:** read a form feed a capture tool wrote as ^L
- **diag:** read a form feed in a listing as a line break
- **label:** open indexed files and name what stopped a run
- **label:** write each DD's records at its file's fixed length
- **label:** read transaction abend 4038 as a range check in CICS
- **test:** add the machine-pin import to the inventory test
- **gate:** let phrases, CLOSE and a cursor's FETCH answer for a status
- **flow:** report a STRING only where what it sends can overflow
- **gate:** leave a status unjudged where the program's order is unread

### Performance

- **flow:** raise the walk bounds to what ACAS needs
- **flow:** look only at the caller's own return edge from a callee
- **control:** find a field's lower-bound fact by its bound

### Documentation

- write the 0.9.0 release notes
- record where the flow walk's bounds stop a scan

## 0.8.0 - 2026-10-07

### Features

- **compile:** report programs that use the Communication feature
- **parser:** declare the data-names a CD's clauses name
- **flow:** report what CICS says about itself only to a web caller
- **evidence:** let a label name the assumptions its runs rested on

### Fixes

- **ironwork:** classify check messages by their id before their wording

## 0.7.0 - 2026-10-07

### Features

- **ims:** read DL/I calls and hold each PSB to the calls that use it
- **pli:** read PL/I in every scan, and finish the Db2 DDL phase
- **hlasm:** read machine instructions from the build's OPTABLE
- **hlasm:** count disassembly listings and documents apart from source
- **hlasm:** read every program of a batch file, past its first END
- **hlasm:** report a MODESET switch to a system key other than zero
- **flow:** follow queue items, START data and web form fields
- **hlasm:** read BTAM, VTAM basic mode and remote DECBs as MVS 3.8
- **hlasm:** read MVS 3.8 macro operands unless --no-mvs38-forms
- **diag:** add a --maclib option to the HLASM oracle
- **sarif:** carry each rule's framework clauses on its descriptor
- **evidence:** let a run journal's close record name its executor
- **control:** fill only the CICS options the command returns a value in
- **compliance:** map the tools' evidence to framework clauses
- **precompile:** direct WEB, DOCUMENT, INQUIRE and SET commands
- **build:** check precompiled EXEC programs with --precompile
- **hlasm:** read a repository's own IF or LINK as its macro
- **hlasm:** read data management and supervisor macros in every form
- **hlasm:** read model statements whose variables carry values
- **build:** judge a PDS export's members by their data set names
- **schema:** describe the reports and their findings
- **schema:** describe the smaller documents and check them in tests
- give explain, parse, baseline and evidence output a schemaVersion
- **feeds:** version the witness and reach feeds and name ignored keys
- **site:** version the site file and name the keys it ignores
- **sarif:** add a CWE taxonomy and list each file results name
- **hlasm:** read CCWs, model names and macros that redefine opcodes
- **rules:** run the IMS and Db2 rules in every scan
- **hlasm:** read list and execute forms of authorized-path macros
- **diff:** compare two revisions of a PDS export member by member
- **pds:** read XMIT files and IEBCOPY unloads in a PDS export
- **bench:** label files named at run time under --compliance extended
- **flow:** treat a CICS FILE or DATASET from input as a file path sink
- **ironwork:** read the message id ironwork puts before a message
- **ims:** flag full-update PCBs, unknown SENSEGs and short KEYLENs
- **ims:** model DBDs and PSBs with the checks DBDGEN and PSBGEN make
- **db2:** parse CREATE VIEW and ALTER TABLE for z/OS
- **ims:** parse PSB PCB, SENSEG, SENFLD and PSBGEN statements
- **pli:** read EDIT pairs, ALLOCATE, FREE and includes in a DECLARE
- **db2:** flag procedures and functions that run a load module
- **db2:** parse CREATE PROCEDURE and CREATE FUNCTION for z/OS
- **pli:** declare IBM's PL/I SQLCA where a program includes it
- **db2:** parse CREATE DATABASE, STOGROUP and TABLESPACE for z/OS
- **db2:** flag PUBLIC grants, grant options and exit routines
- **db2:** parse CREATE INDEX after the Db2 13 for z/OS reference
- **db2:** parse CREATE TABLE after the Db2 13 for z/OS reference
- Db2 DROP, COMMENT ON, LABEL ON, SET, RENAME and sequences parsed
- IMS DBD macros parsed, every operand checked
- Db2 GRANT and REVOKE parsed
- PL/I files take the records a job's DD statements supply
- IMS DBD/PSB and Db2 SQL read as statements, measured by kind
- PL/I subscripts, TITLEs and MAIN parameters reach the flow rules
- PL/I rule for error conditions caught and ignored
- PL/I rule for storage addressed through BASED pointers
- PL/I rules for calls through entry variables and FETCH by name
- PL/I rule for source the preprocessor changes before compiling
- PL/I %INCLUDE members spliced in before statements are split
- PL/I programs join the flow graph, read when asked for
- a contract for PL/I rules over parsed programs
- PL/I structure mapping, offsets and sizes by IBM's pairing rules
- PL/I preprocessor statements parsed
- PL/I EXEC SQL, EXEC CICS and EXEC DLI parsed
- PL/I ON, SIGNAL, REVERT and RESIGNAL parsed
- PL/I PUT, GET, DISPLAY, FORMAT and FLUSH parsed
- PL/I OPEN, CLOSE and record I/O statements parsed
- PL/I CALL, FETCH and RELEASE parsed
- PL/I DO, IF, ELSE, SELECT, WHEN, OTHERWISE and jumps parsed
- PL/I assignments parsed, compound and BY NAME included
- PL/I PROCEDURE, ENTRY, PACKAGE, BEGIN and END parsed
- PL/I DECLARE statements and structure fragments parsed
- the PL/I cursor drains what is left of a statement
- PL/I expressions parsed by precedence, with the references read
- PL/I stream I/O statements get a parser module of their own
- PL/I expressions as tokens and references, for statement parsers
- PL/I read as tokens and statements, measured by statement kind

### Fixes

- **hlasm:** set JCL and SMP/E cards aside wherever they stand
- **capabilities:** list the HLASM scan options
- **test:** compare a policy problem's path prefix as text
- **diag:** stage a library member as a macro only when it defines one
- **compliance:** quote the state-change rule's text as it now reads
- **diag:** assemble batch programs apart and grade inline-macro files
- **diag:** count a macro's MNOTE of severity 8 as refusing its call
- **abend:** read a CICS transaction abend 4038 as its LE condition
- **hlasm:** read a trailing comma on keyword-only macros as omitted
- **hlasm:** read storage execute forms, ESTAI lists and EXCP DCBs
- **flow:** count copies of a program with no procedure division as one
- **abend:** read a CEE3501S missing-program ending as input choosing it
- **sources:** read UTF-8 source a character to a column
- **hlasm:** read unnamed DSECTs and attributes split by a continuation
- **hlasm:** refuse what the assembler refuses in cards and lengths
- **sources:** keep EBCDIC fixed records when a constant holds X'15'
- **parser:** read every item and size of the 500 grade as GnuCOBOL does
- **build:** refuse a compiler with --pds-export before finding it
- **build:** refuse a compiler with --pds-export before looking for it
- **cards:** keep L'* and L'= from running into the remarks
- **scan:** add up execution coverage in a --repos summary
- **scan:** name the flow model and cobolwork in a --repos summary
- **sarif:** keep the advisories a finding rests on out of its locations
- **sources:** read past 4 KB when an assembler head is undecided
- **hlasm:** drop a model name that holds a variable symbol
- **evidence:** break a stale ledger lock by renaming a claim over it
- **pli:** give the record to loop bound fixtures a procedure
- **db2:** read FOREIGN KEY name and partition clauses as IBM shows
- **db2:** settle CREATE PROCEDURE and FUNCTION points against IBM
- **ims:** refuse DBD operands that end in a comma
- **pli:** make the terminal to dynamic SQL fixture valid PL/I
- **pli:** keep bench fixtures inside the source margins
- **db2:** keep a routine whole across CASE … END in its body
- a PL/I DO's control variable may be named LOOP, FOREVER or UNTIL
- a PL/I format item may be repeated by a parenthesised expression
- PL/I FETCH takes SET and TITLE together, in either order

### Performance

- **web:** read listener and URIMAP definitions in the shared pass
- **control:** let workers claim their own files, twice as far ahead
- **scan:** read recon, secrets and hidden through the shared pass
- **flow:** key the walk's visits by number
- **opaque:** find pointer declarations only when a CALL needs them
- **flow:** find the items inside a checked field by their offsets
- **semantics:** judge only COMPUTE statements without TRUNC(OPT)
- **compile:** read each copybook and its declarations once
- **crypto:** read programs through the shared pass
- build the control analyses of large programs in worker threads

### Documentation

- record web's definitions read in the shared pass
- record the control lookahead and the reads left outside the pass
- record control analyses built in worker threads
- **readme:** give the 500-repository grade after the residue fixes
- **hlasm:** give the held-out parse rate the reader reaches now
- state the contracts a release keeps in STABILITY.md
- **readme:** give the 500-repository grade as measured on 2026-10-04

## 0.6.0 - 2026-10-04

### Features

- **bench:** label argv and environment input on a rewritten copy
- **capabilities:** name the ironwork releases cobolwork reads
- **bench:** tell callers that reached the CALL from those that did not
- **bench:** label interface findings by whether a caller confirms them
- **abend:** read a subprogram fuzzed at its interface
- **policy:** gate abends from interface fuzzing by their own key
- **hlasm:** read COPY members in where the locator meets them
- **hlasm:** read EXEC CICS, EXEC SQL and EXEC DLI in assembler
- **hlasm:** parse MNOTE, COPY, PUNCH, REPRO, AINSERT, ICTL and ISEQ
- **hlasm:** map the runtime module rule and class its consequence
- **hlasm:** count a CALL macro's entry as an external the module needs
- **hlasm:** parse the Toolkit's structured programming macros
- **hlasm:** parse the Language Environment prolog and mapping macros
- **hlasm:** place constants holding date and time variables
- **hlasm:** parse LINK, XCTL, LOAD and ATTACH
- **hlasm:** read macro prototypes and model statements
- **hlasm:** name Language Environment and Toolkit macros as kinds
- **hlasm:** parse OPEN, CLOSE and DCB
- **hlasm:** parse ESTAE, ESPIE, ABEND and SNAP
- **hlasm:** parse WTO and WTOR
- **hlasm:** parse CALL, SAVE and RETURN
- **hlasm:** parse section, linkage and mode instructions
- **hlasm:** name the instruction an EX or EXRL runs
- **hlasm:** report modules named at run time and name what was not read
- **bench:** assemble HLASM cases with z390 and score chosen cases
- **hlasm:** parse EQU, ORG, USING, DROP, CNOP, LTORG and END
- **hlasm:** grade the locator against the z390 oracle
- **hlasm:** locate statements and symbols as the assembler would
- **hlasm:** parse MODESET, TESTAUTH and RACROUTE
- **hlasm:** parse GET, PUT, READ and WRITE
- **hlasm:** parse STORAGE, GETMAIN and FREEMAIN
- **hlasm:** grade the locator against z390 with macro-free values
- **hlasm:** match machine instructions against IBM's table
- **abend:** refuse a fuzz manifest in a format it does not read
- **hlasm:** parse PRINT, TITLE, EJECT, SPACE and CEJECT
- **hlasm:** add parser modules for linkage, I/O and output statements
- **hlasm:** read HLASM statements by kind and measure them
- **label:** record what taint found where the marker missed
- **label:** feed a job's in-stream data and stage ARITH(EXTEND)
- **abend:** say whether a kept abend recurs when compiled with OPT(2)
- **abend:** report an input-caused hang and an input-chosen program
- **build:** fail a check the pinned GnuCOBOL cannot generate
- **baseline:** write a version and migrate an unversioned file
- **evidence:** accept ironwork's statement and input-taint sink records
- report credentials written into COBOL source without gitleaks

### Fixes

- **bench:** rewrite an argv ACCEPT that ends with END-ACCEPT on its line
- **hlasm:** place literals in the reference's five pool segments
- **hlasm:** stop grading values z390 moves for its own reasons
- **evidence:** break a stale ledger lock only once
- **hlasm:** name COPY members by their file name on Windows too
- **rules:** report a JCL password phrase continued past column 71
- **abend:** report an input-caused hang as excessive iteration, CWE-834
- **rules:** read COBOL debugging lines and skip short hex values
- **rules:** report quoted, phrase and new passwords in mainframe sources
- **release:** publish the npm tarball by a ./ path
- **ironwork:** read the exit statuses ironwork keeps for itself
- **bench:** hold cases to cobc -std=ibm-strict unless they name another
- **hlasm:** keep the words of an EXEC statement after its first blank
- **hlasm:** read a lone comma as no operand on an assembler instruction
- **hlasm:** read a quote that opens the operands as a string
- **flow:** carry a job's in-stream data through READ INTO
- **flow:** resolve the scan root and read ironwork's exit code first
- **abend:** report a CICS task's data exception as an S0C7 finding
- **evidence:** require signers, pin the witness and check time-stamps

### Performance

- keep a program's fact sets in one buffer
- number flow call contexts instead of splitting strings per edge
- keep only what differs between flow nodes on each node
- analyse a large program's copies once in the flow set
- share check conditions with the same content across a scan
- share one empty list among flow nodes with no source or sink
- keep flow edges as columns laid out by source node
- keep each distinct fact set once, as the facts it holds
- read and parse each program once for every rule set

### Documentation

- **hlasm:** give the parse rate the reader reaches now
- record numeric contexts, pooled facts and lean nodes
- record control-analysis reuse in the scan-time backlog item
- specify control-analysis reuse as built, with its bound
- record that the flow set reads all of Unieuro within memory
- state the gates on reusing one program's flow analysis
- record scan time after the shared parse pass
- specify a compact flow graph and one analysis per program
- **hlasm:** give the regraded z390 figures and what is left ungraded
- **spec:** record the Iron Spring PL/I licence as unsettled
- **reach:** say an abend finding carries no verdict
- **hlasm:** give the statement locations the locator now places
- **hlasm:** describe the statement reader and its z390 grade
- state why coverage cannot refute a finding yet
- release by approving each registry in turn
- describe precision as machine labels and compliance as COBIT ids
- **security:** state what each command reads, writes and starts
- let the npm publish lag behind the rest of a cut

## 0.5.0 - 2026-10-02

### Features

- **seed:** plant four more flaws with near-misses beside each
- report weak cryptography a program asks ICSF for
- **flow:** list every route of a finding with --all-routes
- report cleartext CICS client opens and oversized web receives
- read HLASM as cards and report its privileged operations

### Fixes

- keep a check across EXEC CICS LINK, which reads the program name
- place a fuzz abend in a CALLed program under the library holding it
- name the repository depth in the z390 measurement
- place a fuzz abend in a library member under that library
- **rules:** report multi-line VALUE credentials and new JCL passwords
- read HLASM attribute references and refuse GNU assembler
- TSO and CICS credential rules stop at comments and statements
- credential rules pass over condition names and placeholders
- a kept value returns only to callers in its own run unit
- the seeder refuses a host whose communication area holds no storage

### Performance

- control analysis tests only the fields a write can overlap

### Reverts

- a kept value reaches every later caller again

### Documentation

- claim a cut by path and render the site's release rows
- measure precision from machine labels, not a hand-labelled corpus
- walk a release cut through RELEASING.md
- backlog the scan time of the two largest corpus repositories
- state what the commit-msg hook and commit-phase refuse
- define when coverage may refute a finding
- record the Betterleaks credential rules as PR 379 in review
- a printing program is compared with ironwork's virtual printer

## 0.4.0 - 2026-10-02

### Features

- the gate fails a patch that deletes the flagged or source line
- explain quotes whole statements, and the gate cobc's errors
- fixAt names the input field a STRING folded into a statement
- a COPY of a mapset held only as BMS reads its symbolic map
- a witness result can cite the ironwork run that reproduced it
- storage findings labelled by the SSRANGE abend, with a control
- precision per rule and per verdict from machine labels
- an abend ironwork's fuzzing kept is a finding, with its input
- measure-rules checks the corpus against the drive's manifest
- execution labels, each path finding's plan run in ironwork

### Fixes

- the fixAt STRING test reads its fixture with LF line endings
- a written-back argument returns only to the call it came in by
- the reserved-word generator strips tags by splitting
- a >>DEFINE body with a stray line break is read in linear time
- crafted input cannot slow a scan, split an argument or open a link
- an ODO count SSRANGE catches is a subscript-range abend
- the seeder skips a call the flow analysis holds no facts at

### Documentation

- backlog the gate's two credits a sound command fix needs
- backlog the gcobol patch waiting to go to GCC
- what the execution labels left unknown, read site by site
- the ironwork codegen session's handoff brief of 2026-09-30
- the four languages ship in 0.8.0 at the latest
- all four languages in language-coverage.md are decided
- execution labels over the whole corpus, memory pinned

## 0.3.0 - 2026-09-30

### Fixes

- a performed paragraph keeps the bounds it makes for itself
- a reference modification's length is judged with its start
- a directory a drive fails to list is retried, then counted unread

### Documentation

- backlog the index findings roadmap 1.4 leaves open

## 0.2.150 - 2026-09-30

### Features

- scan --pds-export reads a directory of PDS members
- evidence verifies ironwork's sink records, an input trace's labels
- a finding says whether the estate's runs entered its paragraph
- diff reads revisions out of git without writing them to disk
- every rule maps to a COBIT 2019 practice, by identifier alone
- evidence verifies ironwork's step records, one per job step

### Fixes

- SBOM keeps both twins of a PROGRAM-ID; SLSA redacts compiler values
- EIBCALEN checks the length only where it bounds the read
- a check holds across a loop that calls through the checked name
- equivalence sees deleted programs, hidden trailers, all statements
- an index bounded through another field's interval stops the bound
- sniff extensionless members from the git tree

### Documentation

- record roadmap 3.2, the PDS export and where sniffing lives
- COBOLWORK_EXECUTION in the README
- record roadmap 3.1, decided and measured

## 0.2.140 - 2026-09-30

### Features

- seeded near-misses beside each flaw, every plant a label
- DFHVALUE covers CICS TS 5.4 to 6.x, each CVDA with its release
- FTP transfers join the dataset flow as copies to a remote end
- a TSO batch step's ALLOCATE, CALL and DSN RUN are read
- IDCAMS PRINT and ALTER NEWNAME say where they move data
- IBM's reserved words by column, for ironwork's compile check

### Fixes

- UNSTRING writes the fields its DELIMITER and COUNT phrases name
- a reference modification is judged on its last byte
- the SBOM links what jobs run and what CICS transfers to
- code past column 72 is variable format among column-7 comments
- a backward scan under a not-blank test stops at 1 or more
- the Zowe lane reads past comments after commas, and native-config
- taking DFHCOMMAREA's address no longer exempts the length check
- the ledger is not extended past a last line that is no record
- two false high findings the precision audit found on the corpus
- a statement ironwork stops at is the program's error again
- the policy schema names requireEquivalence

### Documentation

- the remediation gate's caller, and its first real compiler
- the Action example is the one proven on GitHub-hosted runners

## 0.2.117 - 2026-09-30

### Features

- the build gate reads gcobol's options as it reads cobc's
- the build requires an equivalence statement for a change
- explain carries a verification plan per path finding
- a COBOL bill of materials, SLSA provenance and option changes
- seven more utilities say where they copy data
- the build gate reads ironwork check's return codes
- the CICS command, DFHRESP and DFHVALUE tables, for ironwork
- a GitHub Action runs the build gate and writes its SARIF
- evidence verify reads ironwork run journals
- a host-variable table shared with ironwork, read by both sides
- a run can leave sealed evidence; Zowe configuration is read
- the z/OS-derived rules the corpus left unbuilt, and N4, N6, N8, N9
- rules from ironwork's model of what the generated code decides
- the build gate compiles IBM estates with ironwork check
- IBM's compiler-option table, shared with ironwork
- a scan of several repositories keeps the estate facts it read
- the labelled corpus scores each exploitability verdict
- the estate's own test results confirm a verdict
- a program a URI map serves is started by its alias transaction
- the site draft lists the entries whose reach decides a verdict
- a verdict says where one patch covers every route
- each path finding says whether an attacker can use it

### Fixes

- a change to a copybook alone needs an equivalence statement
- a bound above the table or field size does not keep an index in it
- an index moved by a constant is judged on its shifted interval
- a loop exit that keeps the counter in range stops the bound
- an index computed from bounded operands takes their interval
- a relation over an arithmetic expression bounds the index in it
- a flag moved from a constant item holds that item's value
- list the index uses a finding covers; credit a line by its worst
- an increment from 0 raises a lower bound; UNTIL tests keep it
- a lower bound of 1 or more survives an increment that cannot wrap
- constants moved on every route bound an index within its field
- a VALUE item any statement writes is not a fixed bound
- a counter varied from a constant is bounded below in its loop
- rejecting zero by equality bounds an unsigned integer from below
- a check lowers an index finding only where one outcome decides it
- an index needs a lower bound, and a check that ran is not one
- evidence refuses a link on Windows too, and its tests run there
- nearest CALL holder and a bench patch test on Windows
- the option-table test ignores CRLF, as the other generated tests do
- **lib:** a CALL reaches the program of that id nearest the caller

### Documentation

- an index bound has two ends, and a check that ran keeps the tier
- counts and backlog items brought up to the code

## 0.2.76 - 2026-09-29

Nothing listed: every commit was a chore, test, refactor, CI, build or style change.

## 0.2.75 - 2026-09-29

Nothing listed: every commit was a chore, test, refactor, CI, build or style change.

## 0.2.74 - 2026-09-29

### Features

- build scripts are read command by command, as a shell reads them
- the check model reads conditions, flags, tallies and dead code

### Fixes

- a credential echoed to its own user is advisory; batch keeps it
- log-writes-a-credential asks what the field holds and who reads it
- a bound an OR can skip has not run, and one past the table is none
- the check model claims no dead code or bound it cannot show

### Documentation

- what counts as a check on an index, before the model reads it
- the precompile spec names no z/OS service

### Other

- Update README for clarity on memory and scans

## 0.2.65 - 2026-09-29

### Features

- a CICS option's argument is a reference, written where it receives

### Fixes

- compare the generated CICS table without line endings
- the precompile generator path is a file path on Windows

### Other

- cobolwork: security analysis for COBOL, JCL and CICS
