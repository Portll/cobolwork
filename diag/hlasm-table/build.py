# SPDX-License-Identifier: AGPL-3.0-or-later
# Build cobolwork's rules/hlasm-instructions.json from the extracted text of the z/Architecture Principles of
# Operation (SA22-7832-14) and the HLASM V1R6 Language Reference (SC26-4940-09).
#   python3 extract.py SA22-7832-14.pdf <pop-text>; python3 extract.py <language reference>.pdf <asmr-text>
#   POP_TEXT=<pop-text> ASMR_TEXT=<asmr-text> python3 build.py <out.json> [report.json]
# extract.py needs pypdf. The table's "sources" block names where each document is fetched.
import re, os, sys, json, collections, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import appendix_b
from headings import scan, norm_operands

POP = os.environ.get("POP_TEXT", "/tmp/cw13-ibm/pop-text")
ASMR = os.environ.get("ASMR_TEXT", "/tmp/cw13-ibm/asmr-text")
report = collections.defaultdict(list)

# ---------- base instructions from Appendix B ----------
B = {}
for kind, lo, hi in (("name", 2033, 2057), ("mnemonic", 2059, 2083), ("opcode", 2085, 2109)):
    B[kind], bad = appendix_b.parse(lo, hi, kind)
    for p, t in bad:
        report["appendixB_unparsed"].append(f"{kind} p{p}: {t}")
mnemonics = {r["mnemonic"] for r in B["mnemonic"]}

def pick(rows, key_ok):
    return [r for r in rows if key_ok(r)]

def reparse(row_text_rows, kind):
    """Re-split rows so that the mnemonic is one of Figure B-2's mnemonics (a word broken across lines,
    e.g. 'IMMEDIAT E', can otherwise look like an E-format mnemonic)."""
    out = {}
    for r in row_text_rows:
        out[r["mnemonic"]] = r
    return out

by = {k: {} for k in B}
for kind in B:
    for r in B[kind]:
        mn = r["mnemonic"]
        if mn not in mnemonics:
            # find the real mnemonic inside the name/chars text
            text = (r["name"] + " " + mn + " " + r["format"] + " " + r["chars"]).split()
            for i in range(len(text) - 1):
                if text[i] in mnemonics and appendix_b.FMT_RE.match(text[i + 1]):
                    r = dict(r, mnemonic=text[i], name=" ".join(text[:i]), format=text[i + 1], chars=" ".join(text[i + 2:]))
                    break
            else:
                report["appendixB_unresolved"].append(f"{kind}: {r}")
                continue
        by[kind][r["mnemonic"]] = r
for mn, r in by["mnemonic"].items():
    # Figure B-2 rows: the format is the format-shaped token whose split agrees with Figure B-3
    pass

words = collections.Counter()
for kind in by:
    for r in by[kind].values():
        words.update(re.sub(r"\([^)]*\)", " ", r["name"]).split())

def strip_paren(n):
    # "(32) 16" is "(32<-16)" with the arrow lost; the qualifier and its stray digits go together
    n = re.sub(r"[\uf000-\uf0ff]", "", n)
    return re.sub(r"\s+", " ", re.sub(r"\([^)]*\)(\s*\d+\b)?", " ", n)).strip()

def vote_name(cands):
    cands = [strip_paren(c) for c in cands]
    c = collections.Counter(cands)
    best = max(c.items(), key=lambda kv: (kv[1], min(words[w] for w in kv[0].split()) if kv[0] else 0))
    return best[0]

# section titles from the chapter tables of contents, keyed by page
toc = collections.defaultdict(set)
TOC_RE = re.compile(r"^(.*?)\s*(?:\.\s*){2,}\s*(\d{1,2}-\d{1,3})\s*$")
for p in range(1, 2029):
    prev = ""
    for ln in open(os.path.join(POP, f"p{p:04d}.txt")).read().split("\n"):
        s = ln.strip()
        m = TOC_RE.match(s)
        if m:
            t = re.sub(r"\s+", " ", m.group(1)).strip()
            toc[m.group(2)].add(t)
            if prev and not TOC_RE.match(prev) and re.fullmatch(r"[A-Z][A-Z0-9 ,/&'\-]*", prev):
                toc[m.group(2)].add(re.sub(r"\s+", " ", prev + " " + t).strip())
        prev = s

