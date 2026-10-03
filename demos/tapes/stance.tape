# stance: a "no code, findings only" preamble switches to INVESTIGATE, and the edit the model then tries is refused.
Output assets/stance.gif
Source demos/tapes/common.tape

Hide
# Investigate lets edits through under the OS temp dirs, so this demo's project lives outside them.
Type `export DEMO_DIR=/Users/Shared/mods-demo/app && $MODS_ROOT/demos/setup.sh "$DEMO_DIR" >/dev/null` Enter
Type "source $MODS_ROOT/demos/session.sh stance" Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC" Enter
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false}' --permission-mode acceptEdits --disallowedTools Bash` Enter
Sleep 4s
Down
Enter
Sleep 4s
# Warm up off camera so one-off notices appear and expire before recording.
Type "reply with just: ok" Enter
Sleep 12s
Type "/clear" Enter
Sleep 2s
Show

Sleep 1s
Type "No code, findings only: review applyDiscount() in src/cart.js and save a one-line finding to NOTES.md."
Sleep 500ms
Enter
Sleep 13s
# The transcript view (ctrl+o) shows the refusal in full.
Ctrl+O
Sleep 4s

Hide
Ctrl+O
Ctrl+C
Ctrl+C
