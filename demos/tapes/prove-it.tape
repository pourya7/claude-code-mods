# prove-it: the feature worktree holds a fix and a new test; /prove reverts the
# fix, sees the test fail, puts the fix back, sees it pass, and shows PROVEN.
Output assets/prove-it.gif
Source demos/tapes/common.tape

Hide
Type "source $MODS_ROOT/demos/session.sh prove-it && cd $DEMO_DIR-feature" Enter
# The fix: clamp the discount to 0..100 percent.
Type `perl -0pi -e 's/  return Math.round\(cents \* \(1 - percent \/ 100\)\)/  const p = Math.min(100, Math.max(0, percent))\n  return Math.round(cents * (1 - p \/ 100))/' src/cart.js` Enter
# The new test, which fails without the fix (700 at 150% off is -350).
Type `printf "\ntest('applyDiscount caps the discount at 100%%', () => {\n  assert.strictEqual(applyDiscount(700, 150), 0)\n})\n" >> test/cart.test.js` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC GIT_PAGER=cat" Enter
Type "clear" Enter
Sleep 500ms
Show

# The change to prove: a fix and a new test.
Sleep 500ms
Type "git diff" Enter
Sleep 4s

Hide
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false,"pluginConfigs":{"prove-it":{"options":{"testCommand":"node --test"}}}}' && clear` Enter
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
# Type the command off camera: a partial "/pr" lists every installed
# command, including the recorder's own.
Hide
Type "/prove"
Sleep 800ms
Show
Sleep 600ms
Enter
Sleep 7s

Hide
Ctrl+C
Ctrl+C