def is_subseq(short, long):
    it = iter(long)
    return all(ch in it for ch in short)

def abbrev_match(base, title):
    bw, tw = base.split(), title.split()
    if len(bw) != len(tw):
        return False
    for b, t in zip(bw, tw):
        if b == t:
            continue
        if b == "&" and t == "AND":
            continue
        if b == t + "S":
            continue
        if b.endswith(".") and t.startswith(b[0]) and is_subseq(b[:-1], t):
            continue
        return False
    return True

def resolve_name(mn, page):
    base = vote_name([by[k][mn]["name"] for k in by if mn in by[k]])
    titles = toc.get(page, set())
    if base in titles:
        return base
    flat = base.replace(" ", "")
    for t in titles:
        if t.replace(" ", "") == flat:
            return t
    m = [t for t in titles if abbrev_match(base, t)]
    if not m and re.search(r"[.&]", base):
        m = sorted({t for ts in toc.values() for t in ts if abbrev_match(base, t)})
    if len(m) == 1:
        report["name_expanded"].append(f"{mn}: {base} -> {m[0]}")
        return m[0]
    report["name_not_in_toc"].append(f"{mn} {page}: {base}")
    return base

base = {}
for mn in sorted(mnemonics):
    rows = [by[k].get(mn) for k in ("opcode", "mnemonic", "name")]
    if None in rows:
        report["appendixB_missing_in_a_figure"].append(mn)
        rows = [r for r in rows if r]
    fmts = {r["format"] for r in rows}
    pages = {r["page"] for r in rows}
    op = by["opcode"][mn]["opcode"] if mn in by["opcode"] else None
    for k in ("mnemonic", "name"):
        r = by[k].get(mn)
        if r and not r["chars"].replace(" ", "").endswith(op):
            report["appendixB_opcode_disagrees"].append(f"{mn}: B-3 {op}, {k}: {r['chars']}")
    fmt = by["opcode"][mn]["format"]
    if len(fmts) > 1:
        report["appendixB_format_disagrees"].append(f"{mn}: {sorted(fmts)} (B-3 {fmt} used)")
    page = by["opcode"][mn]["page"]
    if len(pages) > 1:
        report["appendixB_page_disagrees"].append(f"{mn}: {sorted(pages)} (B-3 {page} used)")
    base[mn] = dict(mnemonic=mn, opcode=op, format=fmt, page=page)
for mn in base:
    base[mn]["name"] = resolve_name(mn, base[mn]["page"])

# ---------- lengths ----------
LEN6 = re.compile(r"^(MII|SMI|RIL|RIE|RIS|RRS|RSL|RSY|RXE|RXF|RXY|SIL|SIY|SS|SSE|SSF|VR.|VSI)")
def fmt_length(fmt):
    if fmt in ("RR", "E", "I"):
        return 2
    return 6 if LEN6.match(fmt) else 4
def opcode_length(op):
    b = int(op[:2], 16) >> 6
    return {0: 2, 1: 4, 2: 4, 3: 6}[b]
for mn, r in base.items():
    r["length"] = fmt_length(r["format"])
    if r["length"] != opcode_length(r["opcode"]):
        report["length_format_vs_opcode"].append(f"{mn} {r['format']} {r['opcode']}")

# ---------- operand syntax from each instruction's heading ----------
known = {mn: r["format"] for mn, r in base.items()}
names = {mn: r["name"] for mn, r in base.items()}
found = collections.defaultdict(list)
gens = []
for ev in scan(known, names):
    kind, p, label = ev[:3]
    if kind == "head":
        found[ev[3]].append(dict(pdf=p, label=label, ops=ev[5], fixes=ev[6]))
    elif kind == "generic":
        gens.append(ev)
    elif kind == "unmatched":
        report["heading_unmatched"].append(f"p{p} {label}: {ev[3]} [{ev[4]}] cands={ev[5]}")
    elif kind == "row":
        mn, op = ev[3], ev[4]
        if mn not in base or base[mn]["opcode"] != op:
            continue
        cand = [g for g in gens[-12:] if g[4] == known[mn] and p - g[1] <= 1]
        if cand:
            g = cand[-1]
            found[mn].append(dict(pdf=p, label=g[2], ops=g[5], fixes=g[6] + ["generic-table"]))
        else:
            report["generic_row_without_heading"].append(f"{mn} p{p}")
