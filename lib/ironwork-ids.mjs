// SPDX-License-Identifier: AGPL-3.0-or-later
// What cobolwork reads from ironwork, and from which ironwork release: the formats it keys on, how
// ironwork says it ended a run, and how a compile message is read by its id. The run endings are
// ironwork's docs/run-endings.tsv and the id areas its docs/messages.md; a test holds them to the
// copies in test/fixtures/ironwork and rules/ironwork-messages.json, and CI holds those to ironwork's.

// Each format by the id its reader keys on, with the first ironwork release that writes all of what
// cobolwork reads from it. A reader refuses an id it does not know, so a later format is not misread.
export const IRONWORK_FORMATS = {
  'ironwork-fuzz/v1': '0.3.0',
  'ironwork-fuzz-interface/v1': '0.5.0',
  'cobolwork-evidence/v1': '0.4.0',
  'https://github.com/Portll/ironwork/blob/main/docs/evidence.md#equivalence-v1': '0.1.2',
  'run-endings': '0.4.1',
  'diagnostics-json': '0.9.0',
};

// What a compile message says, by the area letter after IW: a rule the program breaks, a construct
// ironwork refuses by name because it does not model it yet, or one of ironwork's own limits.
export const MESSAGE_AREAS = { S: 'program', C: 'program', O: 'program', P: 'program', X: 'program', J: 'program', R: 'refused', L: 'limit' };

// Ids read apart from their area: a member no copy library holds, and the environment and flags
// ironwork was run with, which are cobolwork's invocation rather than the program's cards.
export const MESSAGE_IDS = { IWS0002: 'unresolved', IWO0004: 'invocation', IWO0005: 'invocation' };

// An undefined name, which is the translator's to declare where it is a CICS, DL/I or SQL field.
export const UNDEFINED_NAME = 'IWC0001';

// The first ironwork release whose output cobolwork reads throughout; a format listed with a later
// release is read from that release on.
export const IRONWORK_MINIMUM = '0.4.1';

// How ironwork ends a run other than with its RETURN-CODE, by exit status.
export const RUN_ENDINGS = { 240: 'abend', 241: 'refused', 242: 'not-generated', 243: 'stopped', 244: 'not-run', 245: 'unreadable', 246: 'usage', 255: 'internal' };

// The abend codes that say a run reached what ironwork does not run.
export const NOT_RUN_ABENDS = ['IRONWORK', 'EXEC', 'JAVA'];
