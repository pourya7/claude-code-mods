# anchor: a session in a linked worktree is pinned there, and a git write aimed at the primary checkout is denied.
Output assets/anchor.gif
Source demos/tapes/common.tape

Hide
# A fixed project path, since the prompt below names the primary checkout.
Type `export DEMO_DIR=/tmp/mods-demo-anchor/app && $MODS_ROOT/demos/setup.sh "$DEMO_DIR" >/dev/null` Enter
Type "source $MODS_ROOT/demos/session.sh anchor" Enter
# Start in the linked worktree, so the primary checkout is guarded.
Type `cd "$DEMO_DIR-feature" && clear` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC" Enter
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false}' --allowedTools "Bash(git:*)" "Bash(cd:*)" "Bash(pwd)" && clear` Enter
Sleep 4s
# Trust the folder.
Down
Enter
Sleep 4s
# Warm up off camera so one-off account notices show and expire, then rewind it away.
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

Sleep 1.5s
Set TypingSpeed 30ms
Type "Run only this one command: git -C /private/tmp/mods-demo-anchor/app commit --allow-empty -m wip. If it is blocked, do not retry and run nothing else; just tell me why in one sentence."
Sleep 500ms
Enter
Sleep 14s

Hide
Ctrl+C
Ctrl+C