for mn, r in base.items():
    f = found.get(mn)
    if not f:
        report["no_heading"].append(mn)
        r["operands"] = None
        continue
    opsset = {x["ops"] for x in f}
    if len(opsset) > 1:
        report["heading_operands_disagree"].append(f"{mn}: {f}")
    near = [x for x in f if x["label"] == r["page"]] or f
    r["operands"] = near[0]["ops"]
    if not any(x["label"] == r["page"] or x["label"] is None for x in f):
        report["heading_page_differs"].append(f"{mn}: appendix {r['page']}, heading on {[x['label'] for x in f]}")
    fx = [x for x in near[0]["fixes"] if x != "generic-table"]
    if fx:
        report["operand_text_fixes"].append(f"{mn}: {fx} -> {r['operands']}")

def split_items(ops):
    """'R1,R2,I3,I4[,I5]' -> (['R1','R2','I3','I4'], ['I5'])"""
    req, opt = [], []
    if not ops:
        return req, opt
    m = re.match(r"^([^\[]*)(.*)$", ops)
    req = [x for x in re.findall(r"D\w*\([^)]*\)|[^,]+", m.group(1)) if x]
    opt = re.findall(r"\[,([^\[\]]+)", m.group(2))
    return req, opt

# ---------- extended mnemonics: PoP Appendix J ----------
INNER = r"(?:(?:X|L|R|V)\d?,)?B\d"
FIELD = r"(?:RI\d|R\d|V\d|M\d|I\d|D\d\(" + INNER + r"\)|DX\d\(" + INNER + r"\))"
EXT_PIECE = re.compile(r"\[," + FIELD + r"\]|,?" + FIELD)
NUM = r"(?:\d+|X'[0-9A-F]+')"
ATOM0 = r"(?:" + FIELD + r"|" + NUM + r"|\[" + FIELD + r"\])"
EXPR0 = r"-?" + ATOM0 + r"(?:[-+|]" + ATOM0 + r")*"
ATOM = r"(?:" + ATOM0 + r"|\(" + EXPR0 + r"\))"
EXPR = r"-?" + ATOM + r"(?:[-+|]" + ATOM + r")*"
ITEM = re.compile(r"\[," + EXPR + r"\]|" + EXPR)
FIELD_NAMES = re.compile(r"(?:RI|DX|R|V|M|I|D|X|B|L)\d")
PAGE_END = re.compile(r"(?:^|\s)(\d\s?\d?\s?-\s?\d{1,3})\s*$")

def base_items(S, b):
    """Greedy comma-separated base operand items starting at S[b]; returns (items, end)."""
    items, i = [], b
    while True:
        m = ITEM.match(S, i)
        if not m:
            break
        items.append(m.group(0))
        i = m.end()
        if S.startswith(",", i) and ITEM.match(S, i + 1):
            i += 1
            continue
        if S.startswith("[,", i):
            continue
        break
    return items, i

J_FIXED = collections.Counter()
def j_clean(s):
    s = s.replace("‘", "'").replace("’", "'")
    t = re.sub(r"\bi(\d)", r"I\1", s)
    if t != s:
        J_FIXED["lower-case-field-name"] += 1
    s = t
    t = re.sub(r"D\s?(\d)\s?,\s?\(", r"D\1(", s)
    if t != s:
        J_FIXED["D2,(B2)->D2(B2)"] += 1
    return t

