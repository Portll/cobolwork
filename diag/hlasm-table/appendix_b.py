# SPDX-License-Identifier: AGPL-3.0-or-later
# Parse PoP Appendix B figures (B-1 by name, B-2 by mnemonic, B-3 by opcode) from extracted page text.
import re, os, json, sys

TXT = os.environ.get("POP_TEXT", "/tmp/cw13-ibm/pop-text")
FMT_RE = re.compile(r"^(E|I|IE|MII|RI-[a-c]|RIE-[a-g]|RIL-[a-c]|RIS|RR|RRD|RRE|RRF-[a-e]|RRS|RS-[ab]|RSI|RSL-[ab]|RSY-[ab]|RX-[ab]|RXE|RXF|RXY-[a-c]|S|SI|SIL|SIY|SMI|SS-[a-f]|SSE|SSF|VRI-[a-l]|VRR-[a-k]|VRS-[a-d]|VRV|VRX|VSI)$")
PAGE_END = re.compile(r"(\d{1,2})\s?-\s?(\d{1,3})\s*$")
MNEM = re.compile(r"^[A-Z][A-Z0-9]*$")
HEX = re.compile(r"^[0-9A-F]{2,4}$")
SKIP = re.compile(r"^(B-\d+( IBM z/Architecture Principles of Operation)?|Op-|code Name|code Page|Name|Mne-|monic Characteristics.*|Figure B-\d.*|Instructions Arranged by.*)\s*$")

def page_lines(lo, hi):
    for p in range(lo, hi + 1):
        with open(os.path.join(TXT, f"p{p:04d}.txt")) as f:
            for ln in f.read().split("\n"):
                yield p, ln

def rows(lo, hi):
    buf, start = [], None
    for p, ln in page_lines(lo, hi):
        s = ln.strip()
        if not s:
            continue
        # figure footers are glued onto the last row's line: "... 7-36Figure B-1. ..."
        s = re.sub(r"Figure B-\d\..*$", "", s).strip()
        s = re.sub(r"^(monic|code) Name( Mne-)?( monic)? Characteristics( Page)?", "", s).strip()
        s = re.sub(r"\b([A-Z]{1,3}) -([a-l])\b", r"\1-\2", s)
        if not s or SKIP.match(s):
            continue
        buf.append(s)
        if start is None:
            start = p
        if PAGE_END.search(s):
            yield start, " ".join(buf)
            buf, start = [], None
    if buf:
        yield start, " ".join(buf) + "  <<UNTERMINATED>>"

def split_row(text, kind):
    m = PAGE_END.search(text)
    page = f"{m.group(1)}-{m.group(2)}"
    body = text[: m.start()].strip()
    toks = body.split()
    if kind == "opcode":
        op, rest = toks[0], toks[1:]
        for i in range(1, len(rest)):
            if FMT_RE.match(rest[i]) and MNEM.match(rest[i - 1]):
                return dict(opcode=op, name=" ".join(rest[: i - 1]), mnemonic=rest[i - 1], format=rest[i], chars=" ".join(rest[i + 1 :]), page=page)
    elif kind == "mnemonic":
        mn, rest = toks[0], toks[1:]
        for i in range(1, len(rest)):
            if FMT_RE.match(rest[i]):
                tail = rest[i + 1 :]
                # opcode is the last token of the characteristics, but may be split ("B4 5 7 -36" style)
                return dict(mnemonic=mn, name=" ".join(rest[:i]), format=rest[i], chars=" ".join(tail), page=page)
    elif kind == "name":
        for i in range(1, len(toks)):
            if FMT_RE.match(toks[i]) and MNEM.match(toks[i - 1]):
                return dict(name=" ".join(toks[: i - 1]), mnemonic=toks[i - 1], format=toks[i], chars=" ".join(toks[i + 1 :]), page=page)
    return None

def parse(lo, hi, kind):
    out, bad = [], []
    for p, t in rows(lo, hi):
        r = split_row(t, kind) if "<<UNTERMINATED>>" not in t else None
        if r:
            r["pdfpage"] = p
            out.append(r)
        else:
            bad.append((p, t))
    return out, bad

if __name__ == "__main__":
    res = {}
    for kind, lo, hi in (("name", 2033, 2057), ("mnemonic", 2059, 2083), ("opcode", 2085, 2109)):
        out, bad = parse(lo, hi, kind)
        res[kind] = out
        print(kind, len(out), "unparsed", len(bad), file=sys.stderr)
        for b in bad[:40]:
            print("   BAD", b, file=sys.stderr)
    json.dump(res, open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/cw13-ibm/appendix_b.json", "w"), indent=1)
