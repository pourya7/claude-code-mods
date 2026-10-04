#!/usr/bin/env bash
# party demo: three real Claude Code sessions with party loaded, side by side
# in tmux, so the raid frame has a real party to show. Run off camera by
# demos/tapes/party.tape (MODS_ROOT and DEMO_DIR set by scripts/record.sh,
# after demos/setup.sh made $DEMO_DIR and $DEMO_DIR-feature).
#
#   left         $DEMO_DIR          main     1UP: opens /party, idle
#   top right    $DEMO_DIR-feature  feature  2P: tries to merge PR #12
#   bottom right $DEMO_DIR-review   review   3P: commented on PR #12, now busy
#
# Nothing is seeded: each row in the pane is a session's own heartbeat.
#
# Isolation. party's store is one JSON file per plugin id, and every
# --plugin-dir copy of party has the same id (party@inline), so these
# sessions would share a store with any party session the recorder runs.
# CLAUDE_CODE_PLUGIN_CACHE_DIR moves Claude Code's plugin folder (and with it
# the store) to a fresh folder next to the demo copies, so only these three
# sessions ever meet. gh is the fixture stub (scenario party-lock), so no
# call can reach GitHub.
#
# The background driver below types into the two side panes (trust dialog,
# an off-camera warm-up that is rewound away, then the task) and warms up the
# main pane; the tape only types /party. Ctrl+Q (bound in tmux.conf) ends
# the whole tmux server and every session in it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${MODS_ROOT:?}" "${DEMO_DIR:?}"
base="$(dirname "$DEMO_DIR")"
review="$DEMO_DIR-review"
plugins="$base/party-plugins"
sock=party-demo

aside() { if [ -e "$1" ]; then mv "$1" "$(mktemp -d "${TMPDIR:-/tmp}/mods-demo-old.XXXXXX")/"; fi; }
tmux -L "$sock" kill-server 2>/dev/null || true
aside "$review"
aside "$plugins"
mkdir -p "$plugins"
git -C "$DEMO_DIR" worktree add -q -b review "$review"

export PATH="$MODS_ROOT/demos/stubs:$PATH"
# The Bash tool runs a login shell, and macOS's path_helper puts the real gh
# (/opt/homebrew/bin) back in front of the stub. CLAUDE_ENV_FILE is sourced
# before every Bash command, after that, so the stub wins there too. And gh
# gets an empty config folder: should anything still reach the real gh, it
# is signed out and cannot act as the recorder.
envfile="$base/party-env.sh"
printf 'export PATH=%q:"$PATH"\n' "$MODS_ROOT/demos/stubs" > "$envfile"
export CLAUDE_ENV_FILE="$envfile"
aside "$base/party-gh-config"
mkdir -p "$base/party-gh-config"
export GH_CONFIG_DIR="$base/party-gh-config"
unset GH_TOKEN GITHUB_TOKEN
export GH_STUB_SCENARIO=party-lock GH_STUB_LOG="$base/party-gh.log"
: > "$GH_STUB_LOG"
export CLAUDE_CODE_PLUGIN_CACHE_DIR="$plugins"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC GIT_PAGER=cat

pane="bash --noprofile --norc $here/pane.sh"
tmux -L "$sock" -f "$here/tmux.conf" new-session -d -s party -x "${PARTY_COLS:-140}" -y "${PARTY_ROWS:-36}" \
  -c "$DEMO_DIR" "$pane $DEMO_DIR"
tmux -L "$sock" split-window -h -l 44% -t party:0.0 -c "$DEMO_DIR-feature" "$pane $DEMO_DIR-feature"
tmux -L "$sock" split-window -v -t party:0.1 -c "$review" "$pane $review"
tmux -L "$sock" select-pane -t party:0.0 -T "app · main"
tmux -L "$sock" select-pane -t party:0.1 -T "app-feature · feature"
tmux -L "$sock" select-pane -t party:0.2 -T "app-review · review"
tmux -L "$sock" select-pane -t party:0.0

drive() {
  local t="$sock" one
  keys() { tmux -L "$t" send-keys -t "party:0.$1" "${@:2}"; }
  text() { tmux -L "$t" send-keys -t "party:0.$1" -l "$2"; }
  # A prompt whose first line is the session's title in party, then the
  # warm-up itself on a second line (backslash-Enter is a newline).
  warm() { text "$1" "$2\\"; keys "$1" Enter; text "$1" "Not yet: use no tools, reply with just: ok"; keys "$1" Enter; }
  rewind() {
    keys "$1" Escape; sleep 0.3; keys "$1" Escape; sleep 1
    keys "$1" Up; sleep 0.3; keys "$1" Enter; sleep 2; keys "$1" Enter; sleep 2
    # The rewound prompt comes back into the input, two lines: clear both.
    keys "$1" C-u; sleep 0.3; keys "$1" BSpace; sleep 0.3; keys "$1" C-u; sleep 0.5; keys "$1" C-l
  }
  echo "driver: start $(date +%s)"
  sleep 5
  for one in 0 1 2; do keys "$one" Down; keys "$one" Enter; done
  sleep 5
  warm 0 "fix the cart rounding"
  warm 1 "merge the free-shipping PR"
  warm 2 "reply to the review on PR 12"
  sleep 16
  for one in 0 1 2; do rewind "$one" & done
  wait
  sleep 3
  text 2 'Run exactly: gh pr comment 12 -R demo/cart --body "Rounding fixed, re-review please." Then run exactly: sleep 110, in the foreground. Nothing else.'
  keys 2 Enter
  sleep 12
  text 1 'Run exactly: gh pr merge 12 -R demo/cart --squash. Run only this one command. If it is blocked, do not retry.'
  keys 1 Enter
  echo "driver: merge asked $(date +%s)"
  echo "driver: done $(date +%s)"
}
drive >"$base/party-driver.log" 2>&1 &
disown
# PARTY_ATTACH=0 leaves it detached (for checking it with tmux capture-pane).
if [ "${PARTY_ATTACH:-1}" = 0 ]; then exit 0; fi
exec tmux -L "$sock" attach -t party
