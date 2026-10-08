// The fix each rule states: every defect rule's remedy and impact, the steps and IBM manual
// references the advice catalogue carries, and the remedies the vendor packs carry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_RULES } from '../lib/kernel/registry.mjs';
import { availablePacks, readPack, packProblems, validationOf } from '../lib/packs.mjs';
import { catalogue } from '../lib/advice.mjs';
import './pin-machine.mjs';

// Defect rules allowed to go without a remedy. None: every rule left without one is an info rule
// (context or coverage evidence), which carries none because a fix would assert a defect it does not
// claim (README, "What each finding lets someone do, and the fix"; test/rule-guidance.test.mjs).
const EXEMPT = new Set([]);

const nonEmpty = (x) => typeof x === 'string' && x.trim() !== '';
const isDefect = (r) => r.evidence !== 'context' && r.sev !== 'info';
const packRules = () => availablePacks().flatMap((name) => (readPack(name).rules || []).map((r) => ({ pack: name, ...r })));

test('every defect rule carries a remedy and an impact', () => {
  const missing = Object.entries(ALL_RULES)
    .filter(([id, r]) => isDefect(r) && !EXEMPT.has(id) && !(nonEmpty(r.remedy) && nonEmpty(r.impact)))
    .map(([id]) => id);
  assert.deepEqual(missing, []);
  for (const id of EXEMPT) assert.ok(ALL_RULES[id], `${id} is exempted but is not a rule`);
});

test('every rule left without a remedy is an info rule', () => {
  const left = Object.entries(ALL_RULES).filter(([, r]) => !r.remedy);
  assert.ok(left.length > 0);
  for (const [id, r] of left) assert.equal(r.sev, 'info', `${id} has no remedy and is not info`);
});

test('every rule with steps gives two to four, each one sentence a person acts on', () => {
  const withSteps = Object.entries(ALL_RULES).filter(([, r]) => r.steps !== undefined);
  assert.ok(withSteps.length >= 10, `only ${withSteps.length} rules carry steps`);
  for (const [id, r] of withSteps) {
    assert.ok(Array.isArray(r.steps), `${id} steps is not an array`);
    assert.ok(r.steps.length >= 2 && r.steps.length <= 4, `${id} has ${r.steps.length} steps`);
    for (const s of r.steps) assert.ok(nonEmpty(s), `${id} has an empty step`);
    assert.ok(nonEmpty(r.remedy), `${id} has steps but no remedy`);
  }
});

test('the highest-severity flow rules carry steps', () => {
  for (const [id, r] of Object.entries(ALL_RULES)) {
    if (r.sev === 'crit' && r.evidence === 'path') assert.ok(r.steps?.length >= 2, `${id} is critical and has no steps`);
  }
});

test('every reference names a manual, and a URL is an IBM Docs page', () => {
  const all = [...Object.entries(ALL_RULES), ...packRules().map((r) => [`${r.pack}:${r.id}`, r])];
  let n = 0;
  for (const [id, r] of all) {
    if (r.references === undefined) continue;
    assert.ok(Array.isArray(r.references) && r.references.length, `${id} references is not a non-empty array`);
    for (const ref of r.references) {
      n++;
      assert.ok(nonEmpty(ref.title), `${id} has a reference without a title`);
      if (ref.section !== undefined) assert.ok(nonEmpty(ref.section), `${id} has an empty section`);
      if (ref.url !== undefined) assert.match(ref.url, /^https:\/\/www\.ibm\.com\/docs\/en\/[^\s]+\?topic=[^\s]+$/, `${id} url`);
    }
  }
  assert.ok(n > 0, 'no rule carries a reference');
});

// An info pack rule is catalogued as context (lib/advice.mjs packEntries): it says the product is in
// use, so like an info rule in a set it carries no remedy.
test('every pack rule that asserts a risk carries a remedy, and an info one carries none', () => {
  const rules = packRules();
  assert.ok(rules.length > 0);
  for (const r of rules) {
    if (r.severity === 'info') assert.equal(r.remedy, undefined, `${r.pack}:${r.id} is info and carries a remedy`);
    else assert.ok(nonEmpty(r.remedy), `${r.pack}:${r.id} has no remedy`);
    if (r.steps !== undefined) {
      assert.ok(r.steps.length >= 2 && r.steps.length <= 4, `${r.pack}:${r.id} has ${r.steps.length} steps`);
      for (const s of r.steps) assert.ok(nonEmpty(s), `${r.pack}:${r.id} has an empty step`);
    }
  }
});

test('the shipped packs stay valid and keep their validation status', () => {
  for (const name of availablePacks()) {
    const pack = readPack(name);
    assert.deepEqual(pack.problems, []);
    assert.deepEqual(packProblems(pack), [], name);
    assert.equal(validationOf(pack).any, true, name);
  }
});

test('a pack rule may carry remedy, steps and references, and a malformed one is a problem', () => {
  const rule = (extra) => ({ name: 'p', rules: [{ id: 'r1', pattern: 'X', ...extra }] });
  assert.deepEqual(packProblems(rule({ remedy: 'Fix it', steps: ['Do one thing.', 'Do another.'], references: [{ title: 'A manual', section: 'A section' }] })), []);
  assert.deepEqual(packProblems(rule({ remedy: ' ' })), ['p:r1: remedy must be a non-empty string']);
  assert.deepEqual(packProblems(rule({ steps: 'Do it.' })), ['p:r1: steps must be an array of non-empty strings']);
  assert.deepEqual(packProblems(rule({ steps: ['Do it.', ''] })), ['p:r1: steps must be an array of non-empty strings']);
  assert.deepEqual(packProblems(rule({ references: [{ section: 'No title' }] })), ['p:r1: references must be an array of objects, each with a title']);
  assert.deepEqual(packProblems(rule({ references: [{ title: 'A manual', url: 7 }] })), ['p:r1: references must be an array of objects, each with a title']);
});

test('the catalogue carries a rule\'s steps and references, and a pack rule\'s remedy', () => {
  const { rules } = catalogue();
  const sql = rules.find((r) => r.id === 'cics-web-to-dynamic-sql');
  assert.ok(sql.steps.length >= 2);
  assert.ok(sql.references.some((r) => r.title === 'Db2 for z/OS SQL Reference' && r.section === 'PREPARE'));
  const gso = rules.find((r) => r.id === 'acf2-global-options');
  assert.equal(gso.set, 'pack:broadcom');
  assert.ok(nonEmpty(gso.remedy));
  assert.ok(gso.steps.length >= 2);
});
