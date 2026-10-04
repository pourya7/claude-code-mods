# quicksave: a short session sets a goal, a decision, a rule and a next step;
# the SAVE POINT band shows (warnAtPercent is set to 1, its minimum, through
# pluginConfigs, so a short session crosses it); /compact makes quicksave fork
# a save first, the compaction runs for real on Haiku, and the save comes back
# as the first message after it. A question after the compaction is answered
# from that save.
Output assets/quicksave.gif
Source demos/tapes/common.tape
# Taller than the rest, so the save note, the answer and the band fit.
Set Height 800

Hide
Type "source $MODS_ROOT/demos/session.sh quicksave" Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC" Enter
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false,"pluginConfigs":{"quicksave":{"options":{"warnAtPercent":1}}}}' && clear` Enter
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
# The session state worth saving, set off camera to keep the demo short. It
# stays in the transcript, so the first frame shows it.
Type "Goal: add free shipping to the cart for orders over 5000 cents. Decision: keep all prices in integer cents. Rule: never edit test/ without asking me first. Next: add a shippingCents(total) helper to src/cart.js. Reply with just: ok"
Enter
Sleep 12s
Ctrl+L
Sleep 3s
Show

# The band: idle and past the threshold.
Sleep 3s
# Type the command off camera: a partial "/co" lists every installed command,
# including the recorder's own.
Hide
Type "/compact"
Sleep 800ms
Show
Sleep 600ms
Enter
# quicksave forks the save, then Haiku compacts (about 12 s).
Sleep 16s

Set TypingSpeed 30ms
Type "what's our goal, our rule, and the next step? one line each"
Sleep 400ms
Enter
Sleep 7s

Hide
Ctrl+C
Ctrl+C
