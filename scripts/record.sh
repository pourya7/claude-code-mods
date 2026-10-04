#!/usr/bin/env bash
# Re-render the README demo GIFs with VHS. Needs vhs and a signed-in claude.
#   scripts/record.sh            every tape in demos/tapes
#   scripts/record.sh tripwire   only the named ones
set -uo pipefail
cd "$(dirname "$0")/.."
export MODS_ROOT="$PWD"
export DEMO_DIR="${DEMO_DIR:-/tmp/mods-demo/app}"
# Clocks on screen show UTC, never the local zone.
export TZ=UTC CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
max_bytes=$((5 * 1024 * 1024))

# Run each demo as a fresh top-level session, even when this script is
# started from inside another Claude Code session.
unset CLAUDECODE CLAUDE_PID CLAUDE_EFFORT CLAUDE_PLUGIN_DATA CLAUDE_PLUGIN_ROOT \
  CLAUDE_AGENT_SDK_VERSION CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SESSION_ID \
  CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_HOST_SESSION_ID CLAUDE_CODE_SESSION_ATTENDED \
  CLAUDE_CODE_MESSAGING_SOCKET CLAUDE_CODE_MESSAGING_TOKEN \
  CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH CLAUDE_CODE_DESKTOP_APP_VERSION \
  CLAUDE_CODE_ORGANIZATION_UUID CLAUDE_CODE_ACCOUNT_UUID CLAUDE_CODE_USER_EMAIL \
  CLAUDE_CODE_OAUTH_SCOPES

if [ "$#" -gt 0 ]; then names="$*"; else
  names=$(for f in demos/tapes/*.tape; do n=$(basename "$f" .tape); [ "$n" = common ] || echo "$n"; done)
fi

status=0
for name in $names; do
  tape="demos/tapes/$name.tape"
  gif="assets/$name.gif"
  if [ ! -f "$tape" ]; then echo "=== $name: no tape at $tape"; status=1; continue; fi
  echo "=== $name"
  demos/setup.sh "$DEMO_DIR" >/dev/null || { echo "setup failed"; status=1; continue; }
  if ! vhs "$tape"; then echo "vhs failed for $name"; status=1; continue; fi
  bytes=$(wc -c <"$gif" | tr -d ' ')
  echo "$gif: $((bytes / 1024)) KB"
  if [ "$bytes" -ge "$max_bytes" ]; then echo "$gif is 5 MB or more"; status=1; fi
done
[ "$status" -eq 0 ] && echo "ALL RECORDED" || echo "FAILED"
exit "$status"
