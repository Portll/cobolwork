// A document from outside parsed as XML. What the parser does with a DTD in it is the compiler's
// XMLPARSE option, so the finding says what reached the parser, not what the parser did.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'xml');
const report = scan(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file && f.rule.endsWith('-to-xml-document'));

test('a web request parsed as XML is reported at XML PARSE, low', () => {
  const [f, ...rest] = of('XMLWEB.cbl');
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'cics-web-to-xml-document');
  assert.equal(f.sev, 'low');
  assert.equal(f.cwe, 'CWE-611');
  assert.equal(f.line, 9);
  assert.match(f.detail, /XML PARSE WS-DOC/);
});

test('a document the program built from literals is not input', () => {
  assert.deepEqual(of('XMLOWN.cbl'), []);
});
