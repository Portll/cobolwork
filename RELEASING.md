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
3. **Changelog and notes.** On the commit that is to be tagged, run `node diag/changelog.mjs <version>`.
   It writes the version's section at the top of `CHANGELOG.md` from `git log --no-merges` since the
   previous `v*` tag, and copies that section into `docs/releases/<version>.md` under
   `## Changes since <previous>`, which it owns to the end of the file. Write the notes' `## Summary`
   above it: the first paragraph is the benefit, each line opening with a hyphen a sub-item, a
   paragraph opening `**Limit:**` the limit; the site renders it as the release's row. Each feature
   and fix `--before` lists is named in the Summary or left out on purpose. Never edit the changelog
   section by hand: the notes are taken from it, not the changelog from the notes. Commit
   `CHANGELOG.md` and `docs/releases/<version>.md` in the release commit (step 4), and run
   `node diag/changelog.mjs --check <version>` before the tag. `test/changelog.test.mjs` fails CI
   for a release commit whose changelog lacks the version's section.
4. **Version.** Commit the changelog and notes with the version. commit-phase moves `package.json`'s
   patch version with every commit; a minor or major release is a commit that sets it by hand, with
   the subject `chore: release cobolwork <version>`. The tag is the version at the tagged commit.

## The tag and the registries

5. **Tag.** An annotated tag `v<version>` with the message `cobolwork <version>`, on the commit
   whose CI passed. Pushing the tag runs `release.yml`.
   Its `check` job fails the run unless the tag is `v` plus the version at the tagged commit, the
   commit is an ancestor of `origin/main`, and `ci.yml` has a successful run for that commit; every
   other job then skips. The builds run next, with provenance, and nothing publishes until all of
   them pass. Publishing is one job per registry, in order: GitHub release, npm, PyPI. Each
   job needs every build and the job before it. The GitHub release job has no environment and
   runs when the builds pass; each registry job then waits in the run's "Review deployments"
   until the operator approves it. After PyPI, a fourth job moves the Action's `v1` tag to the
   release commit, behind the `action-v1` environment's approval; it runs for stable `1.x.y`
   releases only.
   If a job fails, re-run that job from the run's page; never move or delete a release tag, since
   the tag ruleset forbids it. Until the npm trusted publisher is set (`npm trust github
   @portll/cobolwork --repo Portll/cobolwork --file release.yml --env npm --allow-publish`), the npm job
   fails and the jobs after it wait. To check the workflow without a release, run `gh workflow run
   release.yml -R Portll/cobolwork --ref main -f dry_run=true`: the checks and builds run and every
   publish job is skipped.
6. **GitHub release.** The release job creates the release at the tag with `--verify-tag`, attaches
   the tarball the build packed as `cobolwork-<version>.tgz` and `cobolwork.tgz` (commitwork's pin
   installs the first name), with `cobolwork-<version>.cdx.json` (the CycloneDX SBOM) and
   `SHA256SUMS`, and takes its notes from `docs/releases/<version>.md`, which step 3
   committed. The build packs twice and fails unless the two tarballs are the same bytes, and
   attests every file it attaches: `gh attestation verify cobolwork-<version>.tgz -R Portll/cobolwork`
   and `sha256sum -c SHA256SUMS` check a download. The `check` job fails a tag whose commit lacks that file.
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

## Yank and roll back

A yank stops new installs of a bad release and points every "latest" back at the release before
it. It deletes nothing. A new patch release then replaces the bad one. Nothing is tagged or
published again under the bad version: the ruleset `release tags are immutable` refuses moving or
deleting any `v*.*.*` tag and has no bypass, and npm and PyPI refuse a version they have held
before.

Below, `<bad>` is the bad version, `<good>` the newest release before it that is safe to use, and
`<fix>` the release that replaces it. `gh` is signed in as an account that can write to
Portll/cobolwork.

### When to yank

Yank when someone who installs `<bad>` now is worse off than with `<good>`:

- it does not install or does not start;
- it gives wrong results `<good>` did not: a build gate passes what it should fail, findings
  `<good>` reported correctly are gone, or coverage reads complete over files it did not read;
- it breaks a contract in STABILITY.md that its notes do not announce.

A fault `<good>` also has is no reason to yank; the fix release is enough. The operator decides to
yank. Claim it as a cut is claimed (step 1), from a task of your own under the cut task of `<bad>`,
so that no cut starts while the yank is half done.

