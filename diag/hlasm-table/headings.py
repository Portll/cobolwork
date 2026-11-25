# SPDX-License-Identifier: AGPL-3.0-or-later
# Find instruction headings ("MNEM operands [FMT]") and generic "MnemonicN" tables in the PoP page text.
import re, os
from appendix_b import FMT_RE

TXT = os.environ.get("POP_TEXT", "/tmp/cw13-ibm/pop-text")
FMT = FMT_RE.pattern[2:-2]
HEAD = re.compile(r"^(.*?)\[(" + FMT + r")\](?:['\u2018].*)?$")
INNER = r"(?:(?:X|L|R|V)\d?,)?B\d"
FIELD = r"(?:RI\d|R\d|V\d|M\d|I\d?|D\d\(" + INNER + r"\)|DX\d\(" + INNER + r"\))"
TOKEN = re.compile(r"\[|\]|,|" + FIELD)
OPERANDS = re.compile(r"^(?:" + FIELD + r"(?:," + FIELD + r")*)?(?:\[," + FIELD + r"(?:\[," + FIELD + r"\])?\])*$")
TABLE_ROW = re.compile(r"^\s*([A-Z][A-Z0-9]*)\s+['\u2018]([0-9A-F]{2,4})['\u2019](\s|$)")
LABEL = re.compile(r"^(\d{1,2}-\d{1,3})\s|\s(\d{1,2}-\d{1,3})\s*$")

def norm_operands(ops):
    """Tokenise an operand string; insert commas the extraction dropped between fields and
    move a comma that precedes an optional group inside it ("M5,[M6]" -> "M5[,M6]")."""
    out, i, fixes = "", 0, []
    while i < len(ops):
        m = TOKEN.match(ops, i)
        if not m:
            return None, fixes
        t = m.group(0)
        if t not in "[],":
            if out and out[-1] not in "[,":
                out += ","
                fixes.append("comma-inserted")
        out += t
        i = m.end()
    if ",[" in out:
        out = out.replace(",[", "[,")
        fixes.append("comma-moved-into-optional")
    return out, fixes

def page_label(text):
    first = text.strip().split("\n", 1)[0]
    m = LABEL.search(first)
    return (m.group(1) or m.group(2)) if m else None

def split_heading(lead, fmt, known, names):
    """Split 'MNEMoperands' using the appendix's mnemonic->format map; an instruction name
    glued in front of the mnemonic ('VECTORTESTZONEDVTZ...') is dropped."""
    cands = []
    starts = [0] + [len(names[m].replace(" ", "")) for m in names if lead.startswith(names[m].replace(" ", "")) and names[m]]
    for k0 in sorted(set(starts)):
        for k in range(k0 + 1, min(len(lead), k0 + 9) + 1):
            mn = lead[k0:k]
            if known.get(mn) != fmt:
                continue
            ops, fixes = norm_operands(lead[k:])
            if ops is not None and OPERANDS.match(ops):
                cands.append((mn, ops, fixes))
    return cands

def scan(known, names, lo=1, hi=2028):
    """Yield ('head', page, label, mnemonic, operands, fixes) and ('generic', ...) / ('row', ...) events in page order."""
    prev = ""
    for p in range(lo, hi + 1):
        text = open(os.path.join(TXT, f"p{p:04d}.txt")).read()
        label = page_label(text)
        for ln in text.split("\n"):
            s = re.sub(r"\s+", "", ln)
            m = HEAD.match(s)
            if m:
                lead, fmt = m.group(1), m.group(2)
                if lead[:1].isdigit() or lead[:1] == ",":
                    lead = prev + lead
                g = re.match(r"^Mnemonic(\d?)(.*)$", lead)
                if g:
                    ops, fixes = norm_operands(g.group(2))
                    yield ("generic", p, label, "Mnemonic" + g.group(1), fmt, ops, fixes)
                else:
                    c = split_heading(lead, fmt, known, names)
                    clean = [x for x in c if not x[2]]
                    if len(c) > 1 and len(clean) == 1:
                        c = clean
                    if len(c) == 1:
                        yield ("head", p, label, c[0][0], fmt, c[0][1], c[0][2])
                    else:
                        yield ("unmatched", p, label, lead, fmt, c, None)
            else:
                r = TABLE_ROW.match(ln)
                if r:
                    yield ("row", p, label, r.group(1), r.group(2), None, None)
            prev = s
