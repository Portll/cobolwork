// Keeps a local copy of every document the project cites, so a citation can be checked after its
// page moves or its host goes: the vendor manuals behind provenance/words.json, and the documents and
// terms pages provenance/sources.json lists. Nothing it stores is committed; feed/sources is ignored.
//
//   node diag/sync-sources.mjs [--dest feed/sources] [--mirror <dir>]... [--check] [--only <text>]
//                              [--import <url>=<file>]... [--archive]
//
// Each file is stored under its SHA-256, so a page that changes does not overwrite the copy a record
// was made from. A fetch that does not match the recorded hash is kept as well, and the Wayback
// Machine's copy from the retrieval date is tried for the recorded one. --check reads nothing from the
// network and says which recorded documents the store holds. --mirror copies the store to a backup.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const DEST = resolve(ROOT, opt('--dest', 'feed/sources'));
const MIRRORS = args.flatMap((a, i) => (a === '--mirror' ? [resolve(args[i + 1])] : []));
const CHECK = args.includes('--check');
const ONLY = opt('--only', null);

const words = JSON.parse(readFileSync(join(ROOT, 'provenance', 'words.json'), 'utf8'));
const sources = JSON.parse(readFileSync(join(ROOT, 'provenance', 'sources.json'), 'utf8'));

// Every document a record cites, with the hash the record was made from where it has one.
const wanted = [];
// A document URL may carry a note after it, as "…/std.zip (zip member STD.BK.pdf)" does: the hash is
// then of the member, not of what the URL serves, so the fetch is kept but cannot match.
for (const [src, s] of Object.entries(words.sources)) {
  for (const d of s.documents || []) {
    const url = (d.url || '').split(/\s/)[0];
    if (/^https?:/.test(url)) wanted.push({ id: `words/${src}`, url, sha256: url === d.url ? d.sha256 || null : null, retrieved: d.retrieved || s.accessed || null });
  }
}
for (const d of sources.documents) wanted.push({ id: d.id, url: d.url, sha256: d.sha256 || null, retrieved: d.retrieved || null, alias: d.alias || null, manual: d.method === 'manual' });
for (const [pub, p] of Object.entries(sources.publishers)) {
  for (const t of p.terms || []) if (/^https?:/.test(t.url || '')) wanted.push({ id: `terms/${pub}`, url: t.url, sha256: t.sha256 || null, retrieved: t.retrieved || null, keep: t.keep !== false });
}
const todo = wanted.filter((w) => !ONLY || w.url.includes(ONLY) || w.id.includes(ONLY));

// A publisher whose terms do not allow the copy this tool makes is named with "cache": false, and its
// documents are neither fetched nor kept: a copy already held is removed from the store and mirrors.
// A Wayback Machine capture is the original publisher's document, and that publisher's terms decide.
// A document from a publisher with no terms recorded is not kept either.
const publisherOf = (url) => {
  const original = (url.match(/^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/) || [])[1] || url;
  const u = new URL(original);
  return Object.entries(sources.publishers).find(([, p]) => (p.hosts || []).some((h) => {
    const [host, ...path] = h.split('/');
    return u.host === host && u.pathname.startsWith(`/${path.join('/')}`);
  }));
};

