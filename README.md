```
█▀▀▀▀ █     ▄▀▀▀▄ █   █ █▀▀▀▄ █▀▀▀▀     █▀▀▀▀ █▀▀▀█ █▀▀▀▄ █▀▀▀▀
█     █     █▀▀▀█ █   █ █   █ █▀▀▀      █     █   █ █   █ █▀▀▀
▀▀▀▀▀ ▀▀▀▀▀ ▀   ▀ ▀▀▀▀▀ ▀▀▀▀  ▀▀▀▀▀     ▀▀▀▀▀ ▀▀▀▀▀ ▀▀▀▀  ▀▀▀▀▀
██      ██  ██████████  ████████    ██████████
████  ████  ██      ██  ██      ██  ██           1UP  ♥♥♥
██  ██  ██  ██      ██  ██      ██  ██████████   15 MODS LOADED
██      ██  ██      ██  ██      ██          ██   PRESS START
██      ██  ██████████  ████████    ██████████   ▶ INSERT COIN
```

**[Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview) for long, parallel, mostly unattended work.**

> **Memories are advice. Mods are law.**
>
> A rule written in `CLAUDE.md` or memory is something the model may forget. A mod enforces it at the moment of the tool call.

## Why

Most published mods are dashboards, games or generic guards. These fifteen are mined from a study of the author's own **242 Claude Code sessions, 1,145 subagent runs and 279 memory files**. Each one targets a mistake that kept coming back:

| Pain | Evidence | Mod |
|---|---|---|
| The shell leaves the worktree | 27k of 78.6k Bash calls start with `cd`; 1,859 "shell cwd was reset" notices | anchor |
| Prose rules don't hold | 405 never/don't lines across 189 memory files; 11+ mistakes repeated *after* being written down | tripwire |
| The model does the waiting | ~1.8k poll loops, ~1.5k `sleep`s, ~1.2k CI-status calls; false greens right after a push | sentry |
| Modes typed as preambles | "no code, no commit, no PR" typed in 44 sessions | stance |
| Claims without evidence | "tests pass" / "CI green" after edits with no re-run; 23% of memories are verification traps | anti-cheat |
| Dropped connections | ~120 API connection errors, each followed by a hand-typed "continue" | respawn |
| The right memory isn't there when it matters | 11+ mistakes recurred after being written down; ~2.7k tokens of memory index loaded into every session regardless of relevance | radar |
| Compaction loses the plot | 91 compactions; summaries rewritten by hand; "is now a safe time to compact?" asked again and again | quicksave |
| Parallel sessions block on you and collide | up to 5–10 sessions at once; ~190 h spent waiting on a human answer; two sessions acted on the same PR | party |
| Checks that pass without checking | 64 memory notes are verification traps: zero-iteration gates, no-op "proofs", tests that pass with the fix removed | prove-it |
| One agent's word isn't enough | ~1,600 second-model review runs typed or scripted by hand before PRs | co-op |
| The shell lies quietly | 186 zsh "no matches found" (the command never ran); exit codes hidden by pipes; `exit=$?` echoed ~1,000× | honest-exit |
| Local stacks eat the laptop | 10 parallel container stacks crashed a machine; orphaned stacks from deleted worktrees | dock |
| Merged is not deployed | "merged but I still can't see it" in 34 prompts across 14 sessions | tracer |
| MCP calls fail on argument shapes | ~65 schema errors (unknown keys, `"true"` for `true`, numbers as strings) | mender |

## Select your mod

