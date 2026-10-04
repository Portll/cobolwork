# Handoff: ironwork for COBOL code generation (session "Ironwork Compiler Main")

```text
HANDOFF BRIEF — 2026-09-30 (second brief), session "Ironwork Compiler Main" (27fcc7cb)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

WORKING FOCUS
  Code generation for ironwork for COBOL (docs/codegen-runtime.md), run as parallel agents that
  this session reviews and lands. Step 1 (the runtime split into rt, and the new compile crate) is
  done through E9; E10 waits on one peer branch. Step 2 (the LIR and lowering) is on main, with
  220 of 282 test programs lowering; a control-flow rework for the new PERFORM model is running.

POSTURE (inferred; no plumb tool run)
  Current: (+0.30, -0.20, +0.30) — orchestration: dispatch, review, rebase and land
  Drift:   Z (scope) is wide against the refactoring standard  mild

OVERLOOK STATE (inferred; no overwatch tool run)
  A Intent: high. Scope is fixed by codegen-runtime.md §14 and roadmap tasks 2.1/2.2/3.3.
  B Observation: high for landed work (tests, clippy 1.98.1, tls, boundary test before each push).
  C Pattern: high. Move plus `pub use` re-export, then rebase at land time.
  D Risk: medium. Five sessions push to ironwork main; rebases are frequent and conflicts small.
  E Learning: recorded in SPINE ironwork-codegen tasks 6/7 and ironwork-roadmap 2.1/2.2/3.3.

OPEN WATCHPOST TRIGGERS
  veld is unreachable from this session; no manifest was read.
  NEXT-SESSION: land the control-flow rework; start E10 when cobolwork-c2's feat/divide-rounded lands.

SPINE STATE
  Owned roadmap tasks: ironwork-roadmap 2.1 (semantics library), 2.2 (LIR), 3.3 (load modules),
    each active with owner "Ironwork Compiler Main" and executedIn "ironwork-codegen".
  Plans: ironwork-codegen (task 6 = step 1, task 7 = steps 2-5), ironwork-dry-ddd-pass (task 4 folds
    into step 1).
  Files held: none claimed in SPINE; coordination is by cross-session message.

OPEN UNCERTAINTY (top 3; not from a scored artefact)
  - The lowering is checked for faults and round trips, not for results: there is no VM yet, so a
    lowering that changes a result is caught only by review (one such bug was found: see below).
  - The control-flow rework (return points, C99) is the largest change still unreviewed.
  - E10/E11 are large and touch machine.rs, which several sessions edit.

NEXT SKILL
  /verify — check the control-flow rework's claims against machine/perform.rs before landing it
  (Alternatives: /conflict before E10's rebase; /shipcheck for E10-E12)

NOTES FROM SESSION
  Second brief of the day. The first brief's content is superseded by the sections below.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Where things are

ironwork main is **0e55dde** at the time of writing. The last check before a push by this
session: 828 tests passed, clippy was clean on the CI toolchain (Rust 1.98.1), and the `tls/`
build passed.

### Landed by this session

| Commit | What |
|---|---|
| c717ddb | Specs: lir.md, semantics-library.md, load-module.md, benchmarks.md, bench/ |
| 2319867 | E1: test harness `exec/src/testing.rs` |
| 2dc9834 | E2: `calendar` |
| 273fc24, f58b794 | The `rt` crate, rt::module encoding, the boundary test, docs |
| 4815199 | Parser DRY (on_phrases, procedure_item, clause helpers, FD_WORDS) |
| 00c8e42 | E3: typed AbendCode, Signal, FileStatus |
| 184b182, 8d5945c, 49bcbb8 | E4a/E4b/E4d: calendar, Sym, edit, vocab (Pos, SIGN, INSPECT, BinOp, RelOp, AcceptFrom), codec, strings into rt |
| 3653230 | E5: Kind, Loc, Val into rt::storage |
| 0e6ca77 | E7: the SQL runtime into rt::sql |
| a0c0807 | DFHRESP reads IBM's full table; DFHVALUE folds to CVDAs |
| cca16a6 | EXIT PARAGRAPH/SECTION/PERFORM execution tests |
| 5d3f0d9 | E4c: Abend, AbendCode, Signal, FileStatus, Ending into rt::abend |
| ae9fa2d..f201664 | The LIR (rt::lir), load-module read/write, lowering slice 1, the Harness lowering check, tools/lower-coverage.sh |
| 3b750b7 | E6: files, cics, terminal, tn3270, the BMS model and the LINAGE page into rt; `rt::cics::Condition` (121 RESP rows) |
| 3535b08 | Lowering slice 2: CALL, CANCEL, ENTRY, GO TO DEPENDING, VARYING AFTER, ALTER, segments, OO |
| b08e80a | E8: the `compile` crate; run methods become the `exec::Execute` trait |
| 62bc2ec | Lowering slice 3: file I/O, SET, the 21 original intrinsics, inert DECLARATIVES |
| 00550ea | E9: the run unit into rt::unit (`RunUnit<'w, H, L: Loader<H>>`); exec/src/loader.rs |

