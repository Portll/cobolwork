// Stamps the commit a packed release is built from into lib/revision.json, so an installed
// cobolwork can say which commit it is when there is no checkout to ask. npm runs it before `npm
// pack` and again with --clear after. A tree whose shipped files differ from HEAD is refused: a
// release that names a commit it does not match is the problem this exists to prevent.
//   node diag/stamp-revision.mjs [--clear]
import { rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { revisionOf, PACKED_REVISION, SHIPPED } from '../lib/revision.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

if (process.argv.includes('--clear')) {
  rmSync(PACKED_REVISION, { force: true });
  process.exit(0);
}
const r = revisionOf(root, { paths: SHIPPED });
if (!r) { process.stderr.write('stamp-revision: not a git checkout, so there is no commit to stamp\n'); process.exit(1); }
if (r.dirty !== false && process.env.COBOLWORK_ALLOW_DIRTY_PACK !== '1') {
  process.stderr.write(`stamp-revision: ${SHIPPED.join(', ')} differ from ${r.commit.slice(0, 12)}, or could not be compared; commit first, or set COBOLWORK_ALLOW_DIRTY_PACK=1 for a local build\n`);
  process.exit(1);
}
const tag = spawnSync('git', ['-C', root, 'describe', '--tags', '--exact-match', 'HEAD'], { encoding: 'utf8' });
writeFileSync(PACKED_REVISION, `${JSON.stringify({ commit: r.commit, ...(tag.status === 0 ? { tag: tag.stdout.trim() } : {}) })}\n`);
process.stdout.write(`stamp-revision: ${r.commit}${tag.status === 0 ? ` (${tag.stdout.trim()})` : ''}\n`);
