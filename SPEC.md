# Spec: claude-code-mods — first wave

## Objective

A public library of [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview), published as a plugin marketplace, that fix the problems a product engineer actually has when Claude Code runs long, parallel, mostly unattended work. Most of the 1,000+ published mods are dashboards, games, or generic guards. These mods are different: each one is mined from a real study of 242 sessions, 1,145 subagent runs, and 279 memory files.

**Thesis: memories are advice, mods are law.** A rule written in `CLAUDE.md` or memory is something the model may forget. A mod enforces it at the moment of the tool call.

**Users:** developers who run Claude Code for long stretches, often several sessions in parallel, across git worktrees, with CI and PR review loops, and who keep correcting the same mistakes.

**Success:** someone can run `/plugin marketplace add pourya7/claude-code-mods`, install any one mod, and immediately get a guardrail or a removed chore. Each mod passes `claude plugin validate` and `claude plugin test`, and looks like part of one 8-bit family.

### Evidence (aggregate numbers; quote freely, no employer specifics)

| Pain | Evidence | Mod |
|---|---|---|
| Shell leaves the worktree | 27k of 78.6k Bash calls start with `cd`; 1,859 "shell cwd was reset" notices | anchor |
| Prose rules don't hold | 405 never/don't lines across 189 memory files; ≥11 mistakes repeated *after* being written down | tripwire |
| The model does the waiting | ~1.8k poll loops, ~1.5k `sleep`s, ~1.2k CI-status calls; false-green right after a push | sentry |
| Modes typed as preambles | "no code, no commit, no PR" in 44 sessions | stance |
| Claims without evidence | "tests pass" / "CI green" after edits with no re-run; 23% of memories are verification traps | anti-cheat |
| Dropped connections | ~120 API connection errors; "continue" / "try again" typed by hand | respawn |

## Capability map

Each mod is an independent plugin: no mod imports another, and each folder is installable alone.

| Module id | Responsibility | Depends on |
|---|---|---|
| `marketplace` | Root `.claude-plugin/marketplace.json`, README, LICENSE, tsconfig, `scripts/check.sh`, shared 8-bit style guide (this spec) | — |
| `anchor` | Pin a session to its git worktree | marketplace |
| `tripwire` | Turn written rules into enforced deny/ask/rewrite/note checks on tool calls | marketplace |
| `sentry` | Watch PRs outside the model and wake the session only when something actionable happens | marketplace |
| `stance` | Session modes (investigate / draft / build / ship) that are enforced, not just requested | marketplace |
| `anti-cheat` | Check "tests pass / CI green / verified" claims at turn end against what actually ran | marketplace |
| `respawn` | Auto-continue after a turn dies on a network or API error | marketplace |

Build order: `marketplace` → all six mods in parallel → README integration.

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
<mod>/README.md                   → what/why (one evidence line), install, commands, config, 8-bit preview, permissions table
scripts/check.sh                  → CI-style check over all mods
tsconfig.json                     → editor/tsc config (jsxFactory h), includes types/ and */hooks, */tests
types/                            → git-ignored engine declarations from /plugin-types
```

## 8-bit style guide (shared by every mod)

The mods should look like one arcade family.

- **Palette: PICO-8.** Use these 16 hex colours only:
  - black `#000000`, navy `#1D2B53`, plum `#7E2553`, green `#008751`
  - brown `#AB5236`, dark grey `#5F574F`, light grey `#C2C3C7`, white `#FFF1E8`
  - red `#FF004D`, orange `#FFA300`, yellow `#FFEC27`, lime `#00E436`
  - blue `#29ADFF`, lavender `#83769C`, pink `#FF77A8`, peach `#FFCCAA`
  - Each mod has a signature colour: anchor blue, tripwire red, sentry yellow, stance pink, anti-cheat lime, respawn orange.
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
  - Status line: a single-width glyph plus the worktree name and branch, e.g. `╋ ANCHOR first-wave@feat/first-wave` (no `⚓`, which renders as an emoji in many terminals).
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
  - `deny` returns `{ deny }` with a red 8-bit "TRAP SPRUNG" message that includes the id, message and cite.
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
  - Each unverified claim produces a lime/red 8-bit referee band: `⚑ FOUL: "tests pass" — no test ran after the last edit`.
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
  - Mention the author's employer, its repos, tickets, vendors, hosts or customers (this repo is public).
  - Approve a permission prompt on the user's behalf.
  - Auto-submit prompts except sentry's wake, anti-cheat's opt-in challenge, and respawn's continue, and each of those can be switched off.
  - Send data anywhere but the user's own model and `gh`.
  - Commit `types/claude-code*.d.ts`.

## Success criteria

1. `scripts/check.sh` exits 0: all six mods validate clean and every test passes on terminal and desktop.
2. `/plugin marketplace add pourya7/claude-code-mods` lists six mods. Each installs alone and loads (`/plugin` shows it active).
3. Every acceptance bullet above has at least one test.
4. Each mod README has a text capture of its 8-bit UI, commands, config and permissions. The root README has the banner, thesis, evidence table, install steps and mod table.
5. No employer-specific strings in the repo (checked with grep before push).

## Open questions (assumed; correct later)

1. **License.** MIT is assumed.
2. **Commits and PRs.** `SPEC.md` is committed. `tasks/` stays local. The first wave lands as a PR from `feat/first-wave` for review rather than straight onto `main`.
3. **CI.** There is none yet. Whether `claude plugin test` runs in GitHub Actions without auth is unverified.
4. **Screenshots.** The first wave ships text captures. Real screenshots come later.
