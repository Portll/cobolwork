## What this changes

<!-- One or two sentences. -->

## What it was measured against

<!-- This project states what each claim was measured on. A rule change needs a number: how many
findings it adds or removes over a corpus, and how many of those were checked by hand. A parser
change needs the grading run. "It looked right" is not a measurement. -->

## Checks

- [ ] `npm test` passes, with no test newly skipped
- [ ] A benchmark case covers the change, paired with a near-miss negative, and both compile
      (`node bench/run.mjs --validate`)
- [ ] No dependency added — runtime or development
- [ ] Claims in the README that this changes have been updated, with their measurement date
