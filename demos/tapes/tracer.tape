# tracer: a stand-in gh (demos/stubs/gh) serves PR #12 in demo/cart, already
# merged. Its merge commit's workflow runs are still going when /trace 12
# starts, pass by tracer's next poll while a production deployment is in
# progress, and the deployment succeeds by the poll after that, which wakes
# the session once. No live URL is set, so the chain ends at DEPLOY.
# Nothing reaches the real gh or GitHub.
Output assets/tracer.gif
Source demos/tapes/common.tape
# Taller than the rest, so the reply, the pane's level map and the wake fit.
Set Height 1080

Hide
Type "source $MODS_ROOT/demos/session.sh tracer"
Enter
# The stub gh first on PATH; `type gh` must name the stub.
Type `export PATH="$MODS_ROOT/demos/stubs:$PATH" && type gh` Enter
# The scenario; its clock starts at tracer's first poll (/trace 12). The log
# is for checking a render's poll timing afterwards.
Type `export GH_STUB_SCENARIO=tracer-deploy GH_STUB_CLOCK="$(mktemp -d)/clock" GH_STUB_LOG="$(dirname "$DEMO_DIR")/tracer-gh.log" && : > "$GH_STUB_LOG"` Enter
# A house rule that keeps the reaction to the wake line short and local.
Type `printf '%s\n' '# Rules' '- When a TRACER line arrives, reply with one short sentence saying what shipped, and run no tools.' > CLAUDE.md` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 MAX_THINKING_TOKENS=0 TZ=UTC GIT_PAGER=cat" Enter
# Poll every 15 s (the shortest tracer allows) and wait for production.
Type `TRACER_SETTINGS='{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false,"autoMemoryEnabled":false,"pluginConfigs":{"tracer":{"options":{"intervalSeconds":15,"environments":"production"}}}}'` Enter
Type `clear && date +%s > "$(dirname "$DEMO_DIR")/tracer-launch" && claude --effort low --settings "$TRACER_SETTINGS" && clear` Enter
Sleep 4s
# Trust the folder.
Down
Enter
Sleep 4s
# Warm up off camera so one-off account notices show and expire before
# recording, then rewind the warm-up away.
Type "reply with just: ok" Enter
Sleep 15s
Escape
Sleep 300ms
Escape
Sleep 1s
Up
Sleep 300ms
Enter
Sleep 2s
Enter
Sleep 2s
Ctrl+U
Sleep 500ms
Ctrl+L
# tracer polls every 15 s from session start; this wait puts /trace 12 about
# 7 s before a poll (7.0 s and 22.0 s in GH_STUB_LOG on two renders), so the
# pane shows BUILD running first, then the deploy in progress, then the wake.
Sleep 6s
# Type the command off camera: a partial slash command lists every installed
# command, including the recorder's own.
Type "/trace 12"
Sleep 800ms
Show
Sleep 600ms
Enter
Sleep 2500ms
# Open the pane, again typed off camera. The trailing space closes the menu.
Hide
Type "/trace "
Sleep 800ms
Show
Sleep 600ms
Enter
# The next poll passes BUILD; the one after it finishes the deploy, toasts
# and wakes the session once, and the model answers the wake line.
Sleep 24s

Hide
Ctrl+C
Ctrl+C
