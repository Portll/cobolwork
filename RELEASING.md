# Releasing cobolwork

Walk these steps in order at every cut. `tools/release-check.mjs` in the cobolwork-web checkout
beside this one checks the steps a machine can:

```sh
node ../cobolwork-web/tools/release-check.mjs cobolwork --before
node ../cobolwork-web/tools/release-check.mjs cobolwork --after <version>
```

It prints PASS, FAIL or TODO for each step and exits 1 on any FAIL.

## Before the tag

1. **Claim the cut.** In SPINE (`cobolwork-roadmap`), create a task of your own under the cut task,
   set it active, and `claim_files ["release:cobolwork"]` on it before any commit. A second
   session's claim is refused and names the task that holds the cut. `set_status active` refuses
   nothing, so activating the cut task is not a claim.
2. **CI.** `--before` passes only when main's last CI run is for main's head and every job passed.
   A red job is fixed on main before the cut.
3. **Notes.** Start from the commits `--before` lists since the previous release. Each feature and
   fix there is either named in the notes or left out on purpose. Commit the notes as `docs/releases/<version>.md`
   before the tag. They open with a
   `## Summary` section, which the site renders as the release's row: the first paragraph is the
   benefit, each line opening with a hyphen a sub-item, a paragraph opening `**Limit:**` the limit.
4. **Version.** commit-phase moves `package.json`'s patch version with every commit; a minor or
   major release is a commit that sets it by hand, with the subject
   `chore: release cobolwork <version>`. The tag is the version at the tagged commit.

## The tag and the registries

5. **Tag.** An annotated tag `v<version>` with the message `cobolwork <version>`, on the commit
   whose CI passed. Pushing the tag runs `release.yml`.
   Its `check` job fails the run unless the tag is `v` plus the version at the tagged commit, the
   commit is an ancestor of `origin/main`, and `ci.yml` has a successful run for that commit; every
   other job then skips. The builds run next, with provenance, and nothing publishes until all of
   them pass. Publishing is one job per registry, in order: GitHub release, npm, PyPI. Each
   job needs every build and the job before it. The GitHub release job has no environment and
   runs when the builds pass; each registry job then waits in the run's "Review deployments"
   until the operator approves it.
   If a job fails, re-run that job from the run's page; never move or delete a release tag, since
   the tag ruleset forbids it. Until the npm trusted publisher is set (`npm trust github
   @portll/cobolwork --repo Portll/cobolwork --file release.yml --env npm --allow-publish`), the npm job
   fails and the jobs after it wait. To check the workflow without a release, run `gh workflow run
   release.yml -R Portll/cobolwork --ref main -f dry_run=true`: the checks and builds run and every
   publish job is skipped.
6. **GitHub release.** The release job creates the release at the tag with `--verify-tag`, attaches
   the tarball the build packed as `cobolwork-<version>.tgz` and `cobolwork.tgz` (commitwork's pin
   installs the first name), and takes its notes from `docs/releases/<version>.md`, which step 3
   committed. The `check` job fails a tag whose commit lacks that file.
7. **npm.** The npm job publishes that tarball with `npm publish --access public` through trusted
   publishing: no token, no 2FA prompt, and provenance comes with it. A 409 "previously staged"
   means the publish is still processing, and the registry can take hours to show it. Steps 8 and 9
   need not wait: the release row renders the registries that hold the version, and `--releases`
   is run again once npm does.

## After

8. **commitwork's pin.** In commitwork, `node bin/cobolwork-pin.mjs --latest`, then `--install`
   and `--check`. Commit `manifests/tool-pins.json` through commit-phase from a worktree at
   origin/main, and push.
9. **The site.** In cobolwork-web, `node tools/build-site.mjs --releases` renders the release's row
   and the latest pill from the GitHub release. Bring the Overview and Features pages to the
   release, the Roadmap through `data/roadmap/cobolwork.json` and `node tools/build-site.mjs`, and
   the commitwork page's pinned version to step 8's pin. Commit to main: the deploy job refuses
   while a rendered section differs from its source or a release fact disagrees with GitHub, npm,
   PyPI or commitwork's pin, and publishes when none does.
10. **Check.** `--after <version>` passes: GitHub's latest release with its tarball, npm's latest
    dist-tag, PyPI, commitwork's pin, the site's pages and their live deploy.
11. **SPINE.** Complete the cut task and its parent, with the tag, the registries and the site
    version in the result.
12. **This file.** When a step changes, change it here in the same cut.