Earlier the same day: DRY commits (bff14e9, 9ce03d4, a31c025, e79b69f, 42b36eb, 2c6b6b7), and
LE under CICS (574d97d).

### Running at the time of writing

- **step2/lower-return-points**, in worktree `ironwork-flow`, on an Opus agent:
  - rework lower/flow.rs and the rt::lir flow types to the interpreter's PERFORM return-point
    model: machine/perform.rs, assumption C99, which supersedes V1;
  - recheck segment restore (SetSegment);
  - lower the declaratives that run (USE AFTER ERROR, USE FOR DEBUGGING);
  - fix a result-changing bug in `move_plan`: a group sender to a numeric receiver must be a
    byte copy, as the walker does.

  Review its claims against machine/perform.rs before landing.

## Gates

| Next | Waits for |
|---|---|
| **E10** (storage/MOVE, loc, statement semantics, arithmetic core into rt) | cobolwork-c2's feat/divide-rounded (numeric ROUNDED intermediates, CURRENCY SIGN in the compile crate's PICTURE and rt::edit, machine arithmetic) landing |
| **E11a** (file_io.rs to rt/fileio.rs) | E10; tell cobolwork-11 before touching file_io.rs |
| **E11b** (the run-callee sequence and the CALL USING builder, DRY-1/DRY-2) | E10 |
| **E11c** (CicsCommand, with the checked-list test over rt::cics_tables::commands) | E10 |
| **E11d** (machine/sql.rs to rt::sql::run) | gate G1: message cobolwork-51 first |
| **E11e** (LE, SORT, Report Writer, OO runtime) | E10 |
| **E12** (close step 1: delete the forwarding methods, update codegen-runtime.md §6) | E11 |
| **Lowering to finish** | SORT (15 programs), Report Writer (14) and CICS (9) need their E11 moves. The 52 new intrinsics need Func rows over rt::intrinsic. `FUNCTION f(T(ALL))` is guarded Unsupported by cobolwork-51's b359789. WHEN-COMPILED needs a compile timestamp (SOURCE_DATE_EPOCH when set). lower/ moves to the compile crate. |
| **Step 3, the VM** | E10/E11. It must raise the same rt::unit Events at the walker's points: Load, Open, Close, and Paragraph{program, name, index} at paragraph entry (8aa0cdb). The differential test compares the event streams. |

## Peers

- **cobolwork-c2** (the next session after 39fb36dc; handoff
  `commitwork-sidecar/evaluations/handoff_2026-09-30_121d6d2a.md`):
  - feat/divide-rounded is the last branch before E10;
  - its task-17 diagnostics go in crates/compile/src/;
  - it messages at each landing.
- **cobolwork-51**:
  - rt::cics_tables (commands, DFHRESP, DFHVALUE to CICS TS 6.x with a `since` column);
  - rt::intrinsic (52 functions);
  - G1 covers machine/sql.rs.
- **cobolwork-11** ("MAINLINE + QWEN"):
  - evidence, the JCL runner (crates/jcl) and `ironwork job`;
  - rt::unit Events (Paragraph added);
  - it stays out of file_io.rs until E11a.
- **cobolwork-73**: relays the operator's roadmap broadcast. SPINE plans cobolwork-roadmap and
  ironwork-roadmap are the source of truth. Claim tasks with owner/executedIn, and record per
  roadmap-pace-qwen task 1.

## Operator decisions this session

- **Q6:** syntax depends on rt.
- **Load modules:** they encode every Options field.
- **The CICS tables split:** cobolwork-51 vendors them; this session builds on them.
- **DFHVALUE:** extended to CICS TS 6.x, with a `since` column and no release gating.
- **Qwen:** used per the roadmap broadcast, for small, supporting and bounded drafts, with
  critical-path work kept in session. Every use and every non-use is recorded against the roadmap
  task.
  - So far every step was either an integration move or a tiny edit, so Qwen has not been used.
  - Hosts and harness are in memory `offload-to-qwen.md`.

## How to land (what worked)

- **One worktree per branch** off `origin/main`, each with its own
  `CARGO_TARGET_DIR=~/.cargo-target-local/<name>`.
- **Stage explicit paths.** Pipe `git status --porcelain` through `xargs git add --`, since zsh
  doesn't split variables. Never `git add -A`.
- **Before every push:**
  - `cargo +1.98.1 clippy --workspace --all-targets --locked -- -D warnings`;
  - `cargo test --workspace --locked --no-fail-fast -- --test-threads=1`;
  - `cargo check --manifest-path tls/Cargo.toml --locked`.
- **Push:** `git push origin HEAD:main` only when `origin/main` equals `HEAD~1`. Peers land often:
  expect 1–2 rebases per landing.
- **Lockfile conflicts:** take main's version and let cargo regenerate it offline.
- **Commits:** as `Portll <john@portll.net>`, with no trailers. Branch names containing `-f` trip
  the force-push hook, so push `HEAD:main`.

## Outstanding outside ironwork

- SPINE main (8f4f99b) is unpushed. GitHub refuses it for email privacy (GH007), and the fix is an
  operator setting at <https://github.com/settings/emails>.
- Hercules PR #887 is awaiting its maintainers.
