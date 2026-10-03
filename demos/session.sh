# Sourced off camera by each tape: a neutral prompt, the sample project as cwd,
# and a `claude` that loads only the named mods on a cheap model.
#   source demos/session.sh <mod>...
export PS1='$ '
export DEMO_MODS="$*"
cd "${DEMO_DIR:-/tmp/mods-demo/app}"
claude() {
  local plugins=() mod
  for mod in $DEMO_MODS; do plugins+=(--plugin-dir "$MODS_ROOT/$mod"); done
  command claude --model haiku \
    --setting-sources project,local --strict-mcp-config \
    "${plugins[@]}" "$@"
}
clear