| Mod | What it fixes | How it shows up | Docs |
|---|---|---|---|
| **anchor** | Pins a session to its git worktree. Every Bash call runs from the anchor, and the primary checkout is guarded against stray edits and git writes. | Status `╋ ANCHOR fix-login@fix/login`, a toast on each block, `/anchor` | [README](anchor/README.md) |
| **tripwire** | Turns the rules you already wrote down into deny / ask / rewrite / note checks on every tool call, subagents included. | Red `TRAP SPRUNG!` band, `/tripwire` pane of armed traps, `/tripwire add <sentence>` | [README](tripwire/README.md) |
| **sentry** | Watches PRs outside the model with `gh` and wakes the session only when something actionable happens. Denies sleep-poll loops while it watches. | Watchtower pane, status `SENTRY #12 CI▓ REV░ 0T`, `/watch`, a `pr_state` tool | [README](sentry/README.md) |
| **stance** | Session modes (investigate, draft, build, ship) that refuse the tool calls they rule out. Switches on phrases like "no code". | Class badge band with `[ INV ] [ DRAFT ] [ BUILD ] [ SHIP ]`, `/stance` | [README](stance/README.md) |
| **anti-cheat** | Flags "tests pass", "CI green" and "verified" claims that nothing in the turn backs up. Deterministic, no model calls. | `FOUL!` referee band with `[ CHALLENGE ] [ OK ]`, a transcript notice | [README](anti-cheat/README.md) |
| **respawn** | Continues a turn that died on a network or API error, with backoff and 3 lives per hour. | Orange `CONTINUE? 9` countdown band, `GAME OVER` when lives run out, `/respawn` | [README](respawn/README.md) |
| **radar** | Matches each tool call against your memory files and attaches the relevant memory's description and rules to the result, for the model only. Never edits a memory. | Toast `RADAR ▸ <memory>`, lavender radar scope in the `/radar` pane, status `RADAR 274 ◉ 3 PINGS` | [README](radar/README.md) |
| **quicksave** | Saves the goal, step, branch, links, decisions, rules and next step before every compaction and hands them back to the model after it. | Green `SAVE POINT ▸ safe to /compact` band with `[ SAVE ] [ SAVE + COMPACT ]`, `/quicksave`, `/quickload` | [README](quicksave/README.md) |
| **party** | One view of every live session on the machine: who is working, who is waiting on you and for how long. Per-PR locks so two sessions never act on one PR. | Raid-frame `/party` pane with HP-style wait bars, status `PARTY 3 ▸ 1 WAITING`, `/broadcast` | [README](party/README.md) |
| **prove-it** | Reverts your source changes, requires the changed tests to fail, restores (verified by hash) and requires a pass. Optional gate on `git push` and `gh pr create`. | `PROVEN ★` / `NOT PROVEN` / `BROKEN` verdict band, `/prove`, `/prove skip` | [README](prove-it/README.md) |
| **co-op** | A second model reviews the branch diff before `gh pr create`; a failing review with a high finding blocks the PR. Fails open. | Blue `2P REVIEW` band with `[ VIEW ]`, findings pane, status `CO-OP ▸ PASS`, `/coop` | [README](co-op/README.md) |
| **honest-exit** | Makes silent shell failures loud: a glob that matched nothing, a missing aliased command, a pipe that hid a failing exit status. | Peach `HONEST EXIT` toast, status `EXIT ▸ 3 CAUGHT`, `/honest-exit` pane | [README](honest-exit/README.md) |
| **dock** | Every compose stack with its worktree and memory, orphans whose worktree is gone, and an ask before booting another stack when headroom is low. Read-only. | `/dock` pane with a fuel gauge, `ORPHAN` rows, `[ DOWN ]` copies the command | [README](dock/README.md) |
| **tracer** | Follows a merged PR or commit through its workflow runs, deployments and an optional live URL, and wakes the session once when it is live or a stage fails. | Level map `MERGED ▸ BUILD ▸ DEPLOY ▸ LIVE`, `/trace <pr\|sha>` | [README](tracer/README.md) |
| **mender** | Repairs malformed MCP tool arguments against the tool's own schema before the call, tells the model what it fixed, and flags servers that are down. | Toast `MENDER ▸ <SERVER> DOWN`, `/mender` patch log pane, status `MENDER ▸ 3 FIXED` | [README](mender/README.md) |

Every mod is a standalone plugin. Install one, some or all; none depends on another.

```
▀▀▀▀▀▀▄  FOUL! REFEREE REVIEW · 1 UNVERIFIED CLAIM
▀▀▀▀▀▀▀  ⚑ FOUL: "All tests pass" — no test ran after the last edit
▀        [ CHALLENGE ] [ OK ]
▀▄▄
```

## Install

Requires **Claude Code 2.1.287 or later**.

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install anchor@claude-code-mods
/reload-plugins
```

Swap `anchor` for any mod: `tripwire`, `sentry`, `stance`, `anti-cheat`, `respawn`, `radar`, `quicksave`, `party`, `prove-it`, `co-op`, `honest-exit`, `dock`, `tracer`, `mender`.

## Try from source

```bash
git clone https://github.com/pourya7/claude-code-mods
cd claude-code-mods
claude --plugin-dir ./anchor
```

## Develop

```bash
scripts/check.sh                 # validate + test every mod; prints ALL CLEAR or FAILED
claude plugin validate anchor    # one mod: manifest and module checks
claude plugin test anchor        # one mod: runs anchor/tests/*.test.ts
```

Editor typings for the mods API come from the engine itself. Run `/plugin-types types` inside Claude Code to write them to `types/`; they are git-ignored and not redistributed. [SPEC.md](SPEC.md) holds the design, the shared visual style guide and each mod's acceptance criteria.

## Security

Mods run inside Claude Code with **your** permissions. Read what you install:

- Every mod README has a **Permissions** table: network, processes, files, model calls, and what leaves your machine.
- `claude plugin validate <mod>` lists the hooks a mod registers and the calls it makes.
- No mod sends data anywhere except your own model and GitHub via your `gh`, unless you set co-op's optional review `command`, which receives the branch diff.
- Three mods can submit a prompt for you, and each can be switched off: sentry's wake (`wake: never`), anti-cheat's challenge (opt-in, `mode: challenge`) and respawn's continue (`/respawn off`).
- party's `/broadcast` sends your text to your other sessions only when you run it.
- No mod approves a permission prompt on your behalf.

## Credits

Colours are the [PICO-8](https://www.lexaloffle.com/pico-8.php) palette by Lexaloffle. Pixels are half-block (`▀`) sprites, two pixel rows per terminal row.

[MIT](LICENSE)
