// Scores a scanner against the labelled cases in bench/cases. Each case declares what a scanner
// should report and, for a negative, what it must not. A case is matched on rule and file, never
// on line number: code moves, and a line-keyed expectation turns an unrelated edit into a failure.
//
//   node bench/run.mjs [--json] [--validate] [--only id,id]
//     --validate  also compile every case with GnuCOBOL, so a case cannot be invalid COBOL, and
//                 assemble its HLASM with z390 when Z390 names an unpacked release
//     --only      score these cases alone
//
// Exit 0 when every case scores as declared, 1 otherwise, 2 when the benchmark could not run.
import { readdirSync, readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { REGISTRY } from '../lib/kernel/registry.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { parseJcl } from '../lib/jcl.mjs';
import { prepareForWitness } from '../diag/precompiler.mjs';
import { stubMacro, missingMacros } from '../diag/hlasm-oracle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');
const asJson = process.argv.includes('--json');
const validate = process.argv.includes('--validate');
const only = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1].split(',')) : null;
const Z390 = process.env.Z390 && existsSync(join(process.env.Z390, 'z390.jar')) ? process.env.Z390 : null;

if (!existsSync(CASES)) { process.stderr.write('bench: no cases directory\n'); process.exit(2); }
const ids = readdirSync(CASES, { withFileTypes: true }).filter(d => d.isDirectory() && (!only || only.has(d.name))).map(d => d.name).sort();
if (!ids.length) { process.stderr.write('bench: no cases\n'); process.exit(2); }