def parse_j(text, bases):
    page = None
    m = PAGE_END.search(text)
    if m:
        page = re.sub(r"\s", "", m.group(1))
        text = text[: m.start()].rstrip()
    toks = text.split()
    bounds, S = [], ""
    for t in toks:
        bounds.append((len(S), len(S) + len(t)))
        S += t
    tokstarts = {a for a, _ in bounds}
    out = []
    for ti, (i, tend) in enumerate(bounds):
        name = " ".join(toks[:ti])
        if re.search(r"[a-z,]|^\d", name):
            continue
        for a in range(i + 1, tend + 1):
            ext = S[i:a]
            if not re.fullmatch(r"[A-Z][A-Z0-9]*", ext):
                break
            ends, acc = [a], a
            while True:
                pm = EXT_PIECE.match(S, acc)
                if not pm or (acc == a and pm.group(0).startswith(",")):
                    break
                acc = pm.end()
                ends.append(acc)
            for j in ends:
                extops = S[a:j]
                for bmn in bases:
                    if not S.startswith(bmn, j):
                        continue
                    items, k = base_items(S, j + len(bmn))
                    rest = S[k:]
                    if not items:
                        continue
                    if rest and (k not in tokstarts or not re.match(r"[A-Za-z(]", rest)):
                        continue
                    if set(FIELD_NAMES.findall(extops)) != set(FIELD_NAMES.findall("".join(items))):
                        continue
                    req, opt = split_items(bases[bmn])
                    n_req = sum(1 for x in items if not x.startswith("[,"))
                    if not (len(req) <= len(items) <= len(req) + len(opt)) and not (n_req == len(req)):
                        continue
                    out.append(dict(name=name, ext=ext, extops=extops, base=bmn, items=items, comment=rest, page=page))
    # same parse found through different token starts collapses to one
    uniq = {}
    for c in out:
        uniq[(c["ext"], c["extops"], c["base"], tuple(c["items"]))] = c
    return list(uniq.values())

def j_lines():
    started = False
    for p in range(2145, 2169):
        for ln in open(os.path.join(POP, f"p{p:04d}.txt")).read().split("\n"):
            if not started:
                started = ln.startswith("Instruction Name Extended-Mnemonic Syntax")
                continue
            if ln.startswith("Explanation and Notes"):
                return
            ln = re.sub(r"Figure J-1\..*$", "", j_clean(ln)).rstrip()
            if re.match(r"^(J-\d+( IBM z/Architecture Principles of Operation)?|Instruction Name Extended-Mnemonic Syntax.*|\s*)$", ln):
                continue
            yield p, ln

def run_j(bases):
    rows, pending = [], []
    def choose(c):
        return c[0] if len(c) == 1 else None
    for p, ln in j_lines():
        if pending:
            tail = parse_j(pending[-1][1] + " " + ln, bases)
            tail = [c for c in tail if not c["name"]]
            if tail:
                if len(pending) > 1:
                    pg = PAGE_END.search(" ".join(x for _, x in pending[:-1]))
                    if pg and rows and rows[-1].get("page") is None:
                        rows[-1]["page"] = re.sub(r"\s", "", pg.group(1))
                pending = []
                rows.append(dict(tail[0], pdf=p, raw=ln) if len(tail) == 1 else dict(cands=tail, pdf=p, raw=ln, page=None))
                continue
        alone = parse_j(ln, bases)
        if alone:
            if pending:
                pg = PAGE_END.search(" ".join(x for _, x in pending))
                if pg and rows and rows[-1]["page"] is None:
                    rows[-1]["page"] = re.sub(r"\s", "", pg.group(1))
                if pending and not all(re.match(r"^\s*([a-z(]|\d+-\d+|[a-z])", x) or re.fullmatch(r"[A-Z0-9 ()&,\-]+", x.strip()) for _, x in pending):
                    report["J_lines_dropped"].append(" | ".join(x for _, x in pending))
            pending = []
            rows.append(dict(alone if len(alone) > 1 else alone[0], pdf=p, raw=ln) if len(alone) == 1 else dict(cands=alone, pdf=p, raw=ln, page=None))
            continue
        joined = None
        for cut in range(len(pending)):
            joined = parse_j(" ".join([x for _, x in pending[cut:]] + [ln]), bases)
            if joined:
                break
        if joined:
            pending = []
            rows.append(dict(joined[0], pdf=p, raw=ln) if len(joined) == 1 else dict(cands=joined, pdf=p, raw=ln, page=None))
            continue
        pending.append((p, ln))
        if len(pending) > 6:
            report["J_pending_overflow"].append(" | ".join(x for _, x in pending))
            pending = pending[-3:]
    if pending:
        pg = PAGE_END.search(" ".join(x for _, x in pending))
        if pg and rows and rows[-1].get("page") is None:
            rows[-1]["page"] = re.sub(r"\s", "", pg.group(1))
    return rows

