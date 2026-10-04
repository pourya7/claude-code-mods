# Spec: claude-code-mods

## Objective

A public library of [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview), published as a plugin marketplace, that fix the problems a product engineer actually has when Claude Code runs long, parallel, mostly unattended work. Most of the 1,000+ published mods are dashboards, games, or generic guards. These mods are different: each one is mined from a study of the author's own 242 Claude Code sessions, 1,145 subagent runs, and 279 memory files.

**Thesis: memories are advice, mods are law.** A rule written in `CLAUDE.md` or memory is something the model may forget. A mod enforces it at the moment of the tool call.

**Users:** developers who run Claude Code for long stretches, often several sessions in parallel, across git worktrees, with CI and PR review loops, and who keep correcting the same mistakes.

**Success:** someone can run `/plugin marketplace add pourya7/claude-code-mods`, install any one mod, and immediately get a guardrail or a removed chore. Each mod passes `claude plugin validate` and `claude plugin test`, and looks like part of one pixel-art family.

### Evidence (aggregate numbers)

| Pain | Evidence | Mod |
|---|---|---|
| Shell leaves the worktree | 27k of 78.6k Bash calls start with `cd`; 1,859 "shell cwd was reset" notices | anchor |
| Prose rules don't hold | 405 never/don't lines across 189 memory files; ≥11 mistakes repeated *after* being written down | tripwire |
| The model does the waiting | ~1.8k poll loops, ~1.5k `sleep`s, ~1.2k CI-status calls; false-green right after a push | sentry |
| Modes typed as preambles | "no code, no commit, no PR" in 44 sessions | stance |
| Claims without evidence | "tests pass" / "CI green" after edits with no re-run; 23% of memories are verification traps | anti-cheat |
| Dropped connections | ~120 API connection errors; "continue" / "try again" typed by hand | respawn |
| The right memory isn't salient at the moment it matters | ≥11 mistakes recurred after being written down; ~2.7k tokens of memory index loaded into every session regardless of relevance | radar |
| Compaction loses the plot | 91 compactions; summaries rewritten by hand; "is now a safe time to compact?" asked repeatedly | quicksave |
| Parallel sessions block on you and collide | up to 5–10 sessions at once; ~190 h of sessions waiting on a human answer; two sessions acted on the same PR | party |
| Checks that pass without checking | 64 memory notes are verification traps: zero-iteration gates, no-op "proofs", tests that pass with the fix removed | prove-it |
| One agent's word isn't enough | ~1,600 second-model review runs typed or scripted by hand before PRs | co-op |
| The shell lies quietly | 186 zsh "no matches found" (the command never ran); exit codes hidden by pipes; `exit=$?` echoed ~1,000× | honest-exit |
| Local stacks eat the laptop | 10 parallel container stacks crashed a machine; orphaned stacks from deleted worktrees | dock |
| Merged ≠ deployed | "merged but I still can't see it" in 34 prompts across 14 sessions | tracer |
| MCP calls fail on argument shapes | ~65 schema errors (unknown keys, `"true"` for `true`, numbers as strings) | mender |

## Capability map

Each mod is an independent plugin: no mod imports another, and each folder installs alone. Every mod relies only on the marketplace scaffold.

| Module id | Responsibility | Signature colour |
|---|---|---|
| `marketplace` | Root `.claude-plugin/marketplace.json`, README, LICENSE, tsconfig, `scripts/check.sh`, shared visual style guide (this spec) | — |
| `anchor` | Pin a session to its git worktree | blue |
| `tripwire` | Turn written rules into enforced deny/ask/rewrite/note checks on tool calls | red |
| `sentry` | Watch PRs outside the model and wake the session only when something actionable happens | yellow |
| `stance` | Session modes (investigate / draft / build / ship) that are enforced, not just requested | pink |
| `anti-cheat` | Check "tests pass / CI green / verified" claims at turn end against what actually ran | lime |
| `respawn` | Auto-continue after a turn dies on a network or API error | orange |
| `radar` | Surface the relevant memory at the tool call that needs it | lavender |
| `quicksave` | Save task state before compaction, restore it after | green |
| `party` | One view of every live session on the machine; who is blocked on you; per-PR locks | pink |
| `prove-it` | A new test must fail with the fix reverted before push / PR | red |
| `co-op` | Second-model review gate on PR creation | blue |
| `honest-exit` | Make silent shell failures loud | peach |
| `dock` | Container stacks per worktree: memory headroom, orphans, guarded boot | navy + blue |
| `tracer` | Follow a merged commit until it is deployed (and optionally live) | yellow |
| `mender` | Fix malformed MCP arguments against the tool's own schema | brown + orange |
| `demos` | Recorded README demos: a shared sample project, one VHS tape per mod, GIFs in `assets/`, `scripts/record.sh` | — |

## Tech stack

- Claude Code **2.1.288** mods API (function hooks). The authority is the engine's own declaration file `claude-code.d.ts` (`/plugin-types types` writes it; it is git-ignored, not redistributed).
- TypeScript/TSX hooks modules. No runtime dependencies, no npm packages, no Node APIs; everything outside the module goes through `$`.
- Tests use the engine's test kit: `import { describe, expect, mock, test } from 'claude-code/testing'`, run by `claude plugin test`.

