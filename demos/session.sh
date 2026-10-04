# Sourced off camera by each tape: a neutral prompt, the sample project as cwd,
# and a `claude` that loads only the named mods on a cheap model.
#   source demos/session.sh <mod>...
export PS1='$ '
export DEMO_MODS="$*"
# Keep the recorder's own auto memory out of demo sessions: it is private, and
# it would steer the model instead of the mod being shown.
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
# Demos never reach the real gh or docker. The stand-ins in demos/stubs go
# first on PATH, and again before every Bash tool command (CLAUDE_ENV_FILE):
# the Bash tool runs a login shell, which would put the real tools back in
# front. Any real gh that still ran would find no account.
export PATH="$MODS_ROOT/demos/stubs:$PATH"
demo_env="$(dirname "${DEMO_DIR:-/tmp/mods-demo/app}")/demo-env.sh"
printf 'export PATH=%q:"$PATH"\n' "$MODS_ROOT/demos/stubs" > "$demo_env"
export CLAUDE_ENV_FILE="$demo_env"
export GH_CONFIG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mods-demo-gh.XXXXXX")"
unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN
cd "${DEMO_DIR:-/tmp/mods-demo/app}"
claude() {
  local plugins=() mod
  for mod in $DEMO_MODS; do plugins+=(--plugin-dir "$MODS_ROOT/$mod"); done
  command claude --model haiku \
    --setting-sources project,local --strict-mcp-config \
    "${plugins[@]}" "$@"
}
clear