bases = {mn: r["operands"] or "" for mn, r in base.items()}
rows = run_j(bases)
# second pass: extended mnemonics used as the base of other extended mnemonics (RISBHGZ, ...)
ext_ops = {}
for r in rows:
    if "ext" in r:
        ext_ops.setdefault(r["ext"], r["extops"])
for k in [k for k in report if k.startswith("J_")]:
    del report[k]
rows = run_j({**bases, **ext_ops})

def disambiguate(r):
    if "cands" not in r:
        return r
    c = r["cands"]
    # prefer the parse whose positional items agree with the base syntax's field names
    def score(x):
        req, opt = split_items(({**bases, **ext_ops}).get(x["base"], ""))
        names_ = req + opt
        s = 0
        for it, fn in zip([y[2:-1] if y.startswith("[,") else y for y in x["items"]], names_):
            s += 2 if it == fn else (1 if re.fullmatch(r"-?\d+|X'[0-9A-F]+'", it) else 0)
        return (s, len(x["ext"]))
    c = sorted(c, key=score, reverse=True)
    if score(c[0]) == score(c[1]):
        report["J_ambiguous"].append(f"{r['raw']}: {[(x['ext'], x['extops'], x['base'], x['items']) for x in c]}")
    return dict(c[0], pdf=r["pdf"], raw=r["raw"], page=c[0]["page"] or r.get("page"))

rows = [disambiguate(r) for r in rows]
group_page = None
for r in rows:
    if r.get("page"):
        group_page = r["page"]
    r["group_page"] = group_page

def resolve_machine(mn, seen=()):
    if mn in base:
        return mn
    for r in rows:
        if r["ext"] == mn and mn not in seen:
            return resolve_machine(r["base"], seen + (mn,))
    return None

def fields_for(r):
    req, opt = split_items(({**bases, **ext_ops}).get(r["base"], ""))
    names_ = req + opt
    fields = {}
    for it, fn in zip(r["items"], names_):
        v = it[2:-1] if it.startswith("[,") else it
        if v == fn:
            continue
        key = re.match(r"^[A-Z]+\d", fn).group(0) if re.match(r"^[A-Z]+\d", fn) else fn
        fields[key] = int(v) if re.fullmatch(r"\d+", v) else v
    if len(r["items"]) > len(names_):
        report["J_more_items_than_base_fields"].append(f"{r['ext']}: {r['items']} vs {names_}")
    return fields

# The PoP states that a Z suffix ORs X'80' into I4 (7-430, 7-428) and a T suffix ORs X'80' into I3 (7-427).
SUFFIX_BIT = {"Zero-remaining-bits": ("I4", "I4|X'80'"), "Test-results": ("I3", "I3|X'80'")}

def make_ext(r, page):
    mm = resolve_machine(r["base"])
    if mm is None:
        report["J_unresolved_base"].append(f"{r['ext']} -> {r['base']}")
        return None
    ops, fixes = norm_operands(r["extops"])
    f = fields_for(r)
    for key, (fld, val) in SUFFIX_BIT.items():
        if r.get("comment", "").startswith(key.replace(" ", "")) and not f:
            f = {fld: val}
    e = dict(mnemonic=r["ext"], extends=r["base"], fields=f, operands=ops,
             format=base[mm]["format"], length=base[mm]["length"], opcode=base[mm]["opcode"],
             source="pop", page=page)
    if mm != r["base"]:
        e["instruction"] = mm
    masks = {k: v for k, v in f.items() if k.startswith("M") and isinstance(v, int)}
    if len(masks) == 1 and len(f) == 1:
        e["mask"] = next(iter(masks.values()))
    if fixes:
        report["J_operand_fixes"].append(f"{r['ext']}: {fixes}")
    return e

