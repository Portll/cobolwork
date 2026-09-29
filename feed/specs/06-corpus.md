# ⑥ Hand-labelled flow corpus

Fifty real programs from the 300-repository set, with reachability marked per sink by a person.
[`../../BACKLOG.md`](../../BACKLOG.md) states the need exactly: flow precision is currently measured
on benchmark cases this project wrote, and a hand-labelled corpus would make it *a number with an
independent witness*.

| | |
|---|---|
| Task size | **Large** |
| Client benefit | **Small** — almost no buyer will ever ask about it |
| ROI rank | 6 of 6 |
| Estimate | 20–35h, nearly all human, **uncompressible** |
| But | Last by ROI, and the only item with a deadline |

## Why it is last, and why that is misleading

No customer will ask whether you have a hand-labelled corpus. It closes no deals. On pure
commercial ROI it ranks bottom and that ranking is honest.

It is also the item that gates everything reputational:

- **Any public precision claim.** The moment a number appears in a talk, a blog post or a README,
  the first competent question is "measured against what?" — and "cases we wrote ourselves" is the
  wrong answer in front of the audience you most want.
- **The NIST SARD submission.** Labelled cases are the deliverable.
- **The academic route.** A held-out corpus with human labels is the artifact; without it there is
  no paper.
- **The moat.** Of everything in the project this is the hardest for a forker to reproduce, because
  it costs a person's attention rather than compute. The engine is 3,075 lines and AGPL. The corpus
  is thirty hours nobody else wants to spend.

So: schedule it low, but schedule it **before** the first conference talk, not after.

## What ships

Nothing. **Results only.**

This is the one artifact that is neither open nor sold. It is published as a measurement — "flow
precision 0.9x, recall 0.9x, measured against 50 hand-labelled programs held out from development"
— and the corpus itself stays private. Distributing it would let a competitor tune against it, and
would let a forker claim the same number.

## Row shape

`kind: "corpus"` in [`../schema.mjs`](../schema.mjs): `method`, `labeller`, `labelledAt`, `repo`,
`program`, `sink`, `line`, `reachable`, `reasoning`. `reachable` is `true`, `false` or
`"undecidable"` (Method, step 4).

`method` **must** be the literal string `"human"`. The gate refuses anything else, and
[`../generate.mjs`](../generate.mjs) refuses to emit this kind at all — `corpus` is not in
`GENERABLE`. The prohibition is structural rather than a matter of discipline, because discipline
at 2am is not a control.

`reasoning` is required and must be at least 40 characters. A label without a reason cannot be
reviewed, cannot be disputed, and cannot be defended to a reviewer who disagrees.

## The rule that cannot be bent

**A model may not label this corpus.**

If Qwen marks reachability, the precision number becomes "our flow engine agrees with a 27B model,"
which is circular, worthless, and — worse — will be spotted immediately by exactly the reviewer
whose opinion the corpus was built to win. The corpus's entire value is that a human being
independent of the implementation decided each row.

This is not a caution about accuracy. A 27B model might well label them correctly. It is that a
correct label from a model is *still not evidence*, because the thing being measured is whether the
implementation matches human judgement.

## What the model may do

**Triage, which is a real speedup and contaminates nothing.**

Rank the 2,210 files in the 300-repo set by how informative a human label would be:

- programs with the most sinks reached by the current engine
- programs where the byte-range and whole-group models disagree — `diag/sibling-diff.mjs` already
  computes this, and disagreement between two models is the strongest available signal of a case
  worth a person's time
- programs with unusual constructs: deep `REDEFINES`, group `MOVE` chains, long `CALL` chains
- deliberate inclusion of programs with *no* findings, so the corpus measures false negatives too

Picking which 50 of 2,210 to read is a genuine 10× on the human cost, with no effect on what the
labels say. Do that.

## Method

1. Select 50 programs by the triage above. **Freeze the selection before labelling** and record it,
   so the set cannot drift toward programs that turned out to be convenient.
2. For each, enumerate every sink. Mark reachable / not reachable / undecidable. Write the reason.
3. Label **without looking at cobolwork's output.** If the tool's answer is visible the corpus
   measures agreement with a suggestion, not independent judgement. This is the single most
   important procedural rule and the easiest to break by accident.
4. Where a case is genuinely undecidable without runtime information, record it as undecidable.
   An honest `undecidable` count is more credible than a clean binary split, and it matches the
   project's existing instinct about coverage.
5. Only then run the engine and compute precision, recall and the confusion matrix.
6. Publish the number, the method, the selection criteria and the undecidable count. Not the corpus.

## Tools

    node diag/label-sheet.mjs <corpus> --programs 50 --seed <S> --out <dir> [--prefer sinks|mixed|no-findings]
    node diag/score-corpus.mjs <dir>/worksheet.json <dir>/answer-key.json.gz [--rows corpus.jsonl]

`label-sheet` chooses programs as `bench/seed.mjs` chooses hosts — distinct by content, round-robin
across repositories, in an order the seed fixes — and writes three files. `worksheet.json` lists
every sink the engine knows in those programs, reached or not, with blank `reachable`, `from` and
`reasoning`, and nothing of what the engine concluded. `answer-key.json.gz` holds its answers,
compressed so that a glance or a search does not show them. `selection.json` is the frozen
selection of step 1. `--prefer mixed` alternates programs with and without a reported path, so
misses are measured too, without saying which program is which; `--prefer no-findings` on its own
tells whoever chose it the answer for every site, so someone else labels that sheet.

`score-corpus` passes every label through the gate, lists what it refuses, and scores nothing while
a site lacks an accepted label, because the scores show the engine's answers. It reports precision,
recall, the undecidable count and the confusion matrix overall, per sink kind and per rule, and what
the figures do not cover. The per-rule figures need `from`, the kinds of source the labeller found
reaching a site. The key also holds the exploitability verdict the engine gives each site it
reports (`docs/spec/reach.md` §9), and the scorer gives a rate per verdict: how often a verdict that
names a route is at a reachable site, and how often `refuted` is at one that is not. With no access
facts in a public corpus, that measures the route half of the verdict and not whether an entry is
open. `--rows` writes the accepted labels as corpus rows. Neither the worksheet nor the key belongs
in this repository.

## Done when

- 50 programs, every sink labelled, every label reasoned.
- Selection criteria recorded and frozen before labelling began.
- Labels produced without sight of the tool's output.
- Precision, recall and undecidable rate computed and written into the README beside the parser
  grading table, which is where the equivalent number for the parser already lives.
- A second person has spot-checked a sample — even five rows — so the witness is not solely you.

## Risk

The temptation, at hour twenty of reading COBOL, to let the model "just check" the remaining ones.
That single shortcut destroys the entire artifact and leaves no trace that it happened. The
schema-level prohibition exists for that hour.
