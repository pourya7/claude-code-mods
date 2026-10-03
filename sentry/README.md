```
 ███  ████ █   █ █████ ████  █   █      ▀ ▄▀▀▄ ▀
█     █    ██  █   █   █   █  █ █       ▀▀▀▀▀▀▀▀
 ███  ███  █ █ █   █   ████    █         ▀▀▀▀▀▀
    █ █    █  ██   █   █  █    █          ▀▄▄▀
 ███  ████ █   █   █   █   █   █         ▄▀  ▀▄
                                      ▄▄▀▄▄▄▄▄▄▀▄▄
```

# sentry — wait outside the model

**The model does the waiting.** Across 242 studied sessions there were ~1.8k poll loops, ~1.5k `sleep`s and ~1.2k CI-status calls, plus false-greens read right after a push. sentry watches your PRs on a timer with `gh`, never starts a model turn just to poll, and wakes the session only when something actionable happens.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install sentry@claude-code-mods
```

It needs the [GitHub CLI](https://cli.github.com) on `PATH`, signed in (`gh auth login`).

## Commands

| Command | What it does |
|---|---|
| `/watch 42` | Watch PR #42 in the session's repo (found with `gh repo view`). |
| `/watch owner/repo#42`, `/watch https://github.com/owner/repo/pull/42` | Watch a PR in a named repo. |
| `/watch` | Open the sentry pane. |
| `/unwatch 42` | Stop watching PR #42 (or press `[ UNWATCH ]` in the pane). |

The model also gets a **`pr_state`** tool (`mcp__sentry__pr_state`, input `{ pr? }`). It returns the same truth snapshot that sentry polls, for one PR or for every watched PR. The model asks it instead of hand-rolling `gh` calls.

## How it decides

Every `intervalSeconds`, each open watched PR is polled:

- **PR state.** One GraphQL call reads `headRefOid`, `state`, `mergeStateStatus`, `reviewDecision`, `isInMergeQueue`, `mergedAt` and `title`. The same call reads the ids of unresolved `reviewThreads` (`isResolved: false`), paged 100 at a time, so a thread resolved and another opened between two polls still counts as a new thread.
- **CI.** sentry reads every check-run on **the head SHA** (`/commits/<sha>/check-runs?per_page=100`, paged).

The truth rules:

- No check-runs on the head yet means **pending**, never green.
- CI is **green** only when every completed run passed (`success`, `neutral` or `skipped`) and none are queued or in progress. Any completed run with another conclusion is **failed**.
- A head SHA that changed resets CI to pending.
- Check-runs that cannot be read (for example a token without the Checks read permission) are **unknown**, never pending: the status line shows `CI?` and `ERR`, the error is toasted once and `pr_state` says `CI UNKNOWN (check-runs unreadable: …)`.
- The first poll is a baseline. A state is reported once, when the PR enters it, and never again for the same state on the same head.

**Wakes** (`$.prompt.submit`, one line per PR, one prompt per poll):

| Transition | Prompt |
|---|---|
| CI failed | `SENTRY: PR #12 CI FAILED on abc1234 — failed checks: "lint", "unit". Investigate.` |
| Ready (CI green + approved + no open threads) | `SENTRY: PR #12 READY on abc1234 — CI green, approved, no open threads.` |
| Changes requested | `SENTRY: PR #12 CHANGES REQUESTED — address the review.` |
| New unresolved thread | `SENTRY: PR #12 2 OPEN THREADS (+1 new) — address them.` |
| Merged / closed | `SENTRY: PR #12 MERGED. Watch ended.` (polling stops) |

Check names come from whoever wrote the workflow, so before they reach the prompt each is cut to plain characters (letters, digits, `space . : / ( ) -`) and 40 columns, quoted, and at most three are listed, then `+n more`.

Any other change, such as CI starting to run, a new head, approval before CI is green, a thread resolved or merge-queue entry, only redraws and toasts.

**Poll denial.** While any open PR is watched, these Bash shapes are denied with *"sentry is watching PR #12 and will wake you; end your turn instead."*:

- `sleep N` with N ≥ 20 (`20`, `30s`, `1m`, …) run as a command
- `gh pr checks … --watch`
- `gh run watch`
- `until` / `while` loops that run `gh` before their `done`

Quoted text is ignored, so `git commit -m "retry: sleep 30 while loading"` or `gh pr create --title "Wait until gh is up"` still runs. Nothing is denied while no PR is watched.

**`gh` failures.** A missing `gh` (or one that cannot start), a `gh` that runs past its 30 s limit (`gh timed out after 30s (network?)`) and an unauthenticated `gh` each produce a one-line error with the fix:

- `/watch` replies with the error and adds nothing.
- During polling, sentry toasts the error once, shows `ERR` on the status line and keeps the watch, so it recovers by itself.
- `pr_state` returns `{ error }`.

The mod never throws.

## Configuration (`userConfig`)

| Option | Default | Meaning |
|---|---|---|
| `intervalSeconds` | `60` | Seconds between polls (15–3600). |
| `wake` | `actionable` | `actionable`: submit the wake prompt on an actionable transition. `never`: toast and redraw only, never submit a prompt. |

## The UI

The pane (`/watch`) shows a pixel watchtower. Its beacon takes the colour of the worst PR state:

- red: CI failed
- plum: `gh` error
- orange: review needs you
- yellow: on watch
- lime: ready
- lavender: done
- grey: idle

Each PR gets one row of lights.

```
  ▀ ▄▀▀▄ ▀    S E N T R Y
  ▀▀▀▀▀▀▀▀    ★ ALERT! CI FAILED
   ▀▀▀▀▀▀     WATCHING 1
    ▀▄▄▀      POLL 60S / WAKE ACTIONABLE
   ▄▀  ▀▄
▄▄▀▄▄▄▄▄▄▀▄▄

#12 Add login retry
CI ● REVIEW ● THREADS 1 ● QUEUE ● MERGED ●
abc1234 FAILED (lint) [ UNWATCH ]
```

With nothing watched, the pane reads `NO PRS ON WATCH. /watch 42 TO INSERT COIN`.

Status line (the worst PR, then `+n` more):

```
SENTRY #12 CIX REV░ 1T
```

| Glyph | CI | REV |
|---|---|---|
| `▓` | green | approved |
| `?` | unknown (check-runs unreadable) | |
| `▒` | running | |
| `░` | pending (no runs yet) | no decision / review required |
| `X` | failed | changes requested |

A toast fires on every transition, e.g. `SENTRY #12 CI FAILED` or `SENTRY #12 NEW HEAD, CI RESET`.

The watch list lives in session state (`$.state`). It survives a hot reload of the mod but not a new session.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| Only through `gh`, to the GitHub API; the mod makes no HTTP calls of its own | `gh` only: `gh repo view`, `gh api graphql`, `gh api repos/…/check-runs` | None read or written | No | Yes: the one-line wake on an actionable transition; set `wake: never` to turn it off | Repo name, PR number and head SHA, sent by `gh` to GitHub under your own `gh` login. The wake prompt goes to your own session's model. |

## Develop

```
claude plugin validate sentry
claude plugin test sentry
```
