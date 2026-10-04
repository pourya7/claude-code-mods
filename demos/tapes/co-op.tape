# co-op: the feature branch's one commit flips applyDiscount's minus to a plus,
# so a discount raises the price. The model is asked to run gh pr create
# --fill; co-op diffs the branch against main with git, a real second model
# (sonnet, set through pluginConfigs) reviews it, the review fails with a high
# finding, and the create is denied with the findings. /coop view then opens
# the 2P REVIEW pane. The stand-in gh (demos/stubs/gh, scenario co-op-review)
# is first on PATH so a create that got through could never reach GitHub.
Output assets/co-op.gif
Source demos/tapes/common.tape
# Taller than the rest, so the reply, the band and the pane fit.
Set Height 800

Hide
Type "source $MODS_ROOT/demos/session.sh co-op && cd $DEMO_DIR-feature" Enter
# The stub gh first on PATH; `type gh` must name the stub. The log shows
# afterwards whether gh pr create was ever reached (it must not be).
Type `export PATH="$MODS_ROOT/demos/stubs:$PATH" && type gh` Enter
Type `export GH_STUB_SCENARIO=co-op-review GH_STUB_LOG="$(dirname "$DEMO_DIR")/co-op-gh.log" && : > "$GH_STUB_LOG"` Enter
# The planted bug, committed on the feature branch: + instead of -.
Type `perl -pi -e 's/\(1 - percent \/ 100\)/(1 + percent \/ 100)/' src/cart.js && git commit -qam "Tidy discount maths"` Enter
# A house rule: co-op's deny text invites a fix, which would run past the
# demo and into permission prompts. Untracked, so it is not in the diff.
Type `printf '%s\n' '# Rules' '- When a command is blocked by a hook, do not fix, edit or retry anything; reply with one sentence saying why, and run no tools.' > CLAUDE.md` Enter
Type "export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 MAX_THINKING_TOKENS=0 TZ=UTC GIT_PAGER=cat" Enter
Type "clear" Enter
Sleep 500ms
Show

# The branch to open a PR for.
Sleep 300ms
Type "git diff main" Enter
Sleep 3s

Hide
Type `clear && claude --effort low --settings '{"alwaysThinkingEnabled":false,"spinnerTipsEnabled":false,"pluginConfigs":{"co-op":{"options":{"model":"sonnet","timeoutSeconds":90}}}}' --allowedTools "Bash(gh pr create:*)" && clear` Enter
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

Sleep 500ms
Set TypingSpeed 25ms
Type `run gh pr create --fill. Run only this one command. If it is blocked, do not retry and run nothing else; just tell me why in one sentence.`
Sleep 300ms
Enter
# The review takes about 5 s (sonnet); then the deny and the reply.
Sleep 12s

# Open the pane with every finding, typed off camera.
Hide
Type "/coop view"
Sleep 800ms
Show
Sleep 600ms
Enter
Sleep 4s

Hide
Ctrl+C
Ctrl+C
