import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_RULES } from '../lib/scan.mjs';
import './pin-machine.mjs';

// A defect a reader must act on carries two things a route or a construct alone does not: what it
// lets someone do, and the standard fix, the same for every instance. A rule that asserts no defect
// - coverage, context - carries neither, because a remedy would imply a defect the tool declines to
// claim. This holds the whole vocabulary to that split.
const DEFECT = new Set(['path', 'construct', 'tampering', 'advisory', 'exposure']);

test('every defect rule states its impact and its remedy, and no info rule does', () => {
  for (const [id, r] of Object.entries(ALL_RULES)) {
    if (DEFECT.has(r.evidence)) {
      assert.equal(typeof r.impact, 'string', `${id} (${r.evidence}) has no impact`);
      assert.ok(r.impact.length > 15, `${id} impact is too short to say who can do what`);
      assert.equal(typeof r.remedy, 'string', `${id} (${r.evidence}) has no remedy`);
      assert.ok(r.remedy.length > 15, `${id} remedy is too short to be a fix`);
    } else {
      assert.equal(r.impact, undefined, `${id} (${r.evidence}) asserts no defect but carries an impact`);
      assert.equal(r.remedy, undefined, `${id} (${r.evidence}) asserts no defect but carries a remedy`);
    }
  }
});
