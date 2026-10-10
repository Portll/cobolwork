// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './pin-machine.mjs';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../.github/workflows/', import.meta.url);
const workflows = readdirSync(dir).filter((f) => f.endsWith('.yml')).map((f) => [f, readFileSync(new URL(f, dir), 'utf8')]);

test('every workflow is indented with spaces and declares a name, triggers, permissions and jobs', () => {
  assert.ok(workflows.length >= 3);
  for (const [file, text] of workflows) {
    assert.ok(!text.includes('\t'), `${file} has a tab`);
    for (const key of ['name', 'on', 'permissions', 'jobs']) assert.match(text, new RegExp(`^${key}:`, 'm'), `${file} lacks ${key}:`);
  }
});

test('every third-party action is pinned by full commit SHA with a version comment', () => {
  for (const [file, text] of workflows) {
    for (const m of text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)) {
      if (m[1].startsWith('./')) continue;
      assert.match(m[1], /@[0-9a-f]{40}$/, `${file}: ${m[1]} is not pinned by SHA`);
      assert.match(m[2], /#\s*v\d+(\.\d+)*/, `${file}: ${m[1]} has no version comment`);
    }
  }
});

test('the release workflow attests the npm tarball, checks the pack twice and moves v1 behind an environment', () => {
  const text = readFileSync(new URL('release.yml', dir), 'utf8');
  assert.match(text, /tags: \['v\*\.\*\.\*'\]/);
  assert.match(text, /attest-build-provenance@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+subject-path: 'out\/\*'/);
  assert.match(text, /release-artefacts\.mjs same/);
  assert.match(text, /release-artefacts\.mjs sbom/);
  assert.match(text, /release-artefacts\.mjs sums/);
  const v1 = text.slice(text.indexOf('\n  action-v1:'));
  assert.match(v1, /environment: action-v1/);
  assert.match(v1, /permissions: \{\}/);
  assert.match(v1, /needs: \[check, build, npm-pack, release, npm, pypi\]/);
});

test('the Scorecard workflow runs on main and weekly with the least permissions', () => {
  const text = readFileSync(new URL('scorecard.yml', dir), 'utf8');
  assert.match(text, /branches: \[main\]/);
  assert.match(text, /cron:/);
  assert.match(text, /^permissions: \{\}/m);
  assert.match(text, /ossf\/scorecard-action@[0-9a-f]{40}/);
});
