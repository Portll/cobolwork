// SPDX-License-Identifier: AGPL-3.0-or-later
// RFC 3161 as the git witness's sibling (docs/spec/evidence.md §8): the request `anchor --tsq`
// keeps beside a seal, and the facts of a time-stamp response cobolwork checks itself, its status,
// message imprint, nonce and time. The TSA's signature is OpenSSL's to check.

const SHA256_OID = Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);

// One DER element at `at`: its tag and where its contents start and end.
function element(buf, at, end = buf.length) {
  if (at + 2 > end) throw new Error('a DER element runs past the end');
  const tag = buf[at];
  let length = buf[at + 1];
  let start = at + 2;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n < 1 || n > 4 || start + n > end) throw new Error('a DER length is not one this reads');
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + buf[start + i];
    start += n;
  }
  if (start + length > end) throw new Error('a DER element runs past the end');
  return { tag, start, end: start + length };
}

function children(buf, parent) {
  const out = [];
  for (let at = parent.start; at < parent.end;) {
    const c = element(buf, at, parent.end);
    out.push(c);
    at = c.end;
  }
  return out;
}

const contents = (buf, el) => buf.subarray(el.start, el.end);
const expect = (el, tag, what) => {
  if (!el || el.tag !== tag) throw new Error(`${what} is not where RFC 3161 puts it`);
  return el;
};
// An INTEGER's magnitude as hex, leading zero bytes dropped, so 00 80 and 80 compare equal.
const integerHex = (bytes) => {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return Buffer.from(bytes.subarray(i)).toString('hex');
};

function imprintOf(buf, el, what) {
  const [algorithm, hashed] = children(buf, expect(el, 0x30, `${what}'s message imprint`));
  const oid = expect(children(buf, expect(algorithm, 0x30, `${what}'s hash algorithm`))[0], 0x06, `${what}'s hash algorithm`);
  if (!contents(buf, oid).equals(SHA256_OID)) throw new Error(`${what} is not over SHA-256`);
  return Buffer.from(contents(buf, expect(hashed, 0x04, `${what}'s hashed message`))).toString('hex');
}

// The message imprint and nonce of a TimeStampReq that `anchor --tsq` wrote.
export function readRequest(der) {
  const [version, imprint, ...rest] = children(der, expect(element(der, 0), 0x30, 'the request'));
  expect(version, 0x02, "the request's version");
  const nonce = rest.find((e) => e.tag === 0x02);
  return { digest: imprintOf(der, imprint, 'the request'), nonce: nonce ? integerHex(contents(der, nonce)) : null };
}

// status, digest (hex), nonce (hex or null) and genTime of a TimeStampResp; throws on a response
// whose shape is not RFC 3161's.
export function readResponse(der) {
  const [statusInfo, token] = children(der, expect(element(der, 0), 0x30, 'the response'));
  const status = parseInt(integerHex(contents(der, expect(children(der, expect(statusInfo, 0x30, 'the status'))[0], 0x02, 'the status'))), 16);
  if (status > 1 || !token) return { status, digest: null, nonce: null, genTime: null };
  const [, signedWrapper] = children(der, expect(token, 0x30, 'the time-stamp token'));
  const signedData = children(der, expect(signedWrapper, 0xa0, 'the signed data'))[0];
  const encapsulated = children(der, expect(signedData, 0x30, 'the signed data'))[2];
  const [, contentWrapper] = children(der, expect(encapsulated, 0x30, 'the encapsulated content'));
  const octets = children(der, expect(contentWrapper, 0xa0, 'the TSTInfo'))[0];
  const tst = element(der, expect(octets, 0x04, 'the TSTInfo').start, octets.end);
  const fields = children(der, expect(tst, 0x30, 'the TSTInfo'));
  const genTime = expect(fields[4], 0x18, 'genTime');
  const nonce = fields.slice(5).find((e) => e.tag === 0x02);
  return {
    status,
    digest: imprintOf(der, fields[2], 'the response'),
    nonce: nonce ? integerHex(contents(der, nonce)) : null,
    genTime: contents(der, genTime).toString('latin1'),
  };
}
