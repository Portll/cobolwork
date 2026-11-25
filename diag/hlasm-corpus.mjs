// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds an HLASM corpus in the layout diag/hlasm-oracle.mjs and diag/hlasm-measure.mjs read: the
// assembler files of each split's corpora, deduplicated by content across splits in the order given,
// and each repository's members (assembler and copy files, by member name) for COPY and macro lookup.
//   node diag/hlasm-corpus.mjs <out> --dev <corpus>[,<corpus>] --heldout <corpus>[,<corpus>]
// A <corpus> is a directory of repositories, as diag/fetch-corpus.mjs writes. <out>/manifest.json
// records what was kept per repository; provenance/corpora.json holds the manifests of the corpora
// the HLASM reader was measured on.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, extname, basename, relative, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readHlasm } from '../lib/hlasm.mjs';
import { HLASM_EXT, COPY_EXT } from '../lib/sources.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((p) => resolve(p)) : []; };
const out = args[0] && !args[0].startsWith('--') ? resolve(args[0]) : null;
const splits = { dev: flag('--dev'), heldout: flag('--heldout') };
if (!out || !(splits.dev.length + splits.heldout.length)) {
  console.error('usage: node diag/hlasm-corpus.mjs <out> --dev <corpus>[,<corpus>] --heldout <corpus>[,<corpus>]');
  process.exit(2);
}
const MEMBER = /^[A-Z$#@][A-Z0-9$#@_]{0,62}$/;
const MAX_BYTES = 4e6;

function walk(dir, found = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, found);
    else if (e.isFile()) found.push(p);
  }
  return found;
}

for (const d of ['dev', 'heldout', 'members']) rmSync(join(out, d), { recursive: true, force: true });
const seen = new Set();
const manifest = { built: process.env.CW_NOW || new Date().toISOString(), dedup: 'sha256, dev first', dev: {}, heldout: {} };
for (const [split, roots] of Object.entries(splits)) {
  for (const root of roots) {
    for (const repo of readdirSync(root).sort()) {
      const dir = join(root, repo);
      if (!statSync(dir).isDirectory()) continue;
      const files = walk(dir).filter((f) => [...HLASM_EXT, ...COPY_EXT].includes(extname(f).toLowerCase()) && statSync(f).size <= MAX_BYTES);
      let kept = 0;
      for (const f of files.filter((x) => HLASM_EXT.includes(extname(x).toLowerCase()))) {
        const buf = readFileSync(f);
        const hash = createHash('sha256').update(buf).digest('hex');
        if (seen.has(hash)) continue;
        seen.add(hash);
        if (readHlasm(buf.toString('latin1')).kind !== 'hlasm') continue;
        const to = join(out, split, repo, relative(dir, f));
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(f, to);
        kept++;
      }
      if (!kept) continue;
      const lib = join(out, 'members', repo);
      mkdirSync(lib, { recursive: true });
      let members = 0;
      for (const f of files) {
        const name = basename(f, extname(f)).toUpperCase();
        const member = `${name}${extname(f).toLowerCase()}`;
        if (!MEMBER.test(name) || existsSync(join(lib, member))) continue;
        copyFileSync(f, join(lib, member));
        members++;
      }
      manifest[split][repo] = { corpus: basename(root), files: kept, members };
    }
  }
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
for (const split of ['dev', 'heldout']) {
  const repos = Object.values(manifest[split]);
  console.log(split, repos.length, 'repos', repos.reduce((n, r) => n + r.files, 0), 'files');
}
