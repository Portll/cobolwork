# cobolwork: rules for agent sessions

- No `Co-Authored-By` trailer and no "Generated with" line on any commit or pull request. Check the
  message yourself: no hook refuses it, and `git commit-tree` runs none.
- Commit only your own paths; never `git add -A`. Where commitwork is installed, commit through its
  `bin/commit-phase.mjs`: `CW_COMMIT_REPO=<this repo> node <commitwork>/bin/commit-phase.mjs -m <msg> -- <paths>`.
- Comments: the code explains itself. Where a senior engineer skimming it would not follow, one line
  describing the function or the data flow. No marketing, no history of earlier behaviour, nothing
  that restates the code or a test's name.
- Run tests serially: `node --test --test-concurrency=1`. The memory guard reads the whole machine's
  free memory.
