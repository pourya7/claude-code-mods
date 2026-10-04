# radar: a git diff pings a memory about discarding dirty files, and the
# model backs the file up before it runs git checkout --.
Output assets/radar.gif
Source demos/tapes/common.tape

Hide
Type "source $MODS_ROOT/demos/session.sh radar" Enter
# Stand-in memory files (neutral lessons), copied next to the app so every
# path radar shows stays under the temp dir. An old copy is moved aside.
Type `MEM="$(dirname "$DEMO_DIR")/memory"; if [ -e "$MEM" ]; then mv "$MEM" "$(mktemp -d)/"; fi; command cp -R "$MODS_ROOT/demos/fixtures/memory" "$MEM"` Enter
Type `RADAR_SETTINGS="{\"alwaysThinkingEnabled\":false,\"spinnerTipsEnabled\":false,\"pluginConfigs\":{\"radar\":{\"options\":{\"memoryDirs\":\"$MEM\"}}}}"` Enter
# An uncommitted change to discard.
Type `printf '\n// Free shipping from 50 dollars.\nconst FREE_SHIPPING = 5000\n' >> src/cart.js` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC GIT_PAGER=cat" Enter
Type `clear && claude --effort low --settings "$RADAR_SETTINGS" --allowedTools "Bash(git:*)" "Bash(cp:*)" && clear` Enter
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
Type "run git diff src/cart.js, then discard that change."
Sleep 500ms
Enter
Sleep 12s
# Type the command off camera: a partial "/ra" lists every installed
# command, including the recorder's own.
Hide
Type "/radar"
Sleep 800ms
Show
Sleep 600ms
Enter
Sleep 4s

Hide
Ctrl+C
Ctrl+C
