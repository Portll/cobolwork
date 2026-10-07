// Parses CICS CSD definitions into typed maps (lib/csd.mjs parseCsd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsd } from '../lib/csd.mjs';
import './pin-machine.mjs';

test('parses a TCPIPSERVICE definition with all attributes', () => {
  const text = 'DEFINE TCPIPSERVICE (SVC1) PORTNUMBER(8080) PROTOCOL(HTTP) SSL(YES) AUTHENTICATE(YES) TRANSACTION(T001)';
  const { tcpipservices } = parseCsd(text);
  assert.deepEqual(tcpipservices.get('SVC1'), {
    port: '8080',
    protocol: 'HTTP',
    ssl: 'YES',
    authenticate: 'YES',
    transaction: 'T001',
    line: 1,
  });
});

test('parses a URIMAP definition preserving path case', () => {
  const text = 'DEFINE URIMAP (MAP1) USAGE(CLIENT) PATH(/api/v1) PROGRAM(PROG1) TCPIPSERVICE(SVC1) SCHEME(HTTPS) HOST(host1) ATTLS(AWARE)';
  const { urimaps } = parseCsd(text);
  assert.deepEqual(urimaps.get('MAP1'), {
    usage: 'CLIENT',
    path: '/api/v1',
    program: 'PROG1',
    transaction: null,
    tcpipservice: 'SVC1',
    scheme: 'HTTPS',
    host: 'HOST1',
    attls: 'AWARE',
    line: 1,
  });
});

test('parses a TDQUEUE definition', () => {
  const text = 'DEFINE TDQUEUE (Q1) TYPE(LOCAL) DDNAME(DD1) INDIRECTNAME(IND1) TRANSID(T001)';
  const { tdqueues } = parseCsd(text);
  assert.deepEqual(tdqueues.get('Q1'), {
    type: 'LOCAL',
    ddname: 'DD1',
    indirect: 'IND1',
    transid: 'T001',
    line: 1,
  });
});

test('parses a TRANSACTION definition', () => {
  const text = 'DEFINE TRANSACTION (T001) PROGRAM(PROG1) CMDSEC(YES) RESSEC(YES)';
  const { transactions } = parseCsd(text);
  assert.deepEqual(transactions.get('T001'), {
    program: 'PROG1',
    cmdsec: 'YES',
    ressec: 'YES',
    line: 1,
  });
});

test('ignores comment lines starting with asterisk', () => {
  const text = '* This is a comment\nDEFINE TCPIPSERVICE (SVC1) PORTNUMBER(8080)';
  const { tcpipservices } = parseCsd(text);
  assert.equal(tcpipservices.size, 1);
  assert.equal(tcpipservices.get('SVC1').line, 2);
});

test('handles multi-line definitions by concatenating continuation lines', () => {
  const text = 'DEFINE TCPIPSERVICE (SVC1)\nPORTNUMBER(8080)\nPROTOCOL(HTTP)';
  const { tcpipservices } = parseCsd(text);
  assert.deepEqual(tcpipservices.get('SVC1'), {
    port: '8080',
    protocol: 'HTTP',
    ssl: null,
    authenticate: null,
    transaction: null,
    line: 1,
  });
});

test('returns empty maps for non-DEFINE lines', () => {
  const text = 'LIST TCPIPSERVICE\nADD TCPIPSERVICE (SVC1)';
  const { tdqueues, transactions, tcpipservices, urimaps } = parseCsd(text);
  assert.equal(tdqueues.size, 0);
  assert.equal(transactions.size, 0);
  assert.equal(tcpipservices.size, 0);
  assert.equal(urimaps.size, 0);
});

test('parses multiple definitions of different kinds', () => {
  const text = 'DEFINE TCPIPSERVICE (SVC1) PORTNUMBER(8080)\nDEFINE TRANSACTION (T001) PROGRAM(PROG1)\nDEFINE URIMAP (MAP1) PATH(/test)';
  const { tcpipservices, transactions, urimaps } = parseCsd(text);
  assert.equal(tcpipservices.size, 1);
  assert.equal(transactions.size, 1);
  assert.equal(urimaps.size, 1);
  assert.equal(tcpipservices.get('SVC1').port, '8080');
  assert.equal(transactions.get('T001').program, 'PROG1');
  assert.equal(urimaps.get('MAP1').path, '/test');
});
