// SPDX-License-Identifier: AGPL-3.0-or-later
// The version key and unknown keys of a document cobolwork reads. A document without the key
// predates versioning and is read as version 0, which holds the same keys as version 1.
import { printable } from './printable.mjs';

// Why the document cannot be read, as a clause to follow its name, or null when it can.
export function versionProblem(raw, current) {
  const version = raw.version === undefined ? 0 : raw.version;
  if (!Number.isInteger(version) || version < 0) return `has version ${printable(JSON.stringify(version), 40)}, which is not a whole number from 0`;
  if (version > current) return `is version ${version}, and this cobolwork reads up to version ${current}; upgrade cobolwork`;
  return null;
}

// A key opening with an underscore is a note for people, as diag/propose-site.mjs writes them.
export const unknownKeys = (raw, known) => Object.keys(raw).filter((k) => !known.has(k) && !k.startsWith('_')).sort();

export const ignoredKey = (where, key) => `${where}: ${printable(JSON.stringify(key), 80)} is not a key this cobolwork reads, so it was ignored`;
