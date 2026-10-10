// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes a release's section of CHANGELOG.md from the commit subjects since the release before it,
// and copies the section into the release's notes. RELEASING.md step 3 runs it at the cut.
//   node diag/changelog.mjs <version>          the section, and its copy in docs/releases/<version>.md
//   node diag/changelog.mjs --check <version>  the section matches the commits; the notes carry it
//   node diag/changelog.mjs --backfill         CHANGELOG.md from every v* tag, where there is none
// --root <dir> works on another checkout than this one.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHANGELOG = 'CHANGELOG.md';
const NOTES = ['docs', 'releases'];

const HEADER = [
  '# Changelog',
  '',
  'One section per release, newest first, listing the commits since the release before it by their',
  'subjects. Chore, test, refactor, CI, build and style commits are not listed. `diag/changelog.mjs`',
  'writes each section at the cut (RELEASING.md step 3), and a section is not edited after it.',
  '',
].join('\n');

// A section's groups in the order it shows them.
const GROUPS = [
  { title: 'Breaking changes' },
  { title: 'Features', type: 'feat' },
  { title: 'Fixes', type: 'fix' },
  { title: 'Performance', type: 'perf' },
  { title: 'Reverts', type: 'revert' },
  { title: 'Documentation', type: 'docs' },
  { title: 'Other' },
];
const LEFT_OUT = new Set(['chore', 'test', 'refactor', 'ci', 'build', 'style']);
const NOTHING = 'Nothing listed: every commit was a chore, test, refactor, CI, build or style change.';
const SUBJECT = /^([a-z]+)(?:\(([^)]*)\))?(!)?: (.+)$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const CHANGES = /^## Changes(?: since \S+)?$/m;

const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const readText = (file) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const notesPath = (root, version) => join(root, ...NOTES, `${version}.md`);
const notesName = (version) => `docs/releases/${version}.md`;

export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

// The group and line a commit subject takes, or null for a type the changelog leaves out.
export function entryOf(subject) {
  const m = SUBJECT.exec(subject);
  if (!m) return { group: 'Other', line: `- ${subject}` };
  const [, type, scope, bang, rest] = m;
  const line = `- ${scope ? `**${scope}:** ` : ''}${rest}`;
  if (bang) return { group: 'Breaking changes', line };
  if (LEFT_OUT.has(type)) return null;
  const listed = GROUPS.find((g) => g.type === type);
  return listed ? { group: listed.title, line } : { group: 'Other', line: `- ${subject}` };
}

// Subjects come in git log order, newest first, and keep that order within a group.
export function renderBody(subjects) {
  const entries = subjects.map(entryOf).filter(Boolean);
  const groups = GROUPS.map((g) => ({ title: g.title, lines: entries.filter((e) => e.group === g.title).map((e) => e.line) }))
    .filter((g) => g.lines.length);
  return groups.length ? groups.map((g) => `### ${g.title}\n\n${g.lines.join('\n')}\n`).join('\n') : `${NOTHING}\n`;
}

export const renderSection = (version, date, subjects) => `## ${version} - ${date}\n\n${renderBody(subjects)}`;

