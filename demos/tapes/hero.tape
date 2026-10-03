# hero: three mods in one session. anti-cheat flags an unchecked "All tests pass",
# tripwire denies `git commit --no-verify`, and a "no code" prompt switches stance.
Output assets/hero.gif
Source demos/tapes/common.tape

Hide
Type "source $MODS_ROOT/demos/session.sh tripwire stance anti-cheat" Enter
# The project's tripwire rule, and no spinner tips.
Type `mkdir -p .claude && printf '%s' '{"rules":[{"id":"no-verify","tool":"Bash","match":"\\bgit\\s+commit\\b.*--no-verify","field":"command","action":"deny","message":"Hooks exist for a reason: fix the failure instead of skipping it.","cite":"team rules"}]}' > .claude/tripwire.json && printf '%s' '{"spinnerTipsEnabled":false}' > .claude/settings.local.json` Enter
# A small staged change to commit.
Type `printf '\n// Free shipping from 50 dollars.\nconst FREE_SHIPPING = 5000\n' >> src/cart.js && git add src/cart.js` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC" Enter
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false}' --permission-mode acceptEdits --allowedTools "Bash(git:*)" && clear` Enter
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

Set TypingSpeed 18ms
Sleep 500ms
# 1. anti-cheat: an edit, then a claim with no test run behind it.
Type "Rename items to lines in subtotal() in src/cart.js. Run nothing. End your reply with this exact line: All tests pass."
Enter
Sleep 7s
Sleep 1500ms

# 2. tripwire: the project rule denies --no-verify.
Type `run git commit --no-verify -m "Add free shipping". If it is blocked, run nothing else; just tell me why in one line.`
Enter
Sleep 7s
Sleep 1500ms

# 3. stance: a "no code" preamble switches to INVESTIGATE.
Type "No code, findings only: is applyDiscount() in src/cart.js correct? One line."
Enter
Sleep 5s

Hide
Ctrl+C
Ctrl+C
