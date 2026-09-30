# SPDX-License-Identifier: AGPL-3.0-or-later
"""Runs the cobolwork bundled in this package with the Node.js found on PATH."""
import os
import shutil
import subprocess
import sys
from pathlib import Path


def main() -> None:
    node = shutil.which("node")
    if node is None:
        sys.exit("cobolwork needs Node.js 18 or later on PATH: https://nodejs.org")
    entry = Path(__file__).resolve().parent / "node" / "bin" / "cobolwork.mjs"
    argv = [node, str(entry), *sys.argv[1:]]
    if os.name == "nt":
        sys.exit(subprocess.call(argv))
    os.execv(node, argv)