mkdirSync(DEST, { recursive: true });
const manifestPath = join(DEST, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { documents: {} };
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const have = (h) => h && existsSync(join(DEST, 'by-sha256')) && readdirSync(join(DEST, 'by-sha256')).find((f) => f.startsWith(h));

function extOf(url, buf) {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return '.pdf';
  const e = extname(new URL(url).pathname).toLowerCase();
  if (['.txt', '.json', '.xml', '.htm', '.html'].includes(e)) return e;
  return /<html|<!doctype html/i.test(buf.subarray(0, 2048).toString('latin1')) ? '.html' : '.bin';
}

// A refusal served with a 200: IBM's bot notice, a page that is only a script loader, an error page.
function refused(buf) {
  const head = buf.subarray(0, 8192).toString('latin1');
  if (/<title>\s*(IBM notice|403 Forbidden|Access Denied|Just a moment)/i.test(head)) return 'the host served a refusal page';
  if (buf.length < 4096 && /<script/i.test(head) && !/<p\b/i.test(head)) return 'the host served only a script loader';
  return null;
}

function curl(url) {
  for (const ua of [null, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15']) {
    const r = spawnSync('curl', ['-sS', '-L', '--max-time', '120', ...(ua ? ['-A', ua] : []), url], { maxBuffer: 512 * 1024 * 1024 });
    if (r.status === 0 && r.stdout.length && !refused(r.stdout)) return { buf: r.stdout };
    if (r.status === 0 && r.stdout.length) var why = refused(r.stdout); // eslint-disable-line no-var
  }
  return { buf: null, why: why || 'the fetch failed' };
}

function textOf(file) {
  if (file.endsWith('.pdf')) {
    const out = `${file}.txt`;
    if (spawnSync('pdftotext', ['-layout', file, out]).status === 0) return out;
    const js = `ObjC.import("PDFKit");ObjC.import("Foundation");var d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(${JSON.stringify(file)}));d.string.writeToFileAtomicallyEncodingError(${JSON.stringify(out)},true,$.NSUTF8StringEncoding,null);`;
    if (process.platform === 'darwin' && spawnSync('osascript', ['-l', 'JavaScript', '-e', js]).status === 0 && existsSync(out)) return out;
    return null;
  }
  if (/\.html?$/.test(file)) {
    const html = readFileSync(file, 'utf8');
    const text = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "'")
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
    writeFileSync(`${file}.txt`, text);
    return `${file}.txt`;
  }
  return null;
}

function store(buf, url) {
  const h = sha(buf);
  mkdirSync(join(DEST, 'by-sha256'), { recursive: true });
  const file = join(DEST, 'by-sha256', `${h}${extOf(url, buf)}`);
  if (!existsSync(file)) writeFileSync(file, buf);
  const text = existsSync(`${file}.txt`) ? `${file}.txt` : textOf(file);
  return { sha256: h, bytes: buf.length, file: file.slice(DEST.length + 1), text: text ? text.slice(DEST.length + 1) : null };
}

// --import <url>=<file> adds a copy fetched some other way, by hand or through a browser, for a host
// that refuses scripted requests. It is stored and recorded like any other fetch.
for (const [i, a] of args.entries()) {
  if (a !== '--import') continue;
  const at = args[i + 1].lastIndexOf('=');
  const url = args[i + 1].slice(0, at);
  const s = store(readFileSync(resolve(args[i + 1].slice(at + 1))), url);
  const rec = manifest.documents[url] || (manifest.documents[url] = { ids: [] });
  rec.copies = { ...(rec.copies || {}), [s.sha256]: { ...s, from: 'imported', fetched: new Date().toISOString().slice(0, 10) } };
  console.log(`imported ${s.sha256.slice(0, 12)}  ${url}`);
}

const tally = {};
for (const w of todo) {
  const rec = manifest.documents[w.url] || (manifest.documents[w.url] = { ids: [] });
  if (!rec.ids.includes(w.id)) rec.ids.push(w.id);
  rec.expected = w.sha256;
  const [pub, publisher] = publisherOf(w.url) || [];
  if (((!publisher || publisher.cache === false) && !w.id.startsWith('terms/')) || w.keep === false) {
    for (const c of Object.values(rec.copies || {})) {
      for (const dir of [DEST, ...MIRRORS]) for (const f of [c.file, c.text].filter(Boolean)) rmSync(join(dir, f), { force: true });
    }
    delete rec.copies;
    rec.status = publisher ? `not kept: ${pub}'s terms` : 'not kept: no terms recorded';
    tally['not kept'] = (tally['not kept'] || 0) + 1;
    console.log(`${rec.status.padEnd(34)} ${w.id}  ${w.url}`);
    continue;
  }
  let status;
  if (w.sha256 && have(w.sha256)) status = 'held';
  else if (CHECK) status = w.manual ? 'manual, not held' : 'not held';
  else if (w.manual) status = 'manual, not held';
  else {
    const live = curl(w.url);
    if (live.buf) {
      const s = store(live.buf, w.url);
      rec.copies = { ...(rec.copies || {}), [s.sha256]: { ...s, from: 'live', fetched: new Date().toISOString().slice(0, 10) } };
      status = !w.sha256 ? 'fetched' : s.sha256 === w.sha256 ? 'fetched, matches' : 'fetched, changed since recorded';
    } else status = `refused live: ${live.why}`;
    if (w.sha256 && !have(w.sha256) && w.retrieved) {
      const stamp = w.retrieved.replace(/-/g, '');
      const wb = spawnSync('curl', ['-sS', '-L', '--max-time', '120', `https://web.archive.org/web/${stamp}id_/${w.url}`], { maxBuffer: 512 * 1024 * 1024 });
      if (wb.status === 0 && wb.stdout.length && sha(wb.stdout) === w.sha256) {
        const s = store(wb.stdout, w.url);
        rec.copies = { ...(rec.copies || {}), [s.sha256]: { ...s, from: `web.archive.org ${stamp}`, fetched: new Date().toISOString().slice(0, 10) } };
        status += '; recorded copy restored from the Wayback Machine';
      }
    }
  }
  if (w.alias && rec.copies) {
    const best = rec.copies[w.sha256] || Object.values(rec.copies).at(-1);
    if (best?.text) copyFileSync(join(DEST, best.text), join(DEST, w.alias));
  }
  rec.status = status;
  const key = status.replace(/;.*$/, '').replace(/: .*/, '');
  tally[key] = (tally[key] || 0) + 1;
  if (!/^(held|fetched)/.test(status)) console.log(`${status.padEnd(34)} ${w.id}  ${w.url}`);
}
manifest.synced = new Date().toISOString();
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);

