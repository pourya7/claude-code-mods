#!/usr/bin/env bash
# Make a fresh copy of the sample project for a demo: a git repo with one
# commit by a neutral demo user, plus a linked worktree next to it.
#   demos/setup.sh [dir]   (default: /tmp/mods-demo/app)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:-/tmp/mods-demo/app}"
# A copy left by an earlier run is moved aside to a fresh temp folder, not deleted.
for old in "$dir" "$dir-feature"; do
  if [ -e "$old" ]; then mv "$old" "$(mktemp -d "${TMPDIR:-/tmp}/mods-demo-old.XXXXXX")/"; fi
done
mkdir -p "$dir"
cp -R "$here/project/." "$dir"
cd "$dir"
export GIT_AUTHOR_NAME=Demo GIT_AUTHOR_EMAIL=demo@example.com
export GIT_COMMITTER_NAME=Demo GIT_COMMITTER_EMAIL=demo@example.com
git init -q -b main
git config user.name Demo
git config user.email demo@example.com
git add -A
git commit -q -m "Add cart with tests"
git worktree add -q -b feature "$dir-feature"
echo "$dir"
