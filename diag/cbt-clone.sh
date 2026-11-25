#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Shallow-clones the CBT Tape mirror's repositories for diag/cbt-screen.mjs to screen.
#   sh diag/cbt-clone.sh <dest-dir> [<list>]
# The list holds a repository name a line, with an optional commit after it to fetch that commit
# instead of the default branch's head; it defaults to diag/cbt-repos.tsv, the commits measured.
# A repository already cloned is skipped, so a failed run can be repeated.
dest=$1
list=${2:-$(dirname "$0")/cbt-repos.tsv}
[ -n "$dest" ] && [ -r "$list" ] || { echo "usage: cbt-clone.sh <dest-dir> [<list>]" >&2; exit 2; }
mkdir -p "$dest"
failed=0
while read -r name commit; do
  [ -n "$name" ] || continue
  [ -d "$dest/$name/.git" ] && continue
  url="https://github.com/CBTTape/$name"
  if [ -n "$commit" ]; then
    git init --quiet "$dest/$name" && git -C "$dest/$name" fetch --depth 1 --quiet "$url" "$commit" && git -C "$dest/$name" checkout --quiet FETCH_HEAD
  else
    git clone --depth 1 --quiet "$url" "$dest/$name"
  fi
  if [ $? -eq 0 ]; then echo "$name ok"; else echo "$name FAIL"; failed=1; rm -rf "$dest/$name"; fi
done < "$list"
exit $failed
