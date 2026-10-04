// With allRoutes a data flow finding lists every statement on any route from its sources to its sink
// (docs/spec/reach.md §9.8), not only the route its trace names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const command = (dir, opts) => scan(join(HERE, dir), opts).findings.find((f) => f.rule === 'argv-or-env-to-os-command');
const at = (routes) => routes.statements.map((s) => `${s.verb} ${s.file}:${s.line}`);

test('both branches that carry the input to the command are listed, and a move that reaches no sink is not', () => {
  const f = command('routes/branches', { allRoutes: true });
  assert.equal(f.trace.filter((t) => /^MOVE/.test(t.via)).length, 2);
  assert.deepEqual(at(f.routes), ['MOVE ROUTES.cbl:15', 'MOVE ROUTES.cbl:16', 'MOVE ROUTES.cbl:18', 'MOVE ROUTES.cbl:19']);
  assert.deepEqual(f.routes.sources, [{ kind: 'argv-or-env', file: 'ROUTES.cbl', line: 12 }]);
  assert.equal(f.routes.complete, true);
});

test('two sources merged into one finding keep both sources and the statements of both routes', () => {
  const f = command('routes/sources', { allRoutes: true });
  assert.equal(f.sources, 2);
  assert.deepEqual(f.routes.sources.map((s) => s.line), [9, 10]);
  assert.deepEqual(at(f.routes), ['MOVE SOURCES.cbl:11', 'MOVE SOURCES.cbl:13']);
});

test('a value that crosses a CALL and is written back lists the CALL and the callee\'s statement', () => {
  const f = command('writeback/same', { allRoutes: true });
  assert.deepEqual(at(f.routes), ['CALL APROG.cbl:9', 'MOVE SUBPG.cbl:8']);
});

test('without allRoutes a finding carries no routes', () => {
  assert.equal('routes' in command('routes/branches'), false);
});
