```
█▀█ █ █ █ █▀▀ █▄▀ █▀ ▄▀█ █ █ █▀▀
▀▀█ █▄█ █ █▄▄ █ █ ▄█ █▀█ ▀▄▀ ██▄   SAVE POINT ▸
```

# quicksave — a save point before compaction

**The problem:** compaction rewrites a long session into a summary, and the summary loses the plot: the exact goal, the branch, the PR you were on, the decisions already made, and the rules you set an hour ago. The study behind this library counted **91 compactions**, summaries rewritten by hand afterwards, and "is now a safe time to compact?" asked again and again.

quicksave writes a save point just before every compaction and hands it back to the model straight after, so the session carries on from the save, not from a vague summary. When the context is filling up and nothing is running, a green `SAVE POINT` band tells you it is a safe moment to compact.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install quicksave@claude-code-mods
```

## How it behaves

- **Save before compaction.** On every compaction of the main conversation (`/compact`, the automatic one at the threshold, or one a plugin starts), quicksave first forks the conversation with `$.model.fork` and asks for a JSON save:
  - the goal
  - the current step
  - the working directory and branch
  - the open PRs, tickets and links mentioned
  - the decisions made
  - the rules you set in this session
  - the next step
- **Slots.** The save goes into `$.store` under the session id. The 5 newest saves are kept as slots, newest first. Slots are kept for the 20 most recent sessions; older sessions' slots are removed.
- **Restore after compaction.** Once the summary is written, quicksave adds the save as the last user-role message of the compacted conversation. The model's next request reads the summary and then the save, which starts with `QUICKSAVE (slot 1, …)`. If the compaction kept an older save note (from an earlier compaction, or from `/quickload` of an older slot), that note is dropped, so the model reads exactly one save: the fresh one.
- **A failed save never blocks.** If the fork gives no answer (an API error, an empty reply, or nothing to fork yet), compaction goes ahead as normal and a toast says `QUICKSAVE ✕ SAVE FAILED (<reason>). Compacting anyway.`
- **Save-point band.** The band appears only when both of these are true:
  - the context window is at least `warnAtPercent` full (70% by default)
  - the session is idle, with no turn running and no subagent running
- **One save at a time.** While a save is being taken, the band shows `SAVING… HOLD STILL`. Pressing a button again, running `/quicksave`, or a compaction that starts meanwhile all wait for that save and use it, so there is never a second fork or a lost slot. A second press of `[ SAVE + COMPACT ]` while the first is still running does nothing.
- **File mirror (opt-in).** With `writeFile` on, each save is also written to `<session cwd>/.claude/quicksave/<session-id>.md`. It is off by default.

## Commands

| Command | What it does |
|---|---|
| `/quicksave` | Saves now, without compacting, into slot 1. |
| `/quicksave list` | Shows the slots, newest first: number, time (UTC), what made the save, and the goal. |
| `/quickload` | Hands slot 1 back to the model, as a hidden note it reads with your next message. |
| `/quickload <n>` | The same for slot `n` (1 to 5). |

The band's buttons have hotkeys. Once the band has focus (ctrl+x tab or a click), press `s` for SAVE or `c` for SAVE + COMPACT.

- **`[ SAVE ]`** saves into slot 1 and the band shows `SAVED ★ SLOT 1`.
- **`[ SAVE + COMPACT ]`** saves, then compacts. The save is passed to the summarizer as compaction instructions, and it is appended to the conversation again once the compaction stands.

## Configuration (`userConfig`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `warnAtPercent` | number | `70` | Show the SAVE POINT band once the context window is this full (1 to 100) and the session is idle. |
| `writeFile` | boolean | `false` | Also write each save to `<session cwd>/.claude/quicksave/<session-id>.md`. |

You can change these in the `/config` menu, or under `pluginConfigs.quicksave` in your settings.

## The UI

The band above the prompt, with the context 78% full and nothing running:

```
SAVE POINT ▸ safe to /compact QUICKSAVE
█▀▀▀▀██▄  CONTEXT ████████░░ 78%
████████  IDLE · NOTHING RUNNING
█▀▀▀▀▀▀█  SAVES GOAL, BRANCH, RULES, NEXT STEP
█▄▄▄▄▄▄█  /quickload HANDS IT BACK
[ SAVE ] [ SAVE + COMPACT ]
```

This capture is plain text. In the terminal the floppy disk is drawn in half-block pixels: green, with a light grey shutter, a white label and a lime shine. The bar is green on dark grey. All colours come from the PICO-8 palette.

`/quicksave list` after a few saves:

```
QUICKSAVE ▸ SLOTS (newest first)
1 ★ 2026-10-03 12:04 AUTO  Ship the retry fix for the uploader
2 ● 2026-10-03 11:20 COMMAND  Ship the retry fix for the uploader
3 ● 2026-10-03 10:02 MANUAL  Reproduce the upload timeout
/quickload [n] hands slot n back to the model.
```

What the model reads after a compaction:

```
QUICKSAVE (slot 1, saved 2026-10-03 12:04 UTC, auto). This is the save point written before the conversation was compacted. Continue the task from it; the user's rules below still apply.
GOAL: Ship the retry fix for the uploader
CURRENT STEP: Writing the regression test
WORKING DIRECTORY: ~/work/app (branch fix/upload-retry)
OPEN LINKS:
- PR #42
DECISIONS:
- Retry 3 times with jitter
RULES THE USER SET:
- No force push
NEXT STEP: Run the test suite
```

VS Code and `claude -p` have no band. There, the commands and the toasts are what you see.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| None. No `$.http`. | None. No `$.process`. | Only with `writeFile` on: `$.fs.write` to `<session cwd>/.claude/quicksave/<session-id>.md`. Saves are kept in `$.store` (`slots/<session-id>`, 5 per session, the 20 most recent sessions). The band's state is in `$.state`. | **Yes.** One `$.model.fork` per save: before each main-conversation compaction, on `/quicksave`, and on the band's buttons. The fork is one tool-less request over the session's own transcript, on your own model. | No prompts. `[ SAVE + COMPACT ]` calls `$.session.compact` when you press it, then `$.session.append` once to add the save as a user-role note. | Only the fork request, which goes to your own model provider like any other turn. |

## Limits

- **How the save comes back.** After a compaction, the save is added to the compacted conversation that the `session.compact` hook returns. It is not added with a separate `$.session.append`, because an append made inside the compaction hook would race the transcript being replaced. `$.session.append` is used only after `[ SAVE + COMPACT ]`, where the engine skips quicksave's own compaction hook. If that append is refused, a toast points you to `/quickload 1`.
- **Precompute and subagents.** A `precompute` compaction installs nothing, and the compaction that later uses it runs the hook again, so quicksave waits for that one. Subagents' own compactions are left alone.
- **"Idle" is partial.** The band counts a running turn and running subagents (`$.agent.list`). The mods API does not list background shells or monitors, so the band can show while one of those is running.
- **Cost and delay.** Each save is one extra model request over the whole transcript, made just before compaction. The prompt cache usually serves most of it, but the compaction starts a little later.
- **The save is the model's own account.** quicksave saves only what the model writes from the conversation. It does not read git or your files to check it.
- **Times are UTC.**

## Development

```
claude plugin validate quicksave
claude plugin test quicksave
```

Pure logic lives in `hooks/save.ts` (the save prompt, parsing, slots, the note and the band rule) and `hooks/pixels.ts` (the half-block renderer and the floppy sprite). `hooks/register.tsx` connects them to the engine. The tests answer `$.model.fork` and `session.compact` from test hooks, and mount the band on both `terminal` and `desktop`.