## Commands

```bash
claude plugin validate <mod>          # manifest + module checks, lists hooks and calls
claude plugin test <mod>              # runs <mod>/tests/**/*.test.ts against the engine
scripts/check.sh                      # validate + test every mod; non-zero on any failure
claude --plugin-dir <mod>             # load one mod from source for a session
/plugin marketplace add pourya7/claude-code-mods   # users: add the marketplace
/plugin install anchor@claude-code-mods            # users: install one mod
```

## Project structure

```
.claude-plugin/marketplace.json   → marketplace "claude-code-mods" listing every mod
<mod>/.claude-plugin/plugin.json  → name, version 0.1.0, description, userConfig, types
<mod>/hooks/hooks.json            → { "modules": ["./register.tsx"] }
<mod>/hooks/register.tsx          → register(on, options): the mod
<mod>/hooks/*.ts                  → pure helpers (parsing, matching), unit-testable
<mod>/types/index.d.ts            → PluginState contract (only if the mod uses $.state)
<mod>/tests/*.test.ts             → claude plugin test suites
<mod>/README.md                   → what/why (one evidence line), install, commands, config, pixel-art preview, permissions table
scripts/check.sh                  → CI-style check over all mods
scripts/record.sh                 → re-render every demo GIF (or the ones named)
demos/project/                    → the sample app every demo copies
demos/setup.sh                    → copies the sample app to a neutral temp path and makes it a git repo with a worktree
demos/tapes/<mod>.tape            → one VHS tape per mod, plus hero.tape
demos/tapes/common.tape           → shared VHS settings: theme, font, size
assets/<mod>.gif, assets/hero.gif → rendered demos, each under 5 MB
tsconfig.json                     → editor/tsc config (jsxFactory h), includes types/ and */hooks, */tests
types/                            → git-ignored engine declarations from /plugin-types
```

## Visual style guide (shared by every mod)

In any text (READMEs, descriptions, keywords, comments, test names), call the look "pixel art" or nothing at all; the art speaks for itself.

The mods should look like one arcade family.

- **Palette: PICO-8.** Use these 16 hex colours only:
  - black `#000000`, navy `#1D2B53`, plum `#7E2553`, green `#008751`
  - brown `#AB5236`, dark grey `#5F574F`, light grey `#C2C3C7`, white `#FFF1E8`
  - red `#FF004D`, orange `#FFA300`, yellow `#FFEC27`, lime `#00E436`
  - blue `#29ADFF`, lavender `#83769C`, pink `#FF77A8`, peach `#FFCCAA`
  - Each mod has a signature colour, listed in the capability map.
- **Pixels: half-block sprites.** Draw with `▀` using Text `color` for the top pixel and `backgroundColor` for the bottom one, so one terminal row holds two pixel rows. Sprites are defined as string grids, where each character is a palette key and `.` is transparent. A tiny renderer turns a grid into `Text` runs. Each mod copies its own renderer; there is no shared runtime code.
- **Typography.** Labels are UPPERCASE arcade style, such as `INSERT COIN`, `1UP`, `READY!`, `GAME OVER`, `CONTINUE? 9`.
  - Use single-width characters only (block elements `█▀▄▌▐░▒▓`, box drawing, `♥ ★ ● ◆ ▶`). No emoji: they are double-width and break terminal alignment.
- **Every surface.**
  - Draw with `$.ui.resolve(e)` elements, so the same tree works on the terminal and the Desktop app.
  - Check the element table before using any element.
  - Never rely on `Raster` or `Image` (terminal-only).
  - Where nothing draws (`claude -p`, VS Code), fall back to command text replies and `$.ui.toast` or `$.ui.status`.
- **Never block or nag.** Bands appear only when they have something to say. Status-line text stays under ~40 columns.

## Module specs

### anchor — pin the session to its worktree

- **Anchor setting.**
  - On `session.start`, anchor to the session's cwd and record it in `$.state`.
  - If the cwd is a linked git worktree, also record the primary checkout. Find it with `git rev-parse --git-common-dir` via `$.process.run`; its parent directory is the primary checkout.
  - `/anchor` shows the anchor. `/anchor <path>` re-anchors. `/anchor off` disables.
- **Bash rewrite.** Every Bash call, including subagents' calls, is rewritten to `cd '<anchor>' && <command>`, unless it already starts with that exact prefix. Single quotes in the path are escaped.
- **Primary-checkout guard.** Only when the anchor is a linked worktree, and `userConfig.protectPrimary` is on (default true):
  - Deny `Edit`, `Write` and `NotebookEdit` targets inside the primary checkout but outside the anchor.
  - Deny Bash commands that run git write verbs (`commit`, `checkout`, `switch`, `reset`, `stash`, `merge`, `rebase`, `push`, `branch -D`, `restore`) against the primary path, via `cd <primary>` or `git -C <primary>`.
  - The deny text names the anchor and how to override (`/anchor off`).
