```
█▀▀▀▀ █     ▄▀▀▀▄ █   █ █▀▀▀▄ █▀▀▀▀     █▀▀▀▀ █▀▀▀█ █▀▀▀▄ █▀▀▀▀
█     █     █▀▀▀█ █   █ █   █ █▀▀▀      █     █   █ █   █ █▀▀▀
▀▀▀▀▀ ▀▀▀▀▀ ▀   ▀ ▀▀▀▀▀ ▀▀▀▀  ▀▀▀▀▀     ▀▀▀▀▀ ▀▀▀▀▀ ▀▀▀▀  ▀▀▀▀▀
██      ██  ██████████  ████████    ██████████
████  ████  ██      ██  ██      ██  ██           1UP  ♥♥♥
██  ██  ██  ██      ██  ██      ██  ██████████   6 MODS LOADED
██      ██  ██      ██  ██      ██          ██   PRESS START
██      ██  ██████████  ████████    ██████████   ▶ INSERT COIN
```

**8-bit [Claude Code mods](https://code.claude.com/docs/en/plugins/mods/overview) for long, parallel, mostly unattended work.**

> **Memories are advice. Mods are law.**
>
> A rule written in `CLAUDE.md` or memory is something the model may forget. A mod enforces it at the moment of the tool call.

## Why

Most published mods are dashboards, games or generic guards. These six are mined from a study of **242 sessions, 1,145 subagent runs and 279 memory files**. Each one targets a mistake that kept coming back:

| Pain | Evidence | Mod |
|---|---|---|
| The shell leaves the worktree | 27k of 78.6k Bash calls start with `cd`; 1,859 "shell cwd was reset" notices | anchor |
| Prose rules don't hold | 405 never/don't lines across 189 memory files; 11+ mistakes repeated *after* being written down | tripwire |
| The model does the waiting | ~1.8k poll loops, ~1.5k `sleep`s, ~1.2k CI-status calls; false greens right after a push | sentry |
| Modes typed as preambles | "no code, no commit, no PR" typed in 44 sessions | stance |
| Claims without evidence | "tests pass" / "CI green" after edits with no re-run; 23% of memories are verification traps | anti-cheat |
| Dropped connections | ~120 API connection errors, each followed by a hand-typed "continue" | respawn |

## Select your mod

| Mod | What it fixes | How it shows up | Docs |
|---|---|---|---|
| **anchor** | Pins a session to its git worktree. Every Bash call runs from the anchor, and the primary checkout is guarded against stray edits and git writes. | Status `╋ ANCHOR first-wave@feat/first-wave`, a toast on each block, `/anchor` | [README](anchor/README.md) |
| **tripwire** | Turns the rules you already wrote down into deny / ask / rewrite / note checks on every tool call, subagents included. | Red `TRAP SPRUNG!` band, `/tripwire` pane of armed traps, `/tripwire add <sentence>` | [README](tripwire/README.md) |
| **sentry** | Watches PRs outside the model with `gh` and wakes the session only when something actionable happens. Denies sleep-poll loops while it watches. | Watchtower pane, status `SENTRY #12 CI▓ REV░ 0T`, `/watch`, a `pr_state` tool | [README](sentry/README.md) |
| **stance** | Session modes (investigate, draft, build, ship) that refuse the tool calls they rule out. Switches on phrases like "no code". | Class badge band with `[ INV ] [ DRAFT ] [ BUILD ] [ SHIP ]`, `/stance` | [README](stance/README.md) |
| **anti-cheat** | Flags "tests pass", "CI green" and "verified" claims that nothing in the turn backs up. Deterministic, no model calls. | `FOUL!` referee band with `[ CHALLENGE ] [ OK ]`, a transcript notice | [README](anti-cheat/README.md) |
| **respawn** | Continues a turn that died on a network or API error, with backoff and 3 lives per hour. | Orange `CONTINUE? 9` countdown band, `GAME OVER` when lives run out, `/respawn` | [README](respawn/README.md) |

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

Swap `anchor` for any mod: `tripwire`, `sentry`, `stance`, `anti-cheat`, `respawn`.

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

Editor typings for the mods API come from the engine itself. Run `/plugin-types types` inside Claude Code to write them to `types/`; they are git-ignored and not redistributed. [SPEC.md](SPEC.md) holds the design, the shared 8-bit style guide and each mod's acceptance criteria.

## Security

Mods run inside Claude Code with **your** permissions. Read what you install:

- Every mod README has a **Permissions** table: network, processes, files, model calls, and what leaves your machine.
- `claude plugin validate <mod>` lists the hooks a mod registers and the calls it makes.
- No mod sends data anywhere except your own model and GitHub via your `gh`.
- Three mods can submit a prompt for you, and each can be switched off: sentry's wake (`wake: never`), anti-cheat's challenge (opt-in, `mode: challenge`) and respawn's continue (`/respawn off`).
- No mod approves a permission prompt on your behalf.

## Credits

Colours are the [PICO-8](https://www.lexaloffle.com/pico-8.php) palette by Lexaloffle. Pixels are half-block (`▀`) sprites, two pixel rows per terminal row.

[MIT](LICENSE)
