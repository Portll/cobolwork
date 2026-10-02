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
   fix there is either named in the notes or left out on purpose. The notes open with a
   `## Summary` section, which the site renders as the release's row: the first paragraph is the
   benefit, each line opening with a hyphen a sub-item, a paragraph opening `**Limit:**` the limit.
4. **Version.** commit-phase moves `package.json`'s patch version with every commit; a minor or
   major release is a commit that sets it by hand, with the subject
   `chore: release cobolwork <version>`. The tag is the version at the tagged commit.

## The tag and the registries

5. **Tag.** An annotated tag `v<version>` with the message `cobolwork <version>`, on the commit
   whose CI passed. Pushing it runs `release.yml`, which publishes to PyPI.
6. **GitHub release.** Run `npm pack` in a clean detached worktree at the tag (`prepack` writes
   `lib/revision.json`). Attach the tarball as `cobolwork-<version>.tgz` and `cobolwork.tgz`;
   commitwork's pin installs the first name. The notes come from step 3.
7. **npm.** `npm publish <tarball> --access public` needs the maintainer's browser 2FA. A later 409
   "previously staged" means the publish is still processing.

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