// A section's text from its heading up to the next section's heading.
export function sectionsOf(text) {
  const starts = [...text.matchAll(/^## /gm)].map((m) => m.index);
  return starts.map((start, i) => {
    const raw = text.slice(start, starts[i + 1] ?? text.length);
    return { version: /^## (\S+)/.exec(raw)[1], start, raw };
  });
}

export const bodyOf = (raw) => `${raw.replace(/\r\n/g, '\n').replace(/^[^\n]*\n+/, '').trimEnd()}\n`;

// The changelog with `section` as its newest. A section of the same version is replaced, an older
// version is refused, and every byte outside the new section is kept.
export function insertSection(text, version, section) {
  if (text === undefined) return `${HEADER}\n${section}`;
  const top = sectionsOf(text)[0];
  if (!top) return `${text}${text.endsWith('\n') ? '\n' : '\n\n'}${section}`;
  if (!VERSION.test(top.version)) throw new Error(`${CHANGELOG}'s newest section, ${top.version}, is not a version`);
  const order = compareVersions(version, top.version);
  if (order < 0) throw new Error(`${CHANGELOG}'s newest section is ${top.version}; ${version} is older, and an older section is not rewritten`);
  const rest = text.slice(order === 0 ? top.start + top.raw.length : top.start);
  return `${text.slice(0, top.start)}${section}${rest ? '\n' : ''}${rest}`;
}

// The notes with `body` under "## Changes since <previous>", which runs to the end of the file;
// what is written above it is kept.
export function notesWith(notes, previous, body) {
  const part = `## Changes${previous ? ` since ${previous}` : ''}\n\n${body}`;
  const m = CHANGES.exec(notes);
  const head = (m ? notes.slice(0, m.index) : notes).trimEnd();
  return head ? `${head}\n\n${part}` : part;
}

export function changesOf(notes) {
  const text = notes.replace(/\r\n/g, '\n');
  const m = CHANGES.exec(text);
  return m ? bodyOf(text.slice(m.index)) : null;
}

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.error?.message || '').trim()}`);
  return r.stdout;
}

const tagExists = (root, version) => spawnSync('git', ['-C', root, 'rev-parse', '-q', '--verify', `refs/tags/v${version}`]).status === 0;

// The v<version> tags reachable from `end`, oldest version first, each with its date in UTC.
export function releaseTags(root, end = 'HEAD') {
  return git(root, ['for-each-ref', '--merged', end, '--format=%(refname)%09%(creatordate:unix)', 'refs/tags/v*'])
    .split('\n').filter(Boolean)
    .map((l) => l.split('\t'))
    .map(([ref, unix]) => ({ tag: ref.slice('refs/tags/'.length), ref, date: utcDate(Number(unix) * 1000) }))
    .map((t) => ({ ...t, version: t.tag.slice(1) }))
    .filter((t) => t.tag.startsWith('v') && VERSION.test(t.version))
    .sort((a, b) => compareVersions(a.version, b.version));
}

export function previousRelease(root, version, end = 'HEAD') {
  return releaseTags(root, end).filter((t) => compareVersions(t.version, version) < 0).pop();
}

export function subjectsSince(root, previous, end = 'HEAD') {
  return git(root, ['log', '--no-merges', '--format=%s', previous ? `${previous.ref}..${end}` : end, '--'])
    .split('\n').filter(Boolean);
}

// The cut: the section for `version` from the commits since the previous release up to HEAD.
export function writeCut(root, version, date = utcDate(Date.now())) {
  if (!VERSION.test(version)) throw new Error(`${version} is not a version like 1.2.3`);
  if (tagExists(root, version)) throw new Error(`v${version} is already tagged, and its section was written at its cut`);
  const previous = previousRelease(root, version);
  const subjects = subjectsSince(root, previous);
  const section = renderSection(version, date, subjects);
  const file = join(root, CHANGELOG);
  const changelog = insertSection(existsSync(file) ? readFileSync(file, 'utf8') : undefined, version, section);
  const notesFile = notesPath(root, version);
  const notes = notesWith(existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '', previous?.version, bodyOf(section));
  writeFileSync(file, changelog);
  mkdirSync(join(root, ...NOTES), { recursive: true });
  writeFileSync(notesFile, notes);
  return { previous: previous?.version, commits: subjects.length, listed: subjects.map(entryOf).filter(Boolean).length, summary: notes.startsWith('## Summary') };
}

// What CI can check without history: the sections run newest first, every release's notes have a
// section, and the notes of `version` open with their Summary and end with a copy of its section,
// the newest.
export function checkFiles(root, version) {
  const file = join(root, CHANGELOG);
  if (!existsSync(file)) return [`${CHANGELOG} is missing: run node diag/changelog.mjs --backfill`];
  const sections = sectionsOf(readText(file));
  const problems = [];
  sections.forEach(({ version: v }, i) => {
    const above = sections[i - 1]?.version;
    if (!VERSION.test(v)) problems.push(`${CHANGELOG} has a section "${v}", which is not a version`);
    else if (above && VERSION.test(above) && compareVersions(above, v) <= 0) problems.push(`${CHANGELOG} has ${above} above ${v}; sections run newest first, one per version`);
  });
  const dir = join(root, ...NOTES);
  const released = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter((v) => VERSION.test(v)) : [];
  for (const v of released.sort(compareVersions)) {
    const notes = readText(notesPath(root, v));
    const section = sections.find((s) => s.version === v);
    const changes = changesOf(notes);
    if (!notes.startsWith('## Summary')) problems.push(`${notesName(v)} does not open with its ## Summary`);
    if (!section) problems.push(`${CHANGELOG} has no ${v} section, though ${notesName(v)} exists: run node diag/changelog.mjs ${v}`);
    else if (changes !== null && changes !== bodyOf(section.raw)) problems.push(`${notesName(v)} lists other changes than ${CHANGELOG}'s ${v} section, which it copies: run node diag/changelog.mjs ${v}`);
    if (v !== version || !section) continue;
    if (changes === null) problems.push(`${notesName(v)} has no ## Changes part: run node diag/changelog.mjs ${v}`);
    if (sections[0] !== section) problems.push(`${CHANGELOG}'s newest section is ${sections[0].version}, not ${v}`);
  }
  if (/^\d+\.\d+\.0$/.test(version) && !sections.some((s) => s.version === version)) {
    problems.push(`${CHANGELOG} has no ${version} section, and ${version} is a release: run node diag/changelog.mjs ${version}`);
  }
  return problems;
}

