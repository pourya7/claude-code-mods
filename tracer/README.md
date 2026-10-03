```
▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▀█
 █  █▀▄ █▀█ █▄▄ ██▄ █▀▄   ★ COURSE CLEAR!
```

# tracer — merged is not deployed

**The problem:** a PR merges, the session moves on, and an hour later someone asks why the change is not there. The merge was only the first stage: the build on the merge commit, each deploy and the rollout still had to happen, and one of them failed or never ran. The study behind this library found "merged but I still can't see it" in **34 prompts across 14 sessions**.

tracer follows a merged commit on a timer outside the model, with `gh`: its workflow runs, its GitHub deployments and, optionally, a URL that shows the running version. It draws the chain as a level map, `MERGED ▸ BUILD ▸ DEPLOY:<env> ▸ LIVE`, and wakes the session once, when the chain reaches its last stage or a stage fails.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install tracer@claude-code-mods
```

It needs the [GitHub CLI](https://cli.github.com) on `PATH`, signed in (`gh auth login`).

## Commands

| Command | What it does |
|---|---|
| `/trace 42` | Follow PR #42 in the session's repo (found with `gh repo view`). The PR must be merged; tracer reads its merge commit with `gh pr view 42 --json mergeCommit`. |
| `/trace owner/repo#42`, `/trace https://github.com/owner/repo/pull/42` | Follow a PR in a named repo. |
| `/trace abc1234`, `/trace owner/repo@abc1234`, a commit URL | Follow a commit directly (7 to 40 hex characters, resolved to the full SHA). A bare number is always a PR. |
| `/trace` | Open the tracer pane. |
| `/trace stop`, `/trace stop 42` | Stop every trace, or one (also `[ STOP ]` / `[ CLEAR ]` in the pane). |

## How it decides

Every `intervalSeconds`, each trace still on the road is polled:

- **BUILD.** `gh api repos/<repo>/actions/runs?head_sha=<sha>`. No runs yet, or any run queued or in progress, is pending. It is done when every run finished as `success`, `neutral` or `skipped`. A run waiting for approval (`action_required`) keeps it pending. Any other conclusion (`failure`, `timed_out`, `cancelled`, `startup_failure`, ...) fails it, naming up to three runs.
- **DEPLOY:&lt;env&gt;.** `gh api repos/<repo>/deployments?sha=<sha>`, one stage per environment. The environments in `environments` come first, in that order, and wait even before a deployment exists. Any other environment joins in the order it first appeared. For the newest deployment of each environment, tracer reads its newest status (`deployments/<id>/statuses?per_page=1`): `success` or `inactive` is done, `failure` or `error` fails, anything else (or no status yet) is pending.
- **LIVE** (only when `liveUrl` is set). Once every earlier stage is done, tracer fetches `liveUrl` with `{sha}` and `{short}` filled in. It is live when the response is 2xx and the body holds the full SHA or its 7-character short form, or the `liveMatch` text when that is set. A failed fetch or a non-2xx status stays pending, and tracer tries again on the next poll.

**No deployments configured → BUILD is the final stage.** With `environments` empty, if no deployment of the commit exists by the time its runs pass, the chain ends at BUILD and the wake says `No deployments to follow.` Set `environments` when your deploys appear later than the build (for example from an outside deployer), so tracer waits for them.

**Waking** (`$.prompt.submit`, once per trace):

| When | Prompt |
|---|---|
| LIVE reached | `TRACER: PR #42 (abc1234) is LIVE — MERGED ▸ BUILD ▸ DEPLOY:PRODUCTION ▸ LIVE in 14m.` |
| Last stage reached, no LIVE | `TRACER: PR #42 (abc1234) reached DEPLOY:PRODUCTION — MERGED ▸ BUILD ▸ DEPLOY:PRODUCTION in 9m.` |
| BUILD is the last stage | `TRACER: PR #42 (abc1234) reached BUILD — MERGED ▸ BUILD in 6m. No deployments to follow.` |
| A stage failed | `TRACER: PR #42 (abc1234) FAILED at BUILD — FAILED: "ci". Investigate.` |

Run and environment names come from whoever wrote the workflow, so before they reach a prompt each is cut to plain characters (letters, digits, `space . : / ( ) _ -`) and 40 columns.

**Stopping.** Polling for a trace stops when it is done or failed, or `timeoutMinutes` after `/trace`, which toasts `TRACER #42 TIME UP AT <stage>` and does not wake the session.

**Stopping wins over a poll in flight.** A trace stopped (or started again) while its poll is still waiting on `gh` is not woken, toasted or overwritten when that poll returns. If another hook refuses the wake prompt, tracer toasts `TRACER: wake refused: <reason>`.

**The first poll is a baseline.** `/trace` polls once at once and replies with where the chain stands. If the chain is already at its end (`ALREADY THERE`) or already failed (`ALREADY FAILED`), the reply says so and there is no wake.

**`gh` failures.** A missing `gh`, one that runs past its 30 s limit, and an unauthenticated `gh` each produce a one-line error with the fix:

- `/trace` replies with the error and adds nothing when the PR or commit cannot be resolved.
- During polling, tracer toasts the error once, shows `ERR` on the status line and keeps the trace, so it recovers by itself.

The mod never throws.

## Configuration (`userConfig`)

