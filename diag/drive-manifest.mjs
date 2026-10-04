// Checks a corpus against the manifest of the drive it is on, by path and size, without hashing.
//   node diag/drive-manifest.mjs <corpus-root> [--manifest file] [--manifest-root dir]
// Manifest lines: `F<TAB>path<TAB>size<TAB>sha256` or `D<TAB>path`, paths relative to --manifest-root.
// COBOLWORK_MANIFEST and COBOLWORK_MANIFEST_ROOT stand in for either flag.
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = join(homedir(), 'LenovoPS8S-manifests', 'lenovo-manifest-apfs.tsv');
export const MANIFEST_ROOT = '/Volumes/Lenovo PS8S';
const SHOWN = 5;

export function checkManifest(root, { manifest, volume } = {}) {
  const file = manifest || process.env.COBOLWORK_MANIFEST || MANIFEST;
  const top = volume || process.env.COBOLWORK_MANIFEST_ROOT || MANIFEST_ROOT;
  let realTop;
  let real;
  try { realTop = realpathSync(top); real = realpathSync(root); } catch { return { skipped: `the corpus root is not on ${top}` }; }
  if (real !== realTop && !real.startsWith(realTop + sep)) return { skipped: `the corpus root is not on ${top}` };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { return { skipped: `no manifest at ${file} (${e.code || e.name})` }; }
  const under = relative(realTop, real).split(sep).join('/');
  const head = `F\t${under ? `${under}/` : ''}`;
  const listed = new Map();
  for (let i = 0; i < text.length;) {
    let j = text.indexOf('\n', i);
    if (j < 0) j = text.length;
    if (text.startsWith(head, i)) {
      const [path, size] = text.slice(i + head.length, j).replace(/\r$/, '').split('\t');
      listed.set(path, Number(size));
    }
    i = j + 1;
  }
  const found = new Map();
  const unlisted = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { unlisted.push(rel || '.'); return; }
    for (const d of entries) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(join(dir, d.name), r);
      else try { found.set(r, lstatSync(join(dir, d.name)).size); } catch { /* gone since the listing: missing */ }
    }
  };
  walk(real, '');
  const missing = [];
  const sizeDiffers = [];
  let matched = 0;
  for (const [p, size] of listed) {
    const has = found.get(p);
    if (has === undefined) missing.push(p);
    else if (has !== size) sizeDiffers.push(p);
    else matched++;
  }
  const notInManifest = [...found.keys()].filter((p) => !listed.has(p));
  const lists = { missing, sizeDiffers, notInManifest, dirsUnlisted: unlisted };
  const first = Object.fromEntries(Object.entries(lists).filter(([, l]) => l.length).map(([k, l]) => [k, l.sort().slice(0, SHOWN)]));
  return {
    file, under: under || '.', files: listed.size, matched,
    ...Object.fromEntries(Object.entries(lists).map(([k, l]) => [k, l.length])),
    agrees: !missing.length && !sizeDiffers.length && !notInManifest.length && !unlisted.length,
    ...(Object.keys(first).length ? { first } : {}),
  };
}

const WORDS = { missing: 'missing', sizeDiffers: 'of another size', notInManifest: 'not in it', dirsUnlisted: 'not listed' };

export function manifestLine(m) {
  if (m.skipped) return `drive manifest not checked: ${m.skipped}`;
  const dirs = m.dirsUnlisted ? `; ${m.dirsUnlisted} director${m.dirsUnlisted === 1 ? 'y' : 'ies'} could not be listed` : '';
  const first = Object.entries(m.first || {}).map(([k, l]) => `${WORDS[k]} ${l[0]}`);
  return `drive manifest: of the ${m.files} files it lists under ${m.under}, ${m.matched} are on disk at its size, ${m.missing} missing, ${m.sizeDiffers} of another size; ${m.notInManifest} on disk are not in it${dirs}${first.length ? `; the first ${first.join(', ')}` : ''}`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const root = args.find((a, i) => !a.startsWith('--') && !['--manifest', '--manifest-root'].includes(args[i - 1]));
  if (!root) { process.stderr.write('usage: node diag/drive-manifest.mjs <corpus-root> [--manifest file] [--manifest-root dir]\n'); process.exit(2); }
  const m = checkManifest(root, { manifest: opt('--manifest'), volume: opt('--manifest-root') });
  console.log(manifestLine(m));
  for (const [k, l] of Object.entries(m.first || {})) for (const p of l) console.log(`  ${WORDS[k]}: ${p}`);
  process.exit(m.skipped || m.agrees ? 0 : 1);
}
