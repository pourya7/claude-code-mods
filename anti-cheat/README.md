# anti-cheat

```
█▀█ █▄ █ ▀█▀ ▀█▀     █▀▀ █ █ █▀▀ █▀█ ▀█▀
█▀█ █ ▀█  █   █  ▀▀▀ █   █▀█ █▀  █▀█  █
▀ ▀ ▀  ▀  ▀  ▀▀▀     ▀▀▀ ▀ ▀ ▀▀▀ ▀ ▀  ▀
        NO CLAIMS WITHOUT EVIDENCE
```

**The problem:** the model says "tests pass" or "CI green" after editing code without running anything again. In the study behind this library, 23% of 279 memory files were verification traps.

anti-cheat is the referee. During each main-loop turn it logs every file edit and every check command (test, lint/typecheck, build, CI, push), with whether it passed. When the turn ends, it reads the answer for claims and checks each one against that log. A claim with nothing behind it gets a foul flag above the prompt and a notice in the transcript. The check is deterministic regex. There are no model calls.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install anti-cheat@claude-code-mods
```

## What counts as evidence

| Claim in the answer | Backed by | Must come after |
|---|---|---|
| `tests pass` / `passing` / `green` | a passing test run: `pytest`, `jest`, `vitest`, `mocha`, `go test`, `cargo test`, `npm/pnpm/yarn/bun (run) test`, `just test`, `make test`, `rspec`, `phpunit`, `uv run pytest` | the last edit |
| `lint` / `typecheck` `clean` | a passing `eslint`, `ruff`, `tsc`, `mypy`, `pyright`, `lint` or `typecheck` | the last edit |
| `build passes` | a passing build (`npm run build`, `cargo build`, `go build`, ...) | the last edit |
| `CI green` / `passing` / `all checks pass` | a passing `gh pr checks`, or `gh run view` / `gh run watch` with `--exit-status` | the last `git push` |
| `verified` / `confirmed it works` | any passing check above | the last edit |

- The last edit is the most recent one in this turn. If this turn made no edit, it is the most recent one this session. If no edit or push happened at all, any run this session counts.
- Only the last matching run counts. A failing last run is a foul: `the last test run failed (pytest -x)`.
- Negations, hedges and questions are not claims: "tests do not pass yet", "once the tests pass", "should pass", "do the tests pass?". A negative word must sit close to the claim, so "I fixed the failing test and all tests pass" is still a claim. Text inside fenced code is ignored.
- A run counts as passing when its exit status is the check's own result and that status is 0. The run must also not be interrupted or moved to the background.
- Bash reports the status of the last command, so `pytest | tail -20`, `npm test || true` and `pytest; echo done` exit 0 when the tests fail. Those runs never pass: `the last test run's exit status was hidden by a pipe or a later command (pytest | tail -20)`. `set -o pipefail` makes a pipe count, and `set -e` makes a `;` count.
- A run that moved to the background is not a pass: `the last test run is still in the background (npm test)`.
- A plain `gh run view`, `gh run watch`, a `check-runs` API read or a `statusCheckRollup` query exits 0 whatever CI concluded. It only reads the status, so on its own it backs no CI claim. It also never cancels a real check that came before it.
- Installing a tool is not running it: `npm install -D jest` and `pip install pytest mypy` are not checks.
- An edit made by a subagent still counts as an edit. Only main-loop runs count as evidence. Subagent turns, aborted turns, turns that end on an error and refusals are never checked.

## The 8-bit UI

The referee band above the prompt shows up only after a foul. It clears when you press a button or when the next turn starts.

```
▀▀▀▀▀▀▄  FOUL! REFEREE REVIEW · 2 UNVERIFIED CLAIMS
▀▀▀▀▀▀▀  ⚑ FOUL: "All tests pass" — no test ran after the last edit
▀        ⚑ FOUL: "CI is green" — no CI check ran after the last push
▀▄▄      [ CHALLENGE ] [ OK ]
```

- The flag is a red and yellow PICO-8 sprite on a grey pole with lime turf. `FOUL!` is red and the header is lime.
- **CHALLENGE** (hotkey `c`) sends the model this prompt: `anti-cheat: you said "All tests pass" but no test ran after the last edit. Run the check now and report the real result.`
- **OK** (hotkey `o`) dismisses the band.
- Up to 3 fouls are shown. Any beyond that collapse into `+N MORE`.
- The transcript keeps the foul as a system notice: `anti-cheat ⚑ FOUL: "All tests pass" — no test ran after the last edit`. If the session refuses the notice, a toast shows the same line instead.

## Commands

| Command | What it does |
|---|---|
| `/anti-cheat` | Shows the mode, the last edited file, every check run since that edit (`✓` passed, `✗` failed, `?` result unknown: hidden, read-only, backgrounded or interrupted) and the current fouls. |

## Options (`userConfig`)

| Field | Values | Default | Effect |
|---|---|---|---|
| `mode` | `flag`, `challenge` | `flag` | `flag` shows the band and logs the notice. `challenge` also sends the challenge prompt by itself, at most once for each prompt a person sends (typed, through Remote Control, or an SDK turn). Background-task notifications, schedules and other plugins do not re-arm it, so a challenged turn cannot start a chain of challenges. |

Change it in `/config` or under `pluginConfigs["anti-cheat"].options.mode` in `~/.claude/settings.json`.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| None | None | None read or written. It keeps the edit/run log (paths and command lines, at most 200 entries) in session state (`$.state`) only. | No | Only in `mode: challenge`, at most once for each prompt a person sends. In `flag` mode a prompt is sent only when you press CHALLENGE. | None. A challenge prompt goes to your own session's model like any prompt you type. |

## Development

```
claude plugin validate anti-cheat
claude plugin test anti-cheat
```

The helpers are pure and covered by unit tests:

- `hooks/classify.ts`: commands to check kinds
- `hooks/claims.ts`: answer text to claims
- `hooks/evidence.ts`: claims plus log to fouls
- `hooks/sprite.ts`: the half-block renderer

`hooks/register.tsx` connects them to `tool.call`, `turn.complete`, the `AbovePrompt` band and `/anti-cheat`. `tests/register.test.ts` covers every acceptance bullet through the engine's `$` and mounts the band on both `terminal` and `desktop`.
