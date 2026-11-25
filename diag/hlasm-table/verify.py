# SPDX-License-Identifier: AGPL-3.0-or-later
# Compare rules/hlasm-instructions.json with z390 1.8.4.4's zopcheck files (local check only; z390 is GPL,
# nothing from it goes into the repository).
#   python3 verify.py <rules/hlasm-instructions.json> <z390>/zopcheck
import re, os, sys, json, collections

TABLE, ZOPCHECK = sys.argv[1], sys.argv[2]
SUMMARY = os.path.join(ZOPCHECK, "HLASM_Instruction_Set_Summary.TXT")
LISTING = os.path.join(ZOPCHECK, "HLASM_ZOPCHECK.TXT")

doc = json.load(open(TABLE))
mine = {r["mnemonic"]: r for r in doc["instructions"]}

lines = [re.sub(r"^[^ -~]+", "", x) for x in open(SUMMARY, encoding="utf-8", errors="replace").read().split("\n")]
hdr = lines[0]
cols = ["Mnemonic", "Operands", "Extends", "Optables", "Fmt", "Opcd", "Flags", "Instruction"]
starts = [hdr.index(c) for c in cols]
z = collections.defaultdict(list)
for ln in lines[2:]:
    if not ln.strip():
        continue
    vals = {}
    for i, c in enumerate(cols):
        a = starts[i]
        b = starts[i + 1] if i + 1 < len(cols) else None
        vals[c] = ln[a:b].strip() if b else ln[a:].strip()
    if vals["Fmt"] == "HLASM":
        continue
    z[vals["Mnemonic"]].append(vals)

# ---- listing: object code per assembled statement ----
obj = collections.defaultdict(list)
LST = re.compile(r"^[ i]?([0-9A-F]{6}) ((?:[0-9A-F]{4} ?){1,3})\s.*?\s\d+ ([A-Z0-9]+)_[A-Z]_([0-9A-F]+)(?:_[A-Z]\d+)?\s+([A-Z0-9]+)\s+(\S*)")
for ln in open(LISTING, encoding="utf-8", errors="replace"):
    ln = re.sub(r"^[^ -~]+", "", ln)
    m = LST.match(ln)
    if m:
        code = m.group(2).replace(" ", "")
        obj[m.group(5)].append(dict(code=code, ops=m.group(6), label=m.group(4)))

def opcode_positions(op, fmt, length):
    """hex-digit positions of the op code in the instruction text"""
    if len(op) == 2:
        return [0, 1]
    if len(op) == 3:
        return [0, 1, 3]
    if length == 6 and not fmt.startswith(("SSE", "SIL", "SSF")) and fmt not in ("E",):
        return [0, 1, 10, 11]
    return [0, 1, 2, 3]

# hex-digit position of a mask field in the instruction text, by format
MASK_DIGIT = {"RX-b": {"M1": 2}, "RR": {"M1": 2}, "RI-c": {"M1": 2}, "RIL-c": {"M1": 2}, "RXY-b": {"M1": 2},
              "RRF-c": {"M3": 4}, "RSY-b": {"M3": 3}, "RIE-a": {"M3": 8}, "RIE-b": {"M3": 8}, "RIE-c": {"M3": 3},
              "RRS": {"M3": 8}, "RIS": {"M3": 3}, "RIE-g": {"M3": 3}, "RRF-a": {"M4": 5}}
FIELD_DIGIT = {"VRR-a": {"M5": 6, "M4": 7, "M3": 8}, "VRR-b": {"M5": 6, "M4": 8}, "VRR-c": {"M6": 6, "M5": 7, "M4": 8},
               "VRR-d": {"M5": 5, "M6": 6}, "VRR-e": {"M6": 5, "M5": 7}, "VRX": {"M3": 8}, "VRV": {"M3": 8},
               "VRS-a": {"M4": 8}, "VRS-b": {"M4": 8}, "VRS-c": {"M4": 8}, "VRI-a": {"M3": 8}, "VRI-c": {"M4": 8},
               "VRI-d": {"M5": 8}, "VRI-e": {"M5": 7, "M4": 8}}
out = collections.defaultdict(list)
# 1. z390 mnemonics missing from the table
for mn, rows in sorted(z.items()):
    if mn not in mine:
        out["missing"].append(f"{mn:9} {rows[0]['Fmt']:5} {rows[0]['Opcd']:5} {rows[0]['Optables']:12} {rows[0]['Extends']:8} {rows[0]['Instruction']}")