// --archive asks the Internet Archive to keep what this store may not: for every document cited, it
// looks for a Wayback Machine capture and, where there is none, requests one through Save Page Now. A
// document the Archive itself hosts needs neither.
// The Archive holds the copy under its own policy, which publishers can ask to be excluded from; the
// project records only where the capture is, in provenance/captures.json.
if (args.includes('--archive')) {
  const capturesPath = join(ROOT, 'provenance', 'captures.json');
  const record = existsSync(capturesPath) ? JSON.parse(readFileSync(capturesPath, 'utf8')) : {
    about: 'Where the Internet Archive holds a copy of each document the project cites. Written by node diag/sync-sources.mjs --archive, which requests a capture through Save Page Now where none exists.',
    captures: {},
  };
  const json = (url) => { const r = spawnSync('curl', ['-sS', '--max-time', '60', url], { encoding: 'utf8' }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const pause = (ms) => spawnSync('sleep', [String(ms / 1000)]);
  const today = new Date().toISOString().slice(0, 10);
  let found = 0, requested = 0, failed = 0;
  const archivable = (ws) => [...new Set(ws.map((w) => w.url))].filter((u) => !/^https?:\/\/(?:[a-z0-9-]+\.)*archive\.org\//.test(u)).sort();
  const cited = archivable(wanted);
  record.captures = Object.fromEntries(Object.entries(record.captures).filter(([u]) => cited.includes(u)));
  for (const url of archivable(todo)) {
    if (record.captures[url]?.capture) continue;
    const closest = json(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`)?.archived_snapshots?.closest;
    if (closest?.available) {
      record.captures[url] = { capture: closest.url.replace(/^http:/, 'https:'), timestamp: closest.timestamp, checked: today };
      found++;
      continue;
    }
    const r = spawnSync('curl', ['-sS', '-L', '--max-time', '180', '-o', '/dev/null', '-w', '%{url_effective} %{http_code}', `https://web.archive.org/save/${url}`], { encoding: 'utf8' });
    const [effective, code] = (r.stdout || '').trim().split(' ');
    const m = /^https?:\/\/web\.archive\.org\/web\/(\d{14})/.exec(effective || '');
    if (m) { record.captures[url] = { capture: effective.replace(/^http:/, 'https:'), timestamp: m[1], requested: today }; requested++; }
    else { record.captures[url] = { failed: `Save Page Now answered ${code || 'nothing'}`, requested: today }; failed++; }
    pause(10000);
  }
  record.captures = Object.fromEntries(Object.entries(record.captures).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(capturesPath, `${JSON.stringify(record, null, 1)}\n`);
  console.log(`archive: ${found} already captured, ${requested} captured now, ${failed} not captured`);
}

for (const m of MIRRORS) {
  mkdirSync(join(m, 'by-sha256'), { recursive: true });
  let copied = 0;
  for (const f of readdirSync(join(DEST, 'by-sha256'))) {
    const to = join(m, 'by-sha256', f);
    if (!existsSync(to) || statSync(to).size !== statSync(join(DEST, 'by-sha256', f)).size) { copyFileSync(join(DEST, 'by-sha256', f), to); copied++; }
  }
  copyFileSync(manifestPath, join(m, 'manifest.json'));
  console.log(`mirrored to ${m}: ${copied} file(s) copied`);
}
console.log(`\n${todo.length} document(s):`, Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', '));