// What the cut checks with history: the section equals one written now from the same commits.
export function checkRange(root, version) {
  const file = join(root, CHANGELOG);
  const section = existsSync(file) && sectionsOf(readText(file)).find((s) => s.version === version);
  if (!section) return [`${CHANGELOG} has no ${version} section`];
  const end = tagExists(root, version) ? `refs/tags/v${version}` : 'HEAD';
  const previous = previousRelease(root, version, end);
  const want = renderBody(subjectsSince(root, previous, end));
  const have = bodyOf(section.raw);
  if (want === have) return [];
  const lines = (t) => t.split('\n').filter((l) => l.startsWith('- '));
  const missing = lines(want).filter((l) => !lines(have).includes(l));
  const extra = lines(have).filter((l) => !lines(want).includes(l));
  const range = `${previous ? previous.tag : 'the first commit'} to ${end === 'HEAD' ? 'HEAD' : `v${version}`}`;
  return [
    `${CHANGELOG}'s ${version} section is not the one the commits from ${range} give: run node diag/changelog.mjs ${version}`,
    ...missing.map((l) => `  not in the section: ${l}`),
    ...extra.map((l) => `  in the section, from no commit in the range: ${l}`),
  ];
}

export function check(root, version) {
  const notes = existsSync(notesPath(root, version)) ? [] : [`${notesName(version)}, the release notes, is missing`];
  return [...notes, ...checkFiles(root, version), ...checkRange(root, version)];
}

// One section per release tag reachable from HEAD, each written as its cut would have written it.
export function backfill(root) {
  const file = join(root, CHANGELOG);
  if (existsSync(file)) throw new Error(`${CHANGELOG} exists; --backfill writes one only where there is none`);
  const tags = releaseTags(root);
  if (!tags.length) throw new Error('no v<version> tag is reachable from HEAD');
  let text;
  for (const t of tags) {
    const subjects = subjectsSince(root, previousRelease(root, t.version, t.ref), t.ref);
    text = insertSection(text, t.version, renderSection(t.version, t.date, subjects));
  }
  writeFileSync(file, text);
  return tags.map((t) => t.version);
}

function main(argv) {
  const usage = 'usage: node diag/changelog.mjs [--root <dir>] <version> | --check <version> | --backfill';
  const args = [...argv];
  let root = fileURLToPath(new URL('..', import.meta.url));
  const at = args.indexOf('--root');
  if (at >= 0) {
    const [, dir] = args.splice(at, 2);
    if (!dir) { console.error(usage); return 2; }
    root = resolve(dir);
  }
  try {
    if (args[0] === '--backfill' && args.length === 1) {
      const versions = backfill(root);
      console.log(`changelog: ${CHANGELOG} written with ${versions.length} sections, ${versions[versions.length - 1]} to ${versions[0]}`);
      return 0;
    }
    if (args[0] === '--check' && args.length === 2 && VERSION.test(args[1])) {
      const problems = check(root, args[1]);
      for (const p of problems) console.error(`changelog: ${p}`);
      if (!problems.length) console.log(`changelog: ${CHANGELOG}'s ${args[1]} section matches its commits, and ${notesName(args[1])} carries it`);
      return problems.length ? 1 : 0;
    }
    if (args.length === 1 && VERSION.test(args[0])) {
      const r = writeCut(root, args[0]);
      console.log(`changelog: ${CHANGELOG}'s ${args[0]} section lists ${r.listed} of ${r.commits} commits since ${r.previous ? `v${r.previous}` : 'the first commit'}, and ${notesName(args[0])} carries it under ## Changes`);
      if (!r.summary) console.log(`changelog: write the ## Summary at the top of ${notesName(args[0])}, above ## Changes`);
      return 0;
    }
  } catch (e) {
    console.error(`changelog: ${e.message}`);
    return 1;
  }
  console.error(usage);
  return 2;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = main(process.argv.slice(2));
