# tripwire: a project rule denies `git commit --no-verify`, and the model is told why.
Output assets/tripwire.gif
Source demos/tapes/common.tape

Hide
Type "source $MODS_ROOT/demos/session.sh tripwire" Enter
# The project's rule file, and no spinner tips.
Type `mkdir -p .claude && printf '%s' '{"rules":[{"id":"no-verify","tool":"Bash","match":"\\bgit\\s+commit\\b.*--no-verify","field":"command","action":"deny","message":"Hooks exist for a reason: fix the failure instead of skipping it.","cite":"team rules"}]}' > .claude/tripwire.json && printf '%s' '{"spinnerTipsEnabled":false}' > .claude/settings.local.json` Enter
# A small staged change to commit.
Type `printf '\n// Free shipping from 50 dollars.\nconst FREE_SHIPPING = 5000\n' >> src/cart.js && git add src/cart.js` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 TZ=UTC" Enter
Type `clear && claude --allowedTools "Bash(git:*)" && clear` Enter
Sleep 4s
# Trust the folder.
Down
Enter
Sleep 4s
# Warm up off camera so one-off account notices show and expire before
# recording, then rewind the warm-up away (/clear would drop the rules).
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
Type `run git commit --no-verify -m "Add free shipping" (the hook is slow). If it is blocked, run nothing else; just tell me why.`
Sleep 500ms
Enter
Sleep 18s

Hide
Ctrl+C
Ctrl+C
