// SPDX-License-Identifier: AGPL-3.0-or-later
// One evidence record: its canonical JSON, its SHA-256 under a domain tag, and the fields each kind
// may carry (docs/spec/evidence.md §4-6). The writer refuses anything outside these tables, so a
// new field is a change to the spec rather than a silent addition.
import { createHash, randomBytes } from 'node:crypto';

export const DOMAIN = 'cobolwork-evidence/v1\n';
export const ZERO = '0'.repeat(64);
export const VERSION = 1;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const COMMON = ['v', 'chain', 'seq', 'at', 'kind', 'prev', 'hash'];

const str = (x) => typeof x === 'string';
const int = (x) => Number.isSafeInteger(x) && x >= 0;
const hex64 = (x) => str(x) && HEX64.test(x);
const hex32 = (x) => str(x) && HEX32.test(x);
const strOrNull = (x) => x === null || str(x);
const any = () => true;
const strings = (x) => Array.isArray(x) && x.every(str);

// kind -> { field: check }; a field listed as required must be present.
export const KINDS = {
  open: { fields: { tool: str, toolVersion: str, toolRevision: any, command: str, argv: strings, roots: strings, node: str, platform: str }, required: ['tool', 'toolVersion', 'command', 'argv', 'roots'] },
  input: { fields: { root: int, path: str, sha256: hex64, bytes: int }, required: ['root', 'path', 'sha256'] },
  finding: { fields: { fingerprint: str, rule: str, tier: str, path: str, line: int }, required: ['fingerprint', 'rule'] },
  suppressed: { fields: { fingerprint: str, by: str, who: strOrNull, expires: strOrNull, reasonSha256: (x) => x === null || hex64(x) }, required: ['fingerprint', 'by'] },
  'baseline-write': { fields: { added: strings, removed: strings, who: strOrNull, expires: strOrNull, reasonSha256: (x) => x === null || hex64(x), path: str, sha256: hex64 }, required: ['added', 'removed', 'sha256'] },
  witness: { fields: { fingerprint: str, outcome: str, who: strOrNull, when: strOrNull, system: strOrNull, sourceSha256: hex64 }, required: ['fingerprint', 'outcome'] },
  verdict: { fields: { verdict: str, checks: any, relaxed: strings, exit: int }, required: ['verdict'] },
  output: { fields: { name: str, sha256: hex64, bytes: int, path: str, stdout: (x) => x === true }, required: ['name', 'sha256'] },
  close: { fields: { exit: (x) => x === null || int(x), counts: any, durationMs: int, ledger: str }, required: ['exit'] },
  genesis: { fields: { createdAt: str, rotatedFrom: any }, required: ['createdAt'] },
  run: { fields: { run: str, runChain: hex32, runLength: int, runTip: hex64 }, required: ['run', 'runChain', 'runLength', 'runTip'] },
  'lock-broken': { fields: { holderPid: int, ageMs: int }, required: ['holderPid', 'ageMs'] },
};

export const JOURNAL_KINDS = new Set(['open', 'input', 'finding', 'suppressed', 'baseline-write', 'witness', 'verdict', 'output', 'close']);
export const LEDGER_KINDS = new Set(['genesis', 'run', 'lock-broken']);

export const newChain = () => randomBytes(16).toString('hex');

// Keys sorted by UTF-16 code unit at every depth, integers only, no undefined.
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`an evidence record holds integers only, not ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((k) => {
      if (value[k] === undefined) throw new TypeError(`an evidence record holds no undefined value (${k})`);
      return `${JSON.stringify(k)}:${canonical(value[k])}`;
    }).join(',')}}`;
  }
  throw new TypeError(`an evidence record holds JSON values only, not ${typeof value}`);
}

export function recordHash(record) {
  const { hash, ...body } = record;
  return createHash('sha256').update(DOMAIN).update(canonical(body)).digest('hex');
}

export function checkFields(kind, fields) {
  const spec = KINDS[kind];
  if (!spec) throw new TypeError(`no evidence record kind ${kind}`);
  for (const [k, v] of Object.entries(fields)) {
    if (COMMON.includes(k)) throw new TypeError(`${kind}: ${k} is set by the writer`);
    const check = spec.fields[k];
    if (!check) throw new TypeError(`${kind}: no field ${k} (docs/spec/evidence.md §5)`);
    if (v !== undefined && !check(v)) throw new TypeError(`${kind}: ${k} does not hold what the spec says it holds`);
  }
  for (const k of spec.required) if (fields[k] === undefined) throw new TypeError(`${kind}: ${k} is required`);
}

// The next record after `prev` ({ chain, seq, hash } or null for the first), as its line.
export function makeRecord({ chain, prev, kind, fields, at }) {
  checkFields(kind, fields);
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  const record = { ...clean, v: VERSION, chain, seq: prev ? prev.seq + 1 : 0, at, kind, prev: prev ? prev.hash : ZERO };
  record.hash = recordHash(record);
  return { record, line: `${canonical(record)}\n` };
}

// A line as read back: which check it fails, if any, against the record before it.
export function checkLine(line, prev, { chain, kinds }) {
  let record;
  try { record = JSON.parse(line); } catch { return { record: null, fail: 'json' }; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { record: null, fail: 'json' };
  let text;
  try { text = canonical(record); } catch { return { record, fail: 'canonical' }; }
  if (text !== line) return { record, fail: 'canonical' };
  if (record.v !== VERSION) return { record, fail: 'version' };
  if (!ISO.test(record.at)) return { record, fail: 'at' };
  if (!hex64(record.hash) || recordHash(record) !== record.hash) return { record, fail: 'hash' };
  if (record.chain !== chain) return { record, fail: 'chain' };
  if (record.seq !== (prev ? prev.seq + 1 : 0)) return { record, fail: 'seq' };
  if (record.prev !== (prev ? prev.hash : ZERO)) return { record, fail: 'prev' };
  if (!kinds.has(record.kind)) return { record, fail: 'kind' };
  const { v, chain: c, seq, at, kind, prev: p, hash, ...fields } = record;
  try { checkFields(kind, fields); } catch { return { record, fail: 'fields' }; }
  return { record, fail: null };
}
