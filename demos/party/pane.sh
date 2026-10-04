#!/usr/bin/env bash
# One party demo session: a tmux pane runs this with the folder it works in.
#   demos/party/pane.sh <dir>
# The environment (stub gh on PATH, the demo's own plugin store) comes from
# demos/party/start.sh through the tmux server.
source "$MODS_ROOT/demos/session.sh" party
cd "$1" || exit 1
clear
# nagMinutes 1 (the lowest the option takes) so a wait turns red within a minute.
# gh and sleep are allowed, so the only prompt a session can meet is party's lock.
claude --effort low \
  --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false,"pluginConfigs":{"party":{"options":{"nagMinutes":1,"lockMinutes":10}}}}' \
  --allowedTools "Bash(gh:*)" "Bash(sleep:*)"