- **UI.**
  - Status line: a single-width glyph plus the worktree name and branch, e.g. `╋ ANCHOR fix-login@fix/login` (no `⚓`, which renders as an emoji in many terminals).
  - Toast on each deny.
  - `/anchor` replies with a small pixel anchor sprite and the paths.
- **Acceptance.**
  - Rewrite happens exactly once per command (idempotent).
  - Paths with spaces and quotes survive.
  - Off means a pure pass-through.
  - Edits inside the anchor are never denied, even when the anchor is nested under the primary checkout (e.g. `.worktrees/x`).

### tripwire — rules that are enforced, not remembered

- **Rule files.** Rules load from `~/.claude/tripwire.json` (user) and `<project>/.claude/tripwire.json` (project). They load on `session.start` and again on `/tripwire reload`. Rule shape:

  ```json
  { "id": "no-force-push",
    "tool": "Bash",
    "match": "git push .*--force(?!-with-lease)",
    "field": "command",
    "action": "deny",
    "message": "Force pushes rewrite shared history.",
    "cite": "memory/never-force-push.md",
    "replace": "…only for action=rewrite…" }
  ```

  - `tool`: a tool name, a `*` glob (`mcp__*`), or `*`.
  - `field`: which input field to test. The default is the whole input JSON.
  - `action` is one of `deny | ask | rewrite | note`.
- **Enforcement.** Matching rules apply in file order, on every tool call, subagents included.
  - `deny` returns `{ deny }` with a red pixel-art "TRAP SPRUNG" message that includes the id, message and cite.
  - `ask` forces a permission prompt through `tool.check`.
  - `rewrite` applies a regex replace to the field via `next`.
  - `note` lets the call run and attaches the message as `context` the model reads.
- **Hit counts** persist per rule in `$.store`.
- **Invalid rules.** A bad regex or unknown action skips that rule and toasts once. It never crashes the mod.
- **`/tripwire`** opens a pane titled `TRAPS ARMED: N`. The pane shows each rule's id, action, hit count and last hit. Each rule has a Disarm button that toggles it off for the session.
- **`/tripwire add <sentence>`** compiles a plain-English rule into a rule JSON with `$.model.complete`.
  - The prompt includes the rule schema and 3 examples.
  - The pane shows the proposed rule with **Arm** and **Discard** buttons. Arm appends it to the user file via `$.fs.write`.
  - The model is only a proposer: the human arms.
  - If the model's output doesn't parse as a valid rule, show the reason and arm nothing.
- **Starter pack.** Ship `tripwire/examples/tripwire.json` with generic rules:
  - no force push without lease
  - no `--no-verify`
  - no `gh pr merge --admin`
  - no `git checkout -- <file>`; suggest backing it up first
  - no `rm -rf /` or `~`
  - no `curl | sh`
  - a note when `gh pr checks` runs right after a push
  - a template rule for a protected host
- **Acceptance.**
  - Every action behaves as specified.
  - Rules apply to subagent calls.
  - An invalid rule is reported and skipped.
  - Compile never writes without Arm.

### sentry — wait outside the model

- **Watch list.**
  - `/watch <pr number | PR URL>` adds a PR, scoped to the session's repo via `gh`.
  - `/unwatch <pr>` removes one.
  - `/watch` with no argument opens the pane.
  - The watch list lives in `$.state`.
- **Polling.**
  - A `$.clock.every` timer (`userConfig.intervalSeconds`, default 60) polls each PR with `$.process.run` and `gh`. It never starts a model turn just to poll.
  - It fetches PR state (`headRefOid`, state, `mergeStateStatus`, `reviewDecision`, merge queue, `mergedAt`, title).
  - It fetches all check-runs for **the head SHA**, paginated with `per_page=100`.
  - It counts unresolved review threads (GraphQL `reviewThreads.isResolved`).
- **The truth rules.**
  - No check-runs on the head yet means **pending**, never green.
  - CI is green only when every completed run on the head SHA passed and none are queued or in progress.
  - A head SHA that changed resets CI to pending.
- **Waking the session.** On a transition to an actionable state, sentry calls `$.prompt.submit` with a one-line summary such as `SENTRY: PR #12 CI FAILED on abc1234 — lint, unit. Investigate.` The actionable states are:
  - CI failed
  - CI green + approved + no open threads (**ready**)
  - changes requested
  - a new unresolved thread
  - merged
  - closed

  `userConfig.wake` is `actionable` (default) or `never`. A non-actionable change only redraws.
- **Poll denial.** While any PR is watched, deny Bash sleep-poll shapes with "sentry is watching PR #n and will wake you; end your turn instead." The shapes:
  - `sleep N` with N ≥ 20
  - `gh pr checks … --watch`
  - `gh run watch`
  - `until`/`while` loops that call `gh`
- **`pr_state` tool.** Register a model-callable tool that returns the same truth snapshot. The model asks `pr_state` instead of hand-rolling `gh` calls.
- **UI.**
  - A pane with a pixel watchtower whose beacon is coloured by the worst PR state.
  - One row per PR with lights: CI ● REVIEW ● THREADS ● QUEUE ● MERGED.
  - Status line: `SENTRY #12 CI▓ REV░ 0T`.
  - A toast on every transition.