### Where a release lands, and who acts

| Place | What the yank does | Who |
|---|---|---|
| The `release.yml` run for `v<bad>` | rejects a registry job still waiting | the operator, the only required reviewer of the `npm` and `pypi` environments |
| GitHub release `v<bad>` | its notes say it is withdrawn; Latest moves to `v<good>` | `gh` with write access to Portll/cobolwork |
| npm, `@portll/cobolwork` | `latest` moves to `<good>`; `<bad>` is deprecated | the npm user `portll`, the package's only maintainer, with its one-time password |
| PyPI, `cobolwork` | `<bad>` is yanked | an owner of `cobolwork` on pypi.org |
| The Action | follows npm's `latest` | nobody |
| commitwork's pin | goes back if it names `<bad>` | a session, through commit-phase |
| cobolwork-web | re-rendered | a session; the LaunchAgent deploys |

cobolwork publishes no crate. Trusted publishing covers only `npm publish` and `npm dist-tag` from a
workflow ([npm](https://docs.npmjs.com/trusted-publishers)), and `release.yml` has no yank job: the
npm steps run on the operator's own npm login.

### Y1. Stop what still waits

```sh
gh run list -R Portll/cobolwork --workflow release.yml --limit 5 \
  --json databaseId,headBranch,status --jq '.[] | "\(.databaseId) \(.headBranch) \(.status)"'
```

A line `<run id> v<bad> waiting` means a registry job is waiting for approval. Open the run with
`gh run view <run id> -R Portll/cobolwork --web`, click **Review deployments**, tick the waiting
environment and click **Reject**. The jobs after it are skipped. A job nobody approves fails by
itself after 30 days
([GitHub](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments)).

Check which registries hold `<bad>`:

```sh
npm view @portll/cobolwork@<bad> version
#   <bad> when npm holds it; "npm error 404 No match found for version <bad>" when it does not
curl -s -o /dev/null -w '%{http_code}\n' https://pypi.org/pypi/cobolwork/<bad>/json
#   200 when PyPI holds it; 404 when it does not
```

Skip Y3 when npm does not hold `<bad>`, and Y4 when PyPI does not.

### Y2. GitHub release

The tag stays. The release's notes, its Latest mark and its pre-release mark can be changed
([GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)).

Say that it is withdrawn. In the notes, under `## Summary`, add a paragraph after the first one:
`**Withdrawn:** <what is wrong>. Use <good>.` The site shows it in the release's row.

```sh
gh release view v<bad> -R Portll/cobolwork --json body --jq .body > /tmp/notes-<bad>.md
# add the paragraph to /tmp/notes-<bad>.md
gh release edit v<bad> -R Portll/cobolwork --notes-file /tmp/notes-<bad>.md
gh release view v<bad> -R Portll/cobolwork --json body --jq .body | grep Withdrawn    # the paragraph
```

Move Latest back:

```sh
gh release edit v<good> -R Portll/cobolwork --latest
gh api repos/Portll/cobolwork/releases/latest --jq .tag_name    # v<good>
curl -sI https://github.com/Portll/cobolwork/releases/latest/download/cobolwork.tgz | grep -i '^location'
#   location: https://github.com/Portll/cobolwork/releases/download/v<good>/cobolwork.tgz
```

That URL is the README's install from GitHub. If the first check still prints `v<bad>`, run
`gh release edit v<bad> -R Portll/cobolwork --prerelease` and check again: a prerelease cannot be
Latest ([GitHub](https://docs.github.com/en/rest/releases/releases#update-a-release)).

### Y3. npm

```sh
npm whoami    # portll; if not, npm login
npm dist-tag add @portll/cobolwork@<good> latest
npm deprecate @portll/cobolwork@<bad> "Withdrawn: <what is wrong>. Use <good>."
```

Each asks for a one-time password, or takes `--otp <code>`, while the account has two-factor
authentication. `latest` is what `npm install -g @portll/cobolwork` installs, and what the Action
installs by default ([npm](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag)). A deprecated
version can still be installed, and npm prints the message to whoever installs it
([npm](https://docs.npmjs.com/cli/v11/commands/npm-deprecate)).

Check. The registry can take a few minutes to show it.

```sh
npm view @portll/cobolwork dist-tags.latest    # <good>
npm view @portll/cobolwork@<bad> deprecated    # the message
```

### Y4. PyPI

Signed in to pypi.org as an owner of `cobolwork`, open
<https://pypi.org/manage/project/cobolwork/releases/>, click **Options** beside `<bad>`, then
**Yank**. Type the version, give the reason `<what is wrong>. Use <good>.` and confirm
([PyPI](https://docs.pypi.org/project-management/yanking/)). PyPI's documentation gives no command
for it.

pip then passes over `<bad>` unless asked for exactly `cobolwork==<bad>`, and warns with the reason
when it does install it ([PEP 592](https://peps.python.org/pep-0592/); pip 22.0 and later,
[pip](https://pip.pypa.io/en/stable/news/)). `pip install cobolwork` takes `<good>`.

```sh
curl -s https://pypi.org/pypi/cobolwork/<bad>/json | jq '[.urls[].yanked] | all'    # true
curl -s https://pypi.org/pypi/cobolwork/json | jq -r .info.version                  # <good>
```

The project's `info.version` is its newest release that is not yanked (`latest_release_factory` in
[warehouse](https://github.com/pypi/warehouse/blob/main/warehouse/legacy/api/json.py)).
**Options**, then **Un-yank**, undoes the yank.

### Y5. The Action

Workflows use `action.yml` as `Portll/cobolwork@main` or pinned to a commit
([docs/github-action.md](docs/github-action.md)); the `v1` tag moves only in the release workflow's
`action-v1` job. Its default
`version: latest` installs npm's `latest`, which Y3 moved. A workflow that sets `version: <bad>`
keeps `<bad>`, and npm's deprecation message shows in its log. When the fault is in `action.yml`
itself, revert it on main: `@main` workflows take the revert on their next run, and a workflow
pinned to a commit keeps that commit until its owner moves the pin
([GitHub](https://docs.github.com/en/actions/reference/security/secure-use)). A workflow on `@v1`
takes `action.yml` from wherever `v1` points. Move `v1` back to `<good>`'s commit by running
`gh workflow run release.yml -R Portll/cobolwork --ref v<good> -f dry_run=false -f action_v1=true`
and approving the `action-v1` deployment; Y1 rejects a waiting `action-v1` job of the bad run in the
same way as a registry job.

Check by re-running the pull request runs of Portll/cobolwork-action-test, which take the default
`version`:

```sh
gh run list -R Portll/cobolwork-action-test --workflow cobolwork.yml --event pull_request --limit 2 \
  --json databaseId,headBranch --jq '.[] | "\(.databaseId) \(.headBranch)"'
gh run rerun <run id> -R Portll/cobolwork-action-test    # for each of the two
gh run watch <run id> -R Portll/cobolwork-action-test --exit-status
```

`clean-change` ends in success and `flawed-change` in failure, as each is meant to. GitHub re-runs a
run only within 30 days of it
([GitHub](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs));
after that, Y3's check stands for the Action.

### Y6. commitwork's pin

In the commitwork clone beside this one:

```sh
git fetch -q origin && git show origin/main:manifests/tool-pins.json | jq -r .tools.cobolwork.version
```

When it prints `<bad>`, restore the pin before it. `--latest` only moves forward: it refuses a
release older than the pinned one.

```sh
git worktree add --detach ../commitwork-unpin-<bad> origin/main && cd ../commitwork-unpin-<bad>
git log --format='%h %s' -2 -- manifests/tool-pins.json
#   <sha1> chore(manifests): pin cobolwork <bad>
#   <sha2> chore(manifests): pin cobolwork <previous>
git checkout <sha2> -- manifests/tool-pins.json
node bin/cobolwork-pin.mjs --install
#   installed cobolwork <previous> (<commit>) at ..., verified; or: already installed and verified
node bin/cobolwork-pin.mjs --check
#   cobolwork <previous> (<commit>) is installed and verified at ...
CW_COMMIT_REPO=$PWD node bin/commit-phase.mjs \
  -m "chore(manifests): pin cobolwork <previous> while <bad> is withdrawn" -- manifests/tool-pins.json
git push origin HEAD:main
#   refused when origin/main moved meanwhile: remove the worktree and start Y6 again
```

The first command then prints `<previous>`. A commitwork checkout reads the pin from its own
working tree: the checkout that runs the lanes takes the rollback when it is brought to
origin/main.

### Y7. The site

In the cobolwork-web checkout, which is on main and has no remote:

```sh
node tools/build-site.mjs --releases
git status --short public/    # the pages it changed
```

The Releases rows are rendered again from GitHub, npm and PyPI: the latest pill moves to `<good>`
and the row of `<bad>` carries the Withdrawn paragraph. If Y6 moved the pin, change the pinned
version in `public/commitwork/index.html`, in the sentence that names `manifests/tool-pins.json`.
Then commit the changed pages to main:

```sh
CW_COMMIT_REPO=$PWD node ../commitwork/bin/commit-phase.mjs \
  -m "fix(releases): mark cobolwork <bad> withdrawn" -- <each changed page>
node tools/deploy.mjs --status    # a few minutes later: <time> <short sha> live <version id>
```

The deploy job refuses while a release fact on the site disagrees with GitHub, npm, PyPI or
commitwork's pin, and the hourly watch notifies until they agree.

### Y8. Check

From the cobolwork checkout:

```sh
node ../cobolwork-web/tools/release-check.mjs cobolwork --after <good>
```

Each FAIL that names `<bad>` is a step above not done. Record what was yanked, where, and this
output in the result of the task that holds the claim.

### Replace it

1. Land the fix on main. `release.yml` publishes only a commit on main, so `<fix>` carries
   everything on main since `v<bad>`; revert on main what is not ready to ship.
2. Cut `<fix>` with steps 1 to 12. Its version is main's patch version at the tagged commit. Its
   Summary says which release it replaces and why. With its notes (step 3), commit the Withdrawn
   paragraph, ending `Use <fix>.`, to `docs/releases/<bad>.md`, so the file says what the release
   page will say.
3. Once the GitHub release of `<fix>` exists (step 6), and before step 9 renders the site, point
   `<bad>` at `<fix>`: change `Use <good>.` to `Use <fix>.` in its GitHub notes as in Y2, and run
   `npm deprecate @portll/cobolwork@<bad> "Withdrawn: <what is wrong>. Use <fix>."` where npm holds
   `<bad>`. The PyPI reason can stay: pip shows it only to someone who asks for `<bad>` exactly.
4. Publishing `<fix>` moves every "latest" to it. GitHub makes a newly published release Latest
   ([GitHub](https://docs.github.com/en/rest/releases/releases#create-a-release)), a publish sets
   npm's `latest` ([npm](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag)), and `<fix>` is
   PyPI's newest release that is not yanked. Step 8 moves commitwork's pin forward with `--latest`.
5. For a vulnerability, publish the advisory with `<fix>`, as SECURITY.md says.
6. `release-check.mjs cobolwork --after <fix>` passes.

### When the files must go

Only when serving the files is itself the harm: a secret in them, or code cobolwork may not
distribute. Rotate a secret first: the tagged commit stays public. Do Y1 to Y6 first; Y6 matters
here, since commitwork's install of `<bad>` downloads the GitHub release's asset.

GitHub: delete the release, never with `--cleanup-tag`. The ruleset refuses deleting the tag, and
the tag stays ([gh](https://cli.github.com/manual/gh_release_delete)).

```sh
gh release delete v<bad> -R Portll/cobolwork --yes
gh release view v<bad> -R Portll/cobolwork    # release not found
```

npm: npm allows an unpublish within 72 hours of the publish when no package in the registry depends
on it; after that, only when the package also had fewer than 300 downloads in the last week and has
one maintainer. Otherwise npm refuses, and the deprecation from Y3 stands. The version can never be
published again ([npm](https://docs.npmjs.com/policies/unpublish)).

```sh
npm unpublish @portll/cobolwork@<bad>
npm view @portll/cobolwork@<bad> version    # npm error 404 No match found for version <bad>
```

PyPI: on `https://pypi.org/manage/project/cobolwork/release/<bad>/`, under **Delete release**, type
the version and confirm. Deletion is permanent, and the file names can never be uploaded again
([PyPI](https://pypi.org/help/#file-name-reuse)).

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://pypi.org/pypi/cobolwork/<bad>/json    # 404
```

Then run Y7 and Y8: the row of `<bad>` goes with its GitHub release.
