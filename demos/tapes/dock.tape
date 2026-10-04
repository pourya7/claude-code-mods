# dock: a stand-in docker (demos/stubs/docker) serves three compose stacks,
# one of them an orphan whose worktree is gone, on an 8 GiB engine with
# 1.8 GiB free. The model's `docker compose up -d` is turned into an ask by
# dock's low-headroom guard and declined; /dock then opens the pane.
# Nothing reaches the real docker.
Output assets/dock.gif
Source demos/tapes/common.tape
# Taller than the rest, so the pane and the guard's ask both fit.
Set Height 1080

Hide
Type "source $MODS_ROOT/demos/session.sh dock" Enter
# The stub docker first on PATH; `type docker` must name the stub.
Type `export PATH="$MODS_ROOT/demos/stubs:$PATH" && type docker` Enter
# The orphan's worktree must not exist: an old copy is moved aside.
Type `OLD="$(dirname "$DEMO_DIR")/app-old-feature"; if [ -e "$OLD" ]; then mv "$OLD" "$(mktemp -d)/"; fi` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC" Enter
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false}' --allowedTools "Bash(docker compose up:*)" && clear` Enter
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
Sleep 6s
Show

Sleep 1s
Set TypingSpeed 30ms
Type "run docker compose up -d. If it is blocked, run nothing else; just tell me why in one sentence."
Sleep 500ms
Enter
# dock reads docker, finds 1.8 GiB free, and turns the call into an ask.
Sleep 9s
# Decline the ask.
Escape
Sleep 2s
# Type the command off camera: a partial "/do" lists every installed
# command, including the recorder's own. The trailing space closes the menu.
Hide
Type "/dock "
Sleep 800ms
Show
Sleep 600ms
Enter
Sleep 5s

Hide
Ctrl+C
Ctrl+C