const results = [];
for (const id of ids) {
  const dir = join(CASES, id);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  // Every registered set. Listing them here meant the copybook set was never scored against a
  // benchmark case, and nothing said so: a case expecting a copybook finding would simply have
  // read as a miss.
  const tree = directoryTree(dir);
  // Which sets read the whole case, and which stopped short. A set that stopped cannot be scored:
  // its case has no findings because nobody looked, not because the rule is silent. Read from the
  // scan rather than assumed, because the guard's free-memory term is the whole machine - running
  // this while something else is busy scored 35 of 94 on a tree where the answer is 94 of 94, and
  // reported it as 59 rules failing.
  const parts = REGISTRY.map(set => set.scan(dir, { tree }));
  const short = parts.filter(p => p.summary.coverageIncomplete)
    .map(p => `${p.tool}${p.summary.stoppedBy ? ` (${p.summary.stoppedBy})` : ''}`);
  const raw = parts.flatMap(p => p.findings);
  const found = raw.map(f => ({ rule: f.rule, file: f.path.split('/').pop() }));
  const context = new Set(raw.filter(f => f.evidence === 'context').map(f => f.rule));

  const expected = manifest.expect || [];
  const matched = [];
  const missing = [];
  const pool = [...found];
  for (const e of expected) {
    const i = pool.findIndex(f => f.rule === e.rule && (!e.file || f.file === e.file));
    if (i >= 0) { matched.push(e); pool.splice(i, 1); } else missing.push(e);
  }
  // Everything the case did not declare is a false positive, on a positive case as much as on a
  // negative one: a case that expects one finding and gets two was scoring as declared, so a false
  // positive planted beside a true one was invisible. A case may allow a rule by naming it in
  // \`alsoExpected\`, which is a declaration like any other.
  // A rule the case says must not fire stays a failure whatever else it allows.
  // A context row claims no defect, so it is extra only when the case names it in `negativeFor`.
  const allowed = new Set(manifest.alsoExpected || []);
  const forbidden = new Set(manifest.negativeFor || []);
  const extra = pool.filter(f => !allowed.has(f.rule) && (!context.has(f.rule) || forbidden.has(f.rule)));

  let compiles = null;
  if (validate) {
    compiles = true;
    // There is no free JCL compiler, so a JCL case is validated against the statement grammar
    // instead. It is a weaker witness than cobc and it is stated as one, but it still means a case
    // cannot be JCL a system would refuse.
    for (const file of readdirSync(dir).filter(f => /\.(jcl|job|proc|prc|cntl)$/i.test(f))) {
      const bad = parseJcl(readFileSync(join(dir, file), 'utf8'), file).diags.filter(d => d.sev === 'error');
      if (bad.length) { compiles = `${file}: line ${bad[0].line}: ${bad[0].text}`; break; }
    }
    // An assembler case is assembled by z390, with z390's macro library and the case's own members.
    for (const file of Z390 ? readdirSync(dir).filter(f => /\.(asm|mlc)$/i.test(f)) : []) {
      if (compiles !== true) break;
      const tmp = mkdtempSync(join(tmpdir(), 'cobolwork-bench-'));
      const name = file.replace(/\.[^.]+$/, '').toUpperCase().replace(/[^A-Z0-9$#@]/g, '').slice(0, 8) || 'CASE';
      writeFileSync(join(tmp, `${name}.MLC`), readFileSync(join(dir, file)));
      // Authorized and site macros are not in z390's library: each is stubbed, so z390 still checks
      // everything around it; the macro's own operands are the HLASM reader's to check.
      const stubs = join(tmp, 'stub');
      mkdirSync(stubs);
      const assemble = () => spawnSync('java', ['-classpath', join(Z390, 'z390.jar'), '-Xrs', 'mz390', `${name}.MLC`, `sysmac(+${join(Z390, 'mac')}+${dir}+${stubs})`, `syscpy(+${join(Z390, 'mac')}+${dir})`], { cwd: tmp, encoding: 'latin1', timeout: 60000 });
      let r = assemble();
      for (let round = 0; round < 3; round++) {
        const missing = missingMacros(`${r.stdout}${r.stderr}${existsSync(join(tmp, `${name}.PRN`)) ? readFileSync(join(tmp, `${name}.PRN`), 'latin1') : ''}`);
        if (!missing.length) break;
        for (const m of missing) writeFileSync(join(stubs, `${m}.MAC`), stubMacro(m));
        r = assemble();
      }
      if (r.status > 4 || r.status === null) compiles = `${file}: z390 return code ${r.status}: ${(`${r.stdout}${r.stderr}`.split('\n').find(l => /E error|abort/.test(l)) || '').trim()}`;
      rmSync(tmp, { recursive: true, force: true });
    }
    if (compiles !== true) { results.push({ id, title: manifest.title, cwe: manifest.cwe, kind: expected.length ? 'positive' : 'negative', matched: matched.length, missing, extra, compiles }); continue; }
    for (const file of readdirSync(dir).filter(f => /\.(cbl|cob)$/i.test(f))) {
      const tmp = mkdtempSync(join(tmpdir(), 'cobolwork-bench-'));
      const src = readFileSync(join(dir, file), 'latin1');
      const prepared = manifest.precompile === false ? src : prepareForWitness(src, manifest.format || 'fixed');
      const target = join(tmp, file);
      writeFileSync(target, prepared, 'latin1');
      const r = spawnSync('cobc', ['-fsyntax-only', '-frelax-syntax-checks', `-std=${manifest.std || 'default'}`, `-fformat=${manifest.format || 'fixed'}`, '-I', dir, target], { encoding: 'latin1' });
      if (r.status !== 0) compiles = `${file}: ${(r.stderr || '').split('\n').find(l => / error: /.test(l)) || 'refused'}`;
      rmSync(tmp, { recursive: true, force: true });
      if (compiles !== true) break;
    }
  }

  results.push({ id, title: manifest.title, cwe: manifest.cwe, kind: expected.length ? 'positive' : 'negative', matched: matched.length, missing, extra, compiles, short });
}

// A case a set could not read completely was not scored. Counting it as a pass overstates the
// benchmark; counting it as a failure blames the rules for the machine. It is neither: it gets its
// own state and it fails the run, because a benchmark that cannot say which of the two happened is
// worth nothing. Running this on a busy box scored 35 of 94 on a tree whose answer is 94 of 94, and
// said it as 59 rules missing their findings.
//
// A short case is not also counted as failed: its missing findings are what the shortfall predicts,
// so counting it twice is what produced "-59 of 94" the first time this was written.
const unscored = results.filter(r => r.short && r.short.length);
const isShort = new Set(unscored.map(r => r.id));
const failed = results.filter(r => !isShort.has(r.id)
  && (r.missing.length || r.extra.length || (validate && r.compiles !== true && r.compiles !== null)));
const scored = results.length - failed.length - unscored.length;
if (asJson) process.stdout.write(JSON.stringify({ cases: results.length, failed: failed.length, unscored: unscored.length, results }, null, 1) + '\n');
else {
  for (const r of results) {
    const state = r.short && r.short.length ? 'SHORT' : (r.missing.length || r.extra.length ? 'FAIL ' : 'ok   ');
    const why = r.short && r.short.length ? ` NOT SCORED: ${r.short.join(', ')} did not read the whole case` : '';
    process.stdout.write(`${state} ${r.id.padEnd(34)} ${r.kind.padEnd(8)} ${r.cwe || '-'} ${r.missing.length ? `missing ${JSON.stringify(r.missing)}` : ''}${r.extra.length ? ` unexpected ${JSON.stringify(r.extra)}` : ''}${r.compiles && r.compiles !== true ? ` does not compile: ${r.compiles}` : ''}${why}\n`);
  }
  process.stdout.write(`\n${scored} of ${results.length} cases scored as declared\n`);
  if (unscored.length) {
    process.stdout.write(`${unscored.length} case(s) were NOT SCORED: a rule set stopped before reading them. That is a property\n`);
    process.stdout.write(`of this run rather than of the rules - the memory guard's free term is the whole machine.\n`);
    process.stdout.write(`Pin it with COBOLWORK_FREE_MEMORY_MB, the way test/pin-machine.mjs pins it for the suite.\n`);
  }
}
process.exit(failed.length || unscored.length ? 1 : 0);