ext = {}
for r in rows:
    if r["ext"] in base:
        report["J_ext_is_machine_mnemonic"].append(f"{r['ext']} (App J: {r['base']} {r['items']}; Appendix B: {base[r['ext']]['opcode']} {base[r['ext']]['format']})")
        continue
    # cite the Appendix J page the row is printed on (J-1 is PDF page 2145)
    e = make_ext(r, f"J-{r['pdf'] - 2144}")
    if not e:
        continue
    if r["ext"] in ext:
        if (ext[r["ext"]]["extends"], ext[r["ext"]]["fields"]) != (e["extends"], e["fields"]):
            report["J_duplicate_conflict"].append(f"{r['ext']}: kept {ext[r['ext']]['extends']} {ext[r['ext']]['fields']}, dropped {e['extends']} {e['fields']} (p{r['pdf']})")
        continue
    ext[r["ext"]] = e
report["J_text_fixes"] = [dict(J_FIXED)]

# ---------- cross-check: the "Extended Mnemonic / Base Mnemonic" tables in the instruction descriptions ----------
from headings import page_label
allbases = {**bases, **ext_ops}
sect = {}
for p in range(1, 2029):
    text = open(os.path.join(POP, f"p{p:04d}.txt")).read()
    if "Extended Mnemonic Base Mnemonic" not in text:
        continue
    label = page_label(text)
    on = False
    pending = ""
    for ln in text.split("\n"):
        if ln.startswith("Extended Mnemonic Base Mnemonic"):
            on, pending = True, ""
            continue
        if not on:
            continue
        ln = j_clean(ln)
        c = parse_j(pending + " " + ln if pending else ln, allbases)
        c = [x for x in c if not re.fullmatch(r"(RI|R|V|M|I|X|B|D|L)\d+", x["ext"])]
        if c:
            c = sorted(c, key=lambda x: len(x["ext"]), reverse=True)
            sect.setdefault(c[0]["ext"], (c[0], label, p))
            pending = ""
        elif not pending and re.match(r"^[A-Z][A-Z0-9]* ", ln):
            pending = ln
        else:
            on, pending = False, ""
report["section_table_rows"] = [len(sect)]
for mn, (r, label, p) in sorted(sect.items()):
    if mn in base:
        continue
    if mn in ext:
        e = ext[mn]
        f = fields_for(r)
        ops, _ = norm_operands(r["extops"])
        if (e["extends"], e["fields"], e["operands"]) != (r["base"], f, ops):
            report["section_vs_appendixJ"].append(f"{mn}: App J {e['extends']} {e['operands']} {e['fields']} ({e['page']}) / section {r['base']} {ops} {f} ({label}); section used")
            ext[mn] = make_ext(r, label)
        continue
    e = make_ext(r, label)
    if e:
        ext[mn] = e
        report["section_table_only"].append(f"{mn} ({label}) -> {r['base']} {e['fields']}")
for mn in sorted(set(ext) - set(sect)):
    if ext[mn]["source"] == "pop":
        report["appendixJ_only"].append(mn)

# ---------- HLASM Language Reference: branch extended mnemonics and alternative mnemonics ----------
def asmr_page(text):
    m = re.search(r"Machine instruction statements\s+(\d+)", text) or re.search(r"^(\d+)\s+High Level Assembler", text, re.M)
    return m.group(1) if m else None

hl = {}
SUB = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
for p in range(90, 100):
    text = open(os.path.join(ASMR, f"p{p:04d}.txt")).read()
    page = asmr_page(text)
    for ln in text.translate(SUB).split("\n"):
        m = re.match(r"^([A-Z]+)\s+.*?(D2\(X2,B2\)|R2|label)\s.*\s(RX|RR|RI|RIL)\s+(BC|BCR|BRC|BRCL)\s+(\d+),", ln)
        if m:
            hl.setdefault(m.group(1), dict(base=m.group(4), mask=int(m.group(5)), ops=m.group(2), page=page, fig=True))
        m = re.match(r"^(BRAS|BRASL|BRCT|BRCTG|BRXH|BRXHG|BRXLE|BRXLG) (J[A-Z]+) ", ln)
        if m:
            hl.setdefault(m.group(2), dict(base=m.group(1), mask=None, ops=None, page=page, fig=False))