| Option | Default | Meaning |
|---|---|---|
| `intervalSeconds` | `60` | Seconds between polls (15–3600). |
| `timeoutMinutes` | `120` | Stop following a trace this many minutes after `/trace` (1–1440). |
| `environments` | `""` | Comma-separated deployment environments to wait for, in order, e.g. `staging, production`. Names match without regard to case. Empty: follow whatever deployments appear. |
| `liveUrl` | `""` | Optional URL that shows the running version, e.g. `https://api.example.com/version` or `https://app.example.com/health?v={short}`. `{sha}` and `{short}` are filled in. Empty: no LIVE stage. |
| `liveMatch` | `""` | Optional text the live body must contain instead of the SHA, with `{sha}` and `{short}` filled in, e.g. `"release":"r-{short}"`. |
| `wake` | `final` | `final`: submit the wake line when the chain reaches its last stage or a stage fails. `never`: toast and redraw only. |

## The UI

The pane (`/trace`) shows each trace as a level map. Each stage is a node on a dotted path:

- a yellow coin with a shine: done
- a blue node with a white centre: the stage tracer is waiting on now
- a grey ring: still ahead
- a red cross: failed

The path turns orange where it has been travelled.

When the map is wider than the pane (many environments), the deploy nodes fold into one `DEPLOY` node tagged with how many environments are done, e.g. `2/5`; in a pane too narrow even for that, the map is left out. The per-stage lines under the map always list every stage.

```
T R A C E R  POLL 60S / WAKE FINAL / GIVE UP 120M

#42 Add login retry
▶ ON THE ROAD...  WORLD abc1234 · 6M

  ▄▀▀▀▀▄   ▄▀▀▀▀▄    ▄▀▀▀▀▄    ▄▀▀▀▀▄   ▄▀▀▀▀▄
  ▀▀▀▀▀▀ ▀ ▀▀▀▀▀▀ ▀  ▀▀▀▀▀▀ ▀  ▀▀▀▀▀▀ ▀ ▀▀▄▄▀▀
 ★ MERGED  ★ BUILD  ★ DEPLOY  ● DEPLOY  ● LIVE
                    STAGING   PRODUCT~
★ MERGED abc1234
★ BUILD: 2/2 RUNS PASSED
★ DEPLOY:STAGING: SUCCESS
● DEPLOY:PRODUCTION: IN PROGRESS
● LIVE: WAITS FOR DEPLOY
[ STOP ]
```

A failed build:

```
#42 Add login retry
✕ GAME OVER: BUILD FAILED  WORLD abc1234 · 3M

  ▄▀▀▀▀▄   ▀▀▄▄▀▀
  ▀▀▀▀▀▀ ▀ ▄▀▀▀▀▄
 ★ MERGED  ✕ BUILD
★ MERGED abc1234
✕ BUILD: FAILED: "ci"
[ CLEAR ]
```

These captures are plain text. In the terminal the nodes and labels are drawn in the PICO-8 palette, with tracer's signature yellow. A finished trace reads `★ COURSE CLEAR!` in lime, and a timed-out one `● TIME UP` in orange. With nothing traced, the pane reads `NO COURSE LOADED. /trace 42 TO INSERT COIN`.

Status line (the newest trace, then `+n` more; under 40 columns):

```
TRACER #42 ★★★●● DEPLOY:PRODUCTION
TRACER #42 ★★★★★ CLEAR!
TRACER #42 ★✕ BUILD FAILED
TRACER abc1234 ★● TIME UP
TRACER #42 ★● BUILD ERR
```

A toast fires when a stage moves, e.g. `TRACER #42 ★ BUILD` or `TRACER #42 ✕ DEPLOY:STAGING FAILED`.

VS Code and `claude -p` have no pane, so the status line, the toasts and the `/trace` replies are what you see there.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| Through `gh`, to the GitHub API. One `$.http.fetch` GET of `liveUrl` per poll, only when you set it and only once the earlier stages are done; no credentials are attached. | `gh` only: `gh repo view`, `gh pr view`, `gh api repos/…/commits/<sha>`, `gh api repos/…/actions/runs`, `gh api repos/…/deployments`, `gh api repos/…/deployments/<id>/statuses` | None read or written. The traces live in session state (`$.state`); nothing goes to `$.store`. | No | Yes: one wake line per trace when the chain ends or fails; set `wake: never` to turn it off | Repo name, PR number and commit SHA, sent by `gh` to GitHub under your own `gh` login. The SHA, if your `liveUrl` contains `{sha}` or `{short}`, to the host you configured. The wake prompt goes to your own session's model. |

## Limits

- **One page.** Workflow runs and deployments are read 100 per call, one page. A commit with more than 100 of either is judged on the first 100.
- **GitHub deployments only.** A deploy that never creates a GitHub deployment is invisible to DEPLOY stages. Use `liveUrl` to see it go live instead.
- **Cancelled runs fail BUILD.** A newer merge that cancels this commit's run (a concurrency group) fails the trace; trace the newer commit instead.
- **At most 5 traces** are kept, newest first. Starting a sixth drops the oldest.
- **Session only.** Traces survive a hot reload of the mod, which re-arms the timer, but not a new session.

## Development

```
claude plugin validate tracer
claude plugin test tracer
```

Pure logic lives in `hooks/chain.ts` (stages, outcome and every line of text), `hooks/gh.ts` (what `/trace` accepts, argv builders and output readers) and `hooks/pixels.ts` (the level map and the half-block renderer). `hooks/register.tsx` connects them to the engine. The tests use `mock.clock`, answer `gh` and the live URL through `process.run` and `http.fetch` hooks, and mount the pane on both `terminal` and `desktop`.
