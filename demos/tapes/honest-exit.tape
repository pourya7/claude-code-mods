# honest-exit: a failing suite piped into tail exits 0, and the hidden failure is caught.
Output assets/honest-exit.gif
Source demos/tapes/common.tape

Hide
Type "source $MODS_ROOT/demos/session.sh honest-exit" Enter
# Break the cart off camera: total() calls a misspelled function.
Type `sed -i '' 's/return applyDiscount(subtotal/return applyDiscnt(subtotal/' src/cart.js` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC" Enter
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false}' --allowedTools "Bash(npm test:*)" "Bash(tail:*)" && clear` Enter
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
Type "run npm test 2>&1 | tail -10 and tell me in one line whether the tests passed, then quote the honest-exit note you got"
Sleep 500ms
Enter
Sleep 10s

Hide
Ctrl+C
Ctrl+C