- **Acceptance.**
  - Zero check-runs is pending, not green.
  - A head change resets CI.
  - Exactly one wake per transition, never repeated for the same state.
  - Denial happens only while watching.
  - `gh` missing or unauthenticated leads to a clear error and no crash.

### stance — enforced session modes

- **Stances.** The default is `build`.
  - `investigate`: findings only. Deny:
    - Edit/Write/NotebookEdit, except files under the OS temp dir or the session scratchpad
    - git commit/push/branch/switch -c/checkout -b/worktree add/merge/rebase
    - gh pr create/merge/comment/review and gh issue create
    - MCP tools whose name contains a write verb (`send|post|create|save|update|delete|merge|comment|reply|publish`)
  - `draft`: work locally, send nothing. Deny `git push`, gh pr create/merge/comment, and MCP write-verb tools.
  - `build`: no restrictions from stance.
  - `ship`: no restrictions; the band reminds you to verify before merging.
- **Switching.**
  - `/stance <name>` switches; `/stance` shows the current stance.
  - On `prompt.submit`, case-insensitive phrases auto-switch and toast `STANCE → INVESTIGATE`:
    - "investigation (task|only)", "no code", "no commits?", "no PR", "findings only" → investigate
    - "do not (send|post|reply)", "draft only" → draft
  - Auto-detect never downgrades a stance the user set explicitly in the same session without a toast. `userConfig.autoDetect` (default true) turns it off.
- **Telling the model.** The model is told the stance through a system-prompt section (`prompt.section`) or the prompt context. Every deny message names the stance and how to switch.
- **UI.** A band above the prompt holds a pixel class badge per stance (magnifier, quill, hammer, rocket) and the stance name in its colour. Buttons `[INV] [DRAFT] [BUILD] [SHIP]` switch on click. The band is hidden in `build` unless `userConfig.showBuild` is on.
- **Acceptance.**
  - Each stance's allow and deny matrix is tested.
  - Auto-detect phrases switch the stance.
  - Buttons switch the stance.
  - Subagent calls obey the stance.

### anti-cheat — no claims without evidence

- **Recording.** During each main-loop turn, the mod records an ordered log:
  - file edits (Edit/Write/NotebookEdit)
  - Bash commands with their outcome (error or not), classified as **test** (`pytest|jest|vitest|mocha|go test|cargo test|npm|pnpm|yarn|bun (run )?test|just test|make test|rspec|phpunit|uv run pytest`), **lint/typecheck** (`eslint|ruff|tsc|mypy|pyright|lint|typecheck`), **build**, **ci** (`gh pr checks|gh run (view|watch)|check-runs`), or **push** (`git push`)
- **Checking claims.** On `turn.complete` (main loop only), the mod scans `answer` for claims and checks each against the log. A claim needs a passing command of its kind after the last edit (for ci, after the last push) in this turn or, if no edit this turn, the most recent one this session. Claim kinds:
  - `tests pass/passing/green`
  - `lint/typecheck clean`
  - `build passes`
  - `CI green/passing/all checks pass`
  - `verified/confirmed it works`
- **Flagging.**
  - Each unverified claim produces a lime/red pixel-art referee band: `⚑ FOUL: "tests pass" — no test ran after the last edit`.
  - The band has buttons **Challenge** and **OK**. Challenge submits `$.prompt.submit("anti-cheat: you said <claim> but <reason>. Run the check now and report the real result.")`; OK dismisses.
  - The mod also appends a system notice (`$.session.append`, type `system`) so the foul stays in the transcript.
  - `userConfig.mode` is `flag` (default) or `challenge`, which auto-submits the challenge.
- **No model calls.** Deterministic regex only.
- **Acceptance.** Tests cover:
  - claim detected with no evidence → flag
  - evidence after the last edit → no flag
  - a failing test run → flag
  - a CI claim after a push with no CI check → flag
  - negations ("tests do not pass yet") → no flag
  - aborted turns → no check

### respawn — continue after a network death

- **Trigger.** On `turn.complete` with `reason: 'error'` (not `aborted`, not `refusal`), main loop only, respawn starts a countdown with backoff: 10s, 30s, 60s, 120s, 300s.
- **Lives.** There are 3 lives per hour (`userConfig.lives`). Lives are shown as `♥♥♡`.
- **Continue.** When the countdown ends, respawn calls `$.prompt.submit(userConfig.prompt || "continue")`.
- **Cancelling.** Each of these cancels the countdown and resets the backoff:
  - the user typing anything
  - a successful turn (`reason: 'answer'`)
  - `/respawn off`
- **UI.** An orange arcade band, `CONTINUE?` with a big pixel digit counting down. It has buttons `[INSERT COIN]` (continue now) and `[GAME OVER]` (cancel). When lives run out, the band shows `GAME OVER` and makes no further attempts until the user prompts. `/respawn` shows the state.
- **Acceptance.**
  - Only `error` triggers a respawn.
  - Backoff goes up and resets on success.
  - Lives are enforced.
  - User input cancels.
  - Buttons work.
  - Uses the mocked clock in tests.

