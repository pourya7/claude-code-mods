#!/usr/bin/env bash
# Validate and test every mod in the marketplace. Exits non-zero on any failure.
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
mods=$(for f in */.claude-plugin/plugin.json; do [ -e "$f" ] && dirname "$(dirname "$f")"; done)
if [ -z "$mods" ]; then echo "no mods found"; exit 0; fi
for mod in $mods; do
  echo "=== $mod: validate"
  claude plugin validate "$mod" || status=1
  if [ -d "$mod/tests" ]; then
    echo "=== $mod: test"
    claude plugin test "$mod" || status=1
  fi
done
[ "$status" -eq 0 ] && echo "ALL CLEAR" || echo "FAILED"
exit "$status"
