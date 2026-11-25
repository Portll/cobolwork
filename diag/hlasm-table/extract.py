# SPDX-License-Identifier: AGPL-3.0-or-later
# Extract each PDF page's text to <outdir>/pNNNN.txt using pypdf, in parallel.
import sys, os
from multiprocessing import Pool
from pypdf import PdfReader

PDF, OUT = sys.argv[1], sys.argv[2]

def work(rng):
    r = PdfReader(PDF)
    for i in range(*rng):
        path = os.path.join(OUT, f"p{i+1:04d}.txt")
        if os.path.exists(path):
            continue
        try:
            t = r.pages[i].extract_text() or ""
        except Exception as e:
            t = f"<<extract error {e}>>"
        with open(path, "w") as f:
            f.write(t)
    return rng

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    n = len(PdfReader(PDF).pages)
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    step = 40
    rngs = [(s, min(s + step, n)) for s in range(0, n, step)]
    with Pool(workers) as p:
        for r in p.imap_unordered(work, rngs):
            print("done", r, flush=True)
    print("pages", n)
