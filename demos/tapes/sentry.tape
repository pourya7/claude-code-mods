# sentry: a stand-in gh (demos/stubs/gh) serves PR #12 in demo/cart, whose
# "test (node 24)" check is running and then fails a few seconds later.
# /watch 12 starts the watch, a sleep-poll the model is asked to run is
# denied, and the next poll wakes the session with the failure.
# Nothing reaches the real gh or GitHub.
Output assets/sentry.gif
Source demos/tapes/common.tape

Hide
Type "source $MODS_ROOT/demos/session.sh sentry && cd $DEMO_DIR-feature" Enter
# The stub gh first on PATH; `type gh` must name the stub.
Type `export PATH="$MODS_ROOT/demos/stubs:$PATH" && type gh` Enter
# The scenario; its clock starts at the first gh call (/watch 12). The log is
# for checking a render's poll timing afterwards.
Type `export GH_STUB_SCENARIO=sentry-ci-fails GH_STUB_CLOCK="$(mktemp -d)/clock" GH_STUB_LOG="$(dirname "$DEMO_DIR")/sentry-gh.log" && : > "$GH_STUB_LOG"` Enter
# The PR's change, which breaks a test, and a fake origin that is never fetched.
Type `perl -pi -e 's#Math.round\(cents \* \(1 - percent / 100\)\)#Math.round(cents * percent / 100)#' src/cart.js && git commit -qam "Simplify applyDiscount" && git remote add origin https://github.com/demo/cart.git` Enter
# House rules that keep the reaction short and local: no commit, no push.
Type `printf '%s\n' '# Rules' '- When CI fails: run gh pr checks <pr>, then gh run view --log-failed --job <id> (the id ends the failed check link), fix the cause in src/cart.js, run npm test once, reply in one sentence.' '- Never commit or push.' > CLAUDE.md` Enter
# No auto memory: the recorder's own memory files must not reach the model.
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 MAX_THINKING_TOKENS=0 TZ=UTC GIT_PAGER=cat" Enter
# Poll every 15 s, the shortest sentry allows.
Type `SENTRY_SETTINGS='{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false,"autoMemoryEnabled":false,"pluginConfigs":{"sentry":{"options":{"intervalSeconds":15}}}}'` Enter
Type `clear && date +%s > "$(dirname "$DEMO_DIR")/sentry-launch" && claude --effort low --settings "$SENTRY_SETTINGS" --permission-mode acceptEdits --allowedTools "Bash(gh:*)" "Bash(sleep:*)" "Bash(npm test:*)" "mcp__sentry__pr_state" --disallowedTools "Bash(git commit:*)" "Bash(git push:*)" && clear` Enter
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
# sentry polls every 15 s from session start; this wait puts /watch 12 about
# 11 s before a poll, so the deny lands first and the wake right after it.
Sleep 17500ms
# Type the command off camera: a partial slash command lists every installed
# command, including the recorder's own.
Type "/watch 12"
Sleep 800ms
Show
Sleep 600ms
Enter
Sleep 2s

Set TypingSpeed 30ms
Type "run sleep 30 && gh pr checks 12. If it is blocked, run nothing else; just tell me why in one sentence."
Sleep 500ms
Enter
# The deny, then sentry's next poll sees the failure and wakes the session,
# and the model reads the CI log and fixes the bug.
Sleep 23s

Hide
Ctrl+C
Ctrl+C