### radar — memory at the moment it matters
- Memory sources (`userConfig.memoryDirs`, default: the auto-memory directory from settings `autoMemoryDirectory` if set, else the project's `~/.claude/projects/<slug>/memory`): every `*.md` with frontmatter `name`/`description`; optional frontmatter `triggers:` (list of regexes) and lines in the body starting with or containing **never/always/don't/must** become the memory's *rules*.
- Index on `session.start` and `/radar reload`; matching is deterministic: explicit `triggers` first, then keyword overlap between the tool input (Bash command, file path, URL, MCP tool name + args) and the memory's name/description tokens (stop-words removed, ≥2 distinctive tokens or one trigger hit).
- On a match (main loop and subagents), the call runs (`await next(e)`) and the memory's description + rule lines are attached as `context` (model-only). At most 2 memories per call; the same memory is not re-attached within the same turn.
- UI: toast `RADAR ▸ <memory name>`; `/radar` pane: lavender radar-sweep sprite, recent pings (time, tool, memory), memory count; status `RADAR 274 ◉ 3 PINGS`.
- Never edits memory files. Acceptance: trigger regex hit attaches; keyword overlap attaches; unrelated call attaches nothing; dedup per turn; cap of 2; malformed frontmatter skipped with one toast.

### quicksave — a save point before compaction
- On `session.compact` (any trigger) and on `/quicksave`, before compaction proceeds: `$.model.fork` asks for a structured save — goal, current step, working directory/branch, open PRs/tickets/links mentioned, decisions made, rules the user set in this session, next step — as JSON; written to `$.store` keyed by session id (last 5 slots) and mirrored to `<session cwd>/.claude/quicksave/<session-id>.md` only when `userConfig.writeFile` is on (default off).
- After compaction completes, the save is appended to the conversation (`$.session.append`, user-role note) so the model continues from it. `/quickload [slot]` re-injects manually; `/quicksave list` shows slots.
- Save-point band: when context usage ≥ `userConfig.warnAtPercent` (default 70) **and** the session is idle (no turn running, no background tasks), show a green `SAVE POINT ▸ safe to /compact` band with `[ SAVE ]` and `[ SAVE + COMPACT ]` buttons.
- If the fork fails (`isAnswered: false`), compaction is not blocked: a toast says the save failed. Acceptance: compaction triggers a save then a re-inject; fork failure doesn't block; slots capped; band shows only when idle and above threshold.

### party — the raid frame for your sessions
- Every session heartbeats into `$.store` (per-session key) every 15 s and on turn start/end and question/permission waits: session id, title, cwd, branch, state (`working` | `waiting-on-you` | `idle` | `done`), since, last tool. Entries older than 2 min are stale and dropped from views.
- `waiting-on-you` = a question/plan/permission prompt is pending (detect via the events the API exposes; if only partially detectable, document it).
- `/party` pane: raid-frame rows with a pixel class icon per state, HP-style bar for time waiting (fills red after `userConfig.nagMinutes`, default 5), cwd basename, branch. Status: `PARTY 4 ▸ 1 WAITING`. Toast once when another session has waited longer than `nagMinutes`.
- Locks: when a tool call targets a PR (`gh pr merge|close|comment|review|edit <n>` or a PR URL), record `{repo, pr, session, at}`; if another live session touched the same PR in the last `userConfig.lockMinutes` (default 10), turn the call into an ask (`tool.check`) naming the other session.
- `/broadcast <text>` sends the text to every other live session via `$.session.send` where the API allows; otherwise documents the limitation and copies to clipboard.
- Acceptance: heartbeat/stale handling; state transitions; lock → ask; no lock for the same session; broadcast skips self.

### prove-it — the fix must make a test fail first
- Config: `userConfig.testCommand` (e.g. `npm test --`, `pytest`), `userConfig.sourceGlobs` / `testGlobs` (defaults: tests = `**/*.test.*`, `**/*_test.*`, `**/test_*.py`, `tests/**`; source = everything else tracked).
- `/prove` (and, when `userConfig.gate` is on, intercepting `git push` / `gh pr create`): determine the change vs the merge base (`git diff --name-only <base>`), split into source vs test files, then: copy changed source files aside to the OS temp dir, restore their base versions (`git show <base>:<path>`), run the test command on the changed test files, **require a failure**, restore the copies, verify the restore by hash, run the tests again and require a pass.
- Never uses `git stash`/`git checkout --`; restore happens in a `finally` path even on error; if the restore hash mismatches, stop and tell the user where the copies are.
- Verdict band: `PROVEN ★` (fails without, passes with), `NOT PROVEN` (passes without the fix → the tests don't test the fix), `BROKEN` (fails with the fix). With the gate on, `NOT PROVEN`/`BROKEN` deny the push/PR with the reason; `/prove skip` allows the next one.
- Acceptance: each verdict; restore verified even when the test command errors; no-tests-changed reported; gate deny/skip.

### co-op — a second player reviews before the PR
- On `gh pr create` (and `/coop`): collect `git diff <base>...HEAD` (truncated to `userConfig.maxDiffKb`, default 200), send it to a reviewer, parse findings, and gate.
- Reviewer: default `$.model.complete` with `userConfig.model` (default a different model family tier than the session if available, else the session model) and a strict review prompt returning JSON `{verdict: "pass"|"fail", findings:[{severity,file,line,summary}]}`. Optional `userConfig.command`: a user-supplied CLI (argv, diff on stdin) whose stdout is parsed the same way — the README must state this sends the diff to whatever that command talks to.
- Gate: `fail` with any high finding → deny `gh pr create` with the findings as text; findings are also attached as `context`. `/coop skip` allows the next create. After fixes, the next create re-runs the review.
- UI: blue `2P REVIEW` band with findings count by severity, `[ VIEW ]` opens a pane listing findings; status `CO-OP ▸ PASS`.
- Acceptance: pass lets through; fail denies with findings; unparsable reviewer output fails open with a toast (never blocks forever); skip; truncation noted.

### honest-exit — loud shell failures
- After every Bash result (main + subagents), detect and attach a model-visible `context` note (and a toast) for:
  - zsh `no matches found` / bash `No match` → "the glob didn't match, so the command never ran".
  - `command not found` for a name the user aliases interactively (`cp`, `rm`, `mv`, `grep`, `ls` heuristics) → note that agent shells may differ.
  - Exit 0 whose output contains failure signatures (`FAILED`, `failed`, `Error:`, `✗`, `N failing`, `Traceback`) **and** the command pipes into `head`/`tail`/`tee`/`grep` or ends in `|| true` → "the pipeline hid the exit status of the first command".
- Optional rewrites (`userConfig.rewrite`, default off): quote unquoted glob words in `--include=*.x`-style flags; prefix `set -o pipefail;` when the command pipes a test/lint/build command into `head`/`tail`.
- UI: peach `HONEST EXIT` toast + status counter `EXIT ▸ 3 CAUGHT`. Acceptance: each detector with positive and negative cases; rewrite off by default; rewrite idempotent.

### dock — container stacks per worktree
- `/dock` pane (refresh on open and every `userConfig.intervalSeconds`, default 30, only while open): via `$.process.run` with `docker`: compose projects (`docker compose ls --all --format json`), per-container memory (`docker stats --no-stream --format json`), total engine memory (`docker info --format json`), each project's working dir (compose label `com.docker.compose.project.working_dir`).
- Rows: project, worktree path (or `ORPHAN` when the working dir no longer exists), state, memory bar; header: total used / engine total as a pixel-art fuel gauge, headroom in GiB.
- Guard (`userConfig.guard`, default on): on Bash `docker compose up` / `docker-compose up`, if headroom < `userConfig.minHeadroomGiB` (default 3) → ask, naming the biggest stacks. Never stops or removes anything itself; pane buttons `[ DOWN ]` put the exact `docker compose -p <name> down` command into the reply/clipboard for the user.
- No docker / daemon down → pane says so. Acceptance: orphan detection; headroom math; guard ask only below threshold; no destructive call anywhere in the code.

### tracer — merged is not deployed
- `/trace <pr | sha>`: resolve the merge commit (via `gh pr view --json mergeCommit`), then poll every `userConfig.intervalSeconds` (default 60) with `gh api`: workflow runs for that SHA (`actions/runs?head_sha=`), deployments for that SHA (`deployments?sha=`) and their latest statuses; optional `userConfig.liveUrl` (with `{sha}` placeholder) fetched with `$.http.fetch`, live when the body contains the SHA (or `userConfig.liveMatch`).
- Chain shown as a pixel-art level map: `MERGED ▸ BUILD ▸ DEPLOY:<env> ▸ LIVE`, each node ● pending / ★ done / ✕ failed.
- Wakes the session (`$.prompt.submit`) once when the chain reaches LIVE (or the last known stage) or any stage fails (`userConfig.wake`: `final` | `never`). Stops polling after done/failed or `userConfig.timeoutMinutes` (default 120).
- Acceptance: stage progression; failure wakes once; timeout; no deployments configured → BUILD is the final stage and README says so.

### mender — fix the arguments, not the model
- For MCP tool calls (`mcp__*`), validate the input against the tool's own input schema (from `$.tool.list` / the call envelope) and repair known-safe mistakes before the call: drop unknown properties when the schema forbids them, coerce `"true"`/`"false"` → booleans, numeric strings → numbers, single value → `[value]` when an array is expected, JSON strings → objects when an object is expected. Each repair is listed in a model-visible `context` note so the model learns the right shape.
- If a call still errors with a schema/validation message, record `{tool, error}`; `/mender` pane lists repairs and recurring errors per tool.
- Connector down (error text indicates disconnected/unauthenticated server): toast `MENDER ▸ <server> DOWN` once and attach a note to stop retrying until the user reconnects.
- Never invents values or changes a value that already satisfies the schema. Acceptance: each coercion with schema; no-op on valid input; unknown-key drop only when `additionalProperties: false`; repair notes; down detection.

## Demos

Each mod README opens with a short recorded GIF of the mod working in a real Claude Code session. Demos are recorded with [VHS](https://github.com/charmbracelet/vhs) and can be re-rendered by anyone with VHS and a signed-in `claude`.

- **Sample project.** `demos/project/` is a tiny Node app with no dependencies: a `cart.js` module, a `node --test` suite run by `npm test`, and a README. `demos/setup.sh` copies it to a neutral path under the temp dir, makes it a git repo committed as `Demo <demo@example.com>`, and adds a linked worktree, so every demo starts from the same clean state. A copy left by an earlier run is moved aside to a fresh temp folder, never deleted. Mod-specific files (such as a project `.claude/tripwire.json`) are written by the tape's hidden setup, not committed into the sample app.
- **Session.** Every tape runs `claude --model haiku` (cheap and fast) with only the demoed mod loaded via `--plugin-dir`, the user's own settings, plugins and MCP servers left out (`--setting-sources project,local --strict-mcp-config`), and permissions preset so no prompt interrupts the run. The prompt is `$ `, and the trust dialog and environment setup happen off camera (`Hide`/`Show`).
- **Look.** A dark theme taken from the author's terminal profile, in `demos/tapes/common.tape`, with JetBrains Mono. Width and frame rate are chosen so each GIF stays under 5 MB.
- **Length.** Each demo runs under 30 seconds of playback.
- **Scenarios.**
  - `tripwire`: a project rule denies `git commit --no-verify`; the prompt asks for a commit that skips hooks, and the `TRAP SPRUNG` deny shows.
  - `stance`: a prompt starting "No code, findings only" switches the stance to investigate (toast and badge band); an edit the model then attempts is refused with the stance message.
  - `anti-cheat`: the prompt asks for a small edit and a "tests pass" reply without running anything; the `FOUL!` referee band shows.
  - `hero`: one session with all three loaded, showing each in turn, for the root README.
  - `anchor`: the session starts in the sample project's linked worktree; the status line shows the anchor, and a git write the model is asked to run in the primary checkout is denied with the anchor message.
  - `honest-exit`: the cart source is broken off camera so the suite throws; the prompt runs the suite piped into `tail`, which exits 0, and the `HONEST EXIT` toast and status counter show the hidden failure.
  - `prove-it`: the worktree holds a source fix and a new test; `/prove` reverts the fix, sees the test fail, restores it, sees it pass, and shows the `PROVEN ★` verdict band.
  - `radar`: `memoryDirs` points at a temp copy of `demos/fixtures/memory/`, four neutral lessons; with an uncommitted change in the cart, the prompt runs `git diff` and asks to discard the change; the `RADAR ▸` toast and status count show the ping, the model copies the file aside before `git checkout --`, and `/radar` shows the scope and the ping.
  - `mender`: a stand-in MCP server, `demos/mcp/cart-server.js` (dependency-free JSON-RPC over stdio), is loaded with `--mcp-config`, and its own `tools/list` answer is written off camera as mender's `schemaFile`, since mender cannot read MCP schemas from the engine; the prompt asks for `add_item` with one tag as a plain string and an extra key, both wrong on purpose; mender wraps the tag in a list and drops the key before the call, the call succeeds, the model quotes mender's note, the status shows `MENDER ▸ 1 FIXED`, and `/mender` shows the patch log. The tape is taller than the rest so the pane's repair list fits.
  - `dock`: a stand-in `docker`, `demos/stubs/docker` (bash), is put first on `PATH` off camera; it answers only dock's four read-only probes with canned output from `demos/fixtures/docker/` (an 8 GiB engine, stacks for the app's main checkout, its `-feature` worktree and an `app-old-feature` whose folder does not exist, 1.8 GiB free), refuses `compose up`, and fails loudly on anything else; the prompt runs `docker compose up -d`, dock's guard turns it into an ask naming the biggest stacks and the orphan's `down` command, the ask is declined, and `/dock` opens the pane with the red fuel gauge, the `◆` on the main checkout's stack, the `ORPHAN` row and the `[ DOWN ]` buttons. The tape is taller than the rest so the whole pane fits.
  - `sentry`: a stand-in `gh`, `demos/stubs/gh` (node, no dependencies), is put first on `PATH` off camera. It is a generic fixture server for later demos too: it matches each call's argv against the routes of one scenario, `demos/fixtures/gh/<scenario>/routes.json` (picked with `GH_STUB_SCENARIO`), serves canned answers that can change over time (seconds since a clock file, `GH_STUB_CLOCK`, which the first call starts), serves `--json` fields the way `gh` does, and fails loudly (exit 64) on anything it has no route for, so nothing reaches the real `gh` or GitHub. The `sentry-ci-fails` scenario is PR #12 in `demo/cart`, whose `test (node 24)` check is running for 5 s after `/watch` and then fails. The session runs in the app's `-feature` worktree, where the PR's commit breaks `applyDiscount`, with a fake `origin` that is never fetched, `intervalSeconds: 15` (the minimum), auto memory off, and a project `CLAUDE.md` that names the `gh` commands to read a failed log and forbids commit and push. `/watch 12` shows `CI RUNNING` and the `SENTRY #12 CI▒` status; the model is asked to run `sleep 30 && gh pr checks 12` and sentry denies it; the next poll (timed off camera to land about 11 s after `/watch`) flips the status to `CIX`, toasts `CI FAILED` and wakes the session, and the model reads the failed log, fixes the bug and runs the tests.
- **Mods that need real conditions** are not recorded yet. tracer needs a deploy or a PR with CI and co-op reviews on `gh pr create`; both could reuse the stand-in `gh` with a scenario of their own; respawn needs a dropped connection, which a recording cannot produce reliably; quicksave needs a compaction; party needs several live sessions. They are deferred. radar, which reads memory files from the user's own config, is recorded against a neutral fixture set in `demos/fixtures/memory/` instead, mender, which needs an MCP server, against the stand-in cart server in `demos/mcp/`, dock, which needs Docker, against the stand-in `docker` in `demos/stubs/` that serves fixture stacks and boots nothing, and sentry, which needs a PR with CI, against the stand-in `gh` in `demos/stubs/` that serves a fixture PR whose CI fails a few seconds into the demo.
- **Privacy.** Recordings show only the neutral prompt, the demo path (under the temp dir, or `/Users/Shared` for stance, whose investigate mode allows writes under temp dirs) and the demo user. No real names, accounts, hosts or home paths appear in any frame or tape.
- **Acceptance.**
  - `scripts/record.sh` renders every tape, or only the mods named as arguments, and fails if any GIF is 5 MB or more or a tape fails.
  - Every GIF shows its mod's UI firing (band, toast or deny text) on a fresh run.
  - Frames extracted from each GIF show no home path, username, email or account name.
  - Each mod README embeds its GIF near the top; the root README embeds `assets/hero.gif`.

## Code style

```tsx
import type { Register } from 'claude-code'
import { compileRules, matchRule } from './rules'

export const register: Register = (on, options) => {
  on('tool.call', async ($, e, next) => {
    const hit = matchRule(rules, e)
    if (hit?.action === 'deny') return { deny: trapText(hit) }
    return next(e)
  })
}
```

- Small pure helpers in `hooks/*.ts` with unit tests, and a thin `register.tsx`.
- Names say what things are (`headSha`, `isActionable`, `unverifiedClaims`). No abbreviations beyond `e`, `$` and `next`.
- No module-level mutable state that must survive a reload: use `$.state` (session) and `$.store` (across sessions) with a `types/index.d.ts` contract.
- Every `$.process.run` and `$.http.fetch` failure is handled. A mod degrades to a toast; it never throws out of a hook.

## Testing strategy

- `claude plugin test <mod>` runs every `tests/*.test.ts`. Each mod has:
  - unit tests for its pure helpers
  - `register.test.ts` covering every acceptance bullet through the engine's `$`, with `mock.clock` for timers and `process.run` and `model.complete` answered by test hooks
  - UI tests that mount each component on **both** `terminal` and `desktop`
- `claude plugin validate <mod>` is clean (no refusals) for every mod.
- `scripts/check.sh` runs both for all mods and is the gate before each commit.
- Where possible, a headless smoke run: `claude -p --plugin-dir <mod> --model haiku "<prompt>"` proves the hooks fire in a real engine (e.g. anchor's rewrite shows in `pwd`).

## Boundaries

- **Always:**
  - Validate and test before committing.
  - Keep each mod self-contained.
  - Draw only through `$.ui.resolve`.
  - Write a README with a permissions table (network, processes, files, model calls, what leaves the machine).
- **Ask first:**
  - adding runtime dependencies
  - adding CI workflows
  - any network endpoint other than GitHub via `gh`
  - publishing to the Claude directory
- **Never:**
  - Include secrets or private data: names of people, companies, internal repos, tickets, hosts or customers (this repo is public).
  - Approve a permission prompt on the user's behalf.
  - Auto-submit prompts except sentry's wake, anti-cheat's opt-in challenge, and respawn's continue, and each of those can be switched off.
  - Send data anywhere but the user's own model and `gh`.
  - Commit `types/claude-code*.d.ts`.

## Success criteria

1. `scripts/check.sh` exits 0: every mod validates clean and every test passes on terminal and desktop.
2. `/plugin marketplace add pourya7/claude-code-mods` lists every mod. Each installs alone and loads (`/plugin` shows it active).
3. Every acceptance bullet above has at least one test.
4. The recorded mods' READMEs open with their demo GIF, and the root README with the hero GIF. Each mod README has a text capture of its pixel-art UI, commands, config and permissions. The root README has the banner, thesis, evidence table, install steps and mod table.
5. No secrets and no private data in any file or commit.

## Open questions

1. **CI.** There is none yet. Whether `claude plugin test` runs in GitHub Actions without auth is unverified.
2. **Demos for the rest.** tripwire, stance, anti-cheat, anchor, honest-exit, prove-it, radar, mender, dock and sentry have recorded demos; the mods listed under Demos as needing real conditions do not yet.