# 2. summary disagreements (opcode / extends)
for mn, rows in sorted(z.items()):
    if mn not in mine:
        continue
    r = mine[mn]
    zops = {x["Opcd"].replace(".", "") for x in rows if x["Opcd"]}
    want = r.get("opcode")
    if "mask" in r and r["format"] in ("RX-b", "RR"):
        want = r["opcode"] + format(r["mask"], "X")
    elif "mask" in r and r["format"] in ("RI-c", "RIL-c"):
        want = r["opcode"][:2] + format(r["mask"], "X") + r["opcode"][2]
    if want and zops and want not in zops:
        out["summary_opcode"].append(f"{mn}: table {r['opcode']} {r.get('fields','')} / z390 {sorted(zops)}")
    zf = {x["Fmt"] for x in rows}
    fam = re.sub(r"-[a-l]$", "", r["format"])
    if fam not in zf:
        out["summary_format_family"].append(f"{mn}: table {r['format']} / z390 {sorted(zf)}")
    zext = {x["Extends"] for x in rows if x["Extends"]}
    if "extends" in r and zext and r["extends"] not in zext and r.get("instruction") not in zext:
        out["summary_extends"].append(f"{mn}: table {r['extends']} / z390 {sorted(zext)}")
    if "extends" in r and not zext:
        out["summary_ext_no_extends"].append(f"{mn}: table {r['extends']} / z390 Extends blank")
    if "extends" not in r and zext:
        out["summary_base_but_z390_extends"].append(f"{mn}: z390 Extends {sorted(zext)}")
# 3. listing: opcode bits and length
for mn, r in sorted(mine.items()):
    if mn not in obj:
        out["not_in_listing"].append(mn)
        continue
    good = [o for o in obj[mn] if set(o["code"]) != {"0"}]
    if not good:
        n = len(obj[mn][0]["code"]) // 2
        out["listing_all_zero"].append(f"{mn}: {obj[mn][0]['code']}")
        if n != r["length"]:
            out["listing_length"].append(f"{mn}: table {r['length']} / listing {n} (error statement)")
        continue
    for o in good[:1]:
        code = o["code"]
        n = len(code) // 2
        if n != r["length"]:
            out["listing_length"].append(f"{mn}: table {r['length']} / listing {n} ({code})")
        pos = opcode_positions(r["opcode"], r["format"], r["length"])
        got = "".join(code[i] for i in pos if i < len(code))
        if got != r["opcode"]:
            out["listing_opcode"].append(f"{mn}: table {r['opcode']} {r['format']} / listing {code}")
        if "extends" in r and r["format"] in FIELD_DIGIT and any(isinstance(v, int) for v in r["fields"].values()):
            for fld, v in r["fields"].items():
                if not isinstance(v, int):
                    continue
                pos = FIELD_DIGIT[r["format"]].get(fld)
                if pos is None or v > 15:
                    out["field_unchecked"].append(f"{mn} {r['format']} {fld}")
                elif code[pos] != format(v, "X"):
                    out["listing_field"].append(f"{mn}: table {r['extends']} {fld}={v} / listing {code}")
                else:
                    out["field_ok"].append(f"{mn} {fld}")
            continue
        if "mask" in r and r["format"] in MASK_DIGIT:
            mfield = next(iter(r["fields"]))
            want = MASK_DIGIT[r["format"]].get(mfield)
            if want is None:
                out["mask_unchecked"].append(f"{mn} {r['format']} {mfield}")
            elif code[want] != format(r["mask"], "X"):
                out["listing_mask"].append(f"{mn}: table {r['extends']} mask {r['mask']} / listing {code}")
            else:
                out["mask_ok"].append(mn)
        elif "mask" in r:
            out["mask_unchecked"].append(f"{mn} {r['format']}")
for mn in sorted(set(obj) - set(mine)):
    out["listing_not_in_table"].append(mn)
for mn in sorted(set(mine) - set(z)):
    out["not_in_z390_summary"].append(mn + (" (ext)" if "extends" in mine[mn] else ""))
cat = collections.Counter()
for ln in out["missing"]:
    f = ln.split()
    opt = ln[22:35].strip()
    cat["ESA/370 vector facility (370-ESA)" if f[0].endswith("*") else
        "S/370 or DOS-era (370/DOS optable)" if re.search(r"370\b|DOS-370", opt) and "Z10" not in opt else
        "CPU-measurement facility (Z10)" if "Z10" in opt else "other: " + f[0]] += 1
print(dict(cat))
print(json.dumps({k: len(v) for k, v in out.items()}))
for k, v in out.items():
    print("==", k, len(v))
    for x in v:
        print("  ", x)

corpus = "LA MVC L ST B BE LR MVI BR CLI CLC SR BNE BAL CP STM PACK LM ZAP LTR BALR OI BNH C BH SLR BL XC BNZ BCT BC AP LHI ED LARL AR CVB IC UNPK BCTR CVD STH BAS CR TM LH BZ BO CH S D STC MP A MVCL XR SLL BNP BASR STCM BRAS BNL ICM AHI TR N LAY M DP SP OC SRL TRT MH SRP NC CLM BCR SPM MVCIN LRL LGHI AGR J SRDA SLDL AH O NOP CLCL SRA BM LHRL MVZ SLA EX EXRL SVC PC PR SSAR MODESET".split()
print("== corpus")
for mn in corpus:
    r = mine.get(mn)
    zf = sorted({x["Fmt"] + " " + x["Opcd"] for x in z.get(mn, [])})
    lst = obj.get(mn, [{}])[0].get("code")
    print(f"  {mn:8} " + (f"{r['format']:6} {r['opcode']:5} len {r['length']} ops {r['operands']!s:16} {('ext of ' + r['extends'] + ' mask ' + str(r.get('mask'))) if 'extends' in r else ''}" if r else "ABSENT") + f"   | z390 {zf} listing {lst}")