report["hlasm_rows"] = [len(hl)]
for mn, h in sorted(hl.items()):
    if mn in ext:
        e = ext[mn]
        if e["extends"] != h["base"] or (h["mask"] is not None and e.get("mask") != h["mask"]):
            report["hlasm_vs_pop_disagree"].append(f"{mn}: PoP {e['extends']} {e.get('mask')} / HLASM {h['base']} {h['mask']}")
        continue
    if mn in base:
        report["hlasm_name_is_machine_mnemonic"].append(mn)
        continue
    b = base[h["base"]]
    req, opt = split_items(b["operands"])
    if h["mask"] is not None:
        ops = ",".join(req[1:])
        e = dict(mnemonic=mn, extends=h["base"], fields={req[0][:2]: h["mask"]}, operands=ops, mask=h["mask"])
    else:
        e = dict(mnemonic=mn, extends=h["base"], fields={}, operands=b["operands"])
    e.update(format=b["format"], length=b["length"], opcode=b["opcode"], source="hlasm", page=h["page"])
    ext[mn] = e
    report["hlasm_only"].append(mn)

# ---------- output ----------
inst = []
for mn, r in base.items():
    inst.append(dict(mnemonic=mn, name=r["name"], opcode=r["opcode"], format=r["format"], operands=r["operands"],
                     length=r["length"], source="pop", page=r["page"]))
clash = set(ext) & set(base)
for mn in clash:
    report["ext_name_clashes_with_machine"].append(mn)
for mn, e in ext.items():
    if mn in base:
        continue
    order = ["mnemonic", "extends", "instruction", "mask", "fields", "operands", "format", "length", "opcode", "source", "page"]
    inst.append({k: e[k] for k in order if k in e})
inst.sort(key=lambda r: r["mnemonic"])
doc = {
    "_comment": "Machine-instruction mnemonics for the HLASM statement reader: format, operation code, assembler operand syntax and length of each z/Architecture instruction, and each extended mnemonic with the instruction and field values it stands for. Every row is a fact taken from the cited IBM publication at the cited page; no IBM prose is copied.",
    "schemaVersion": 1,
    "retrieved": "2026-10-03",
    "sources": {
        "pop": {"doc": "z/Architecture Principles of Operation", "number": "SA22-7832-14", "edition": "Fifteenth Edition (April, 2025)",
                "url": "https://www.ibm.com/docs/en/module_1678991624569/pdf/SA22-7832-14.pdf"},
        "hlasm": {"doc": "High Level Assembler for z/OS & z/VM & z/VSE 1.6 Language Reference", "number": "SC26-4940-09",
                  "url": "https://www.ibm.com/docs/en/hla-and-tf/1.6.0"},
    },
    "instructions": inst,
}
out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/cw13-ibm/hlasm-instructions.json"
with open(out, "w") as f:
    f.write("{\n")
    for k in doc:
        if k != "instructions":
            f.write(f" {json.dumps(k)}: {json.dumps(doc[k], ensure_ascii=False)},\n")
    f.write(' "instructions": [\n')
    f.write(",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in inst))
    f.write("\n ]\n}\n")
rep = sys.argv[2] if len(sys.argv) > 2 else "/tmp/cw13-ibm/build-report.json"
json.dump({k: v for k, v in report.items()}, open(rep, "w"), indent=1, ensure_ascii=False)
print("base", sum(1 for r in inst if "extends" not in r), "extended", sum(1 for r in inst if "extends" in r),
      "pop-ext", sum(1 for r in inst if "extends" in r and r["source"] == "pop"),
      "hlasm-ext", sum(1 for r in inst if "extends" in r and r["source"] == "hlasm"))
for k, v in report.items():
    print(f"{k}: {len(v)}")
