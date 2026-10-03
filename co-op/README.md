```
█▀▀ █▀█ ▄▄ █▀█ █▀█
█▄▄ █▄█    █▄█ █▀▀   2P REVIEW
```

# co-op — a second player reviews before the PR

**The problem:** one agent's word isn't enough. Before opening a pull request you want a second model to read the diff, so you paste it into another tool or script a reviewer by hand, every time. The study behind this library counted **~1,600 second-model review runs typed or scripted by hand before PRs**.

co-op makes that review part of the game. When anything in the session runs `gh pr create` (the main loop or a subagent), co-op first takes `git diff <base>...HEAD`, hands it to a second player (another model, or a command you choose), and reads back a JSON verdict. A failing review with a high-severity finding blocks the PR, and the model gets the findings so it can fix them. Anything less goes through, with the findings attached as notes the model reads.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install co-op@claude-code-mods
```

## How it behaves

- **Trigger.** A Bash call that runs `gh pr create` or gh's own alias `gh pr new`: `gh` by name or by path (`/opt/homebrew/bin/gh`), with or without `-R owner/repo`, at the start of the command or after `;`, `&&`, `||`, `|`, `(` or a newline, past env assignments and words like `command` or `then`. Text that only mentions it does not count: quoted strings (a commit message such as `git commit -m "... gh pr create ..."`), heredoc bodies and `--help` / `-h` pass through. A `$(gh pr create)` inside double quotes still counts, since the shell runs it. Every other command passes through untouched, with no git call and no model call.
- **The diff.** co-op runs `git diff --no-color --no-ext-diff <base>...HEAD` in the directory the command runs in (a leading `cd <dir> &&` is followed). The base is found in this order:
  1. the command's `--base` / `-B` branch, as `origin/<branch>` if that exists, else the local branch
  2. `origin/HEAD`
  3. the first of `origin/main`, `origin/master`, `main`, `master` that exists
- **Truncation.** A diff over `maxDiffKb` is cut at the last whole line under the limit. The reviewer is told it is looking at a truncated diff, and the deny text, the notes and the band all say so.
- **The reviewer.** By default `$.model.complete` with a strict review prompt. With `model` left empty, co-op picks another tier than the session's model, so a second player really is a different player: `opus` reviews a `sonnet` session, and `sonnet` reviews an `opus` or `haiku` session. Any other model name means the session's own model reviews. With `command` set, that command runs instead (see below).
- **The verdict.** The reviewer must answer `{"verdict": "pass" | "fail", "findings": [{"severity", "file", "line", "summary"}]}`. co-op takes the first `{` to the last `}` of the reply, so prose or a code fence around the JSON is fine. Severities like `critical`, `major` or `nit` are mapped onto `high`, `medium` and `low`.
- **The gate.**

  | Verdict | What happens to `gh pr create` |
  |---|---|
  | `fail` with at least one `high` finding | **Denied.** The model reads the findings as the deny text, with the way out. |
  | `fail` with no `high` finding | Runs. The findings are attached as a note the model reads ("not blocking"). |
  | `pass` | Runs. Any findings are attached as a note. |
  | Unreadable (no JSON, bad verdict, API error, refused model, git failure, command error, timeout) | Runs, with a toast and a note saying the review could not be used. co-op **fails open** and never blocks forever. |
  | No diff against the base | Runs. Nothing is sent for review. |

- **Re-review after fixes.** The next `gh pr create` reviews again. If the diff, base, reviewer and `maxDiffKb` are exactly the same as the last real verdict, co-op reuses that verdict instead of paying for the same review twice. The whole diff is compared, including any part past the `maxDiffKb` cut, so change the code anywhere and the new diff is reviewed. An unreadable review is never reused.
- **Skip.** `/coop skip` lets exactly the next `gh pr create` through unreviewed. The one after that is reviewed again.

## Commands

| Command | What it does |
|---|---|
| `/coop` | Reviews this branch now (always a fresh review, never the cached one), opens the 2P REVIEW pane and replies with the verdict. It gates nothing. |
| `/coop skip` | Lets the next `gh pr create` through without a review. |
| `/coop unskip` | Takes the skip back. |
| `/coop view` | Opens the pane with the last review. |

The band's buttons have hotkeys once the band has focus (ctrl+x tab or a click): `v` for VIEW, `o` for OK.

## Configuration (`userConfig`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `model` | string | `""` | The reviewer model. Empty picks another tier than the session's model, else the session's model. |
| `command` | string | `""` | Optional reviewer command line, run instead of the model. Split on spaces (quotes group words), run without a shell, in the repo's directory. **Its stdin gets the full review prompt with the diff inside**, and its stdout must hold the same JSON verdict. A non-zero exit counts as unreadable. |
| `maxDiffKb` | number | `200` | The diff is cut at a line boundary below this many kilobytes. |
| `timeoutSeconds` | number | `180` | How long the reviewer (model or command) may take before the review counts as unreadable. Clamped to 10–600. |

You can change these in the `/config` menu, or under `pluginConfigs.co-op` in your settings.

> **About `command`:** co-op sends your diff to whatever that command talks to. If it calls a hosted model or service, your code goes there. Only point it at a tool you would paste the diff into yourself.

An example that uses another CLI as the second player, assuming it reads a prompt on stdin and prints the answer: `my-reviewer --json -`.

## The UI

The band above the prompt after a blocked PR:

```
▄▀▀▀▄ ▄▀▀▀▄   ▶ 2P REVIEW  FAIL
▄▀▀▀▄ ▄▀▀▀▄  ● 1 HIGH  ● 0 MED  ● 1 LOW  VS origin/main
 ▀ ▀   ▀ ▀   GH PR CREATE BLOCKED · FIX IT, OR /coop skip
[ VIEW ] [ OK ]
```

After a pass:

```
▄▀▀▀▄ ▄▀▀▀▄   ▶ 2P REVIEW  PASS ★
▄▀▀▀▄ ▄▀▀▀▄  ● 0 HIGH  ● 0 MED  ● 0 LOW  VS origin/main
 ▀ ▀   ▀ ▀   PLAYER 2 APPROVES · PR LET THROUGH
[ VIEW ] [ OK ]
```

While the review runs, the band reads `REVIEWING...` and `PLAYER 2 IS READING THE DIFF`, with no buttons. A truncated diff adds `· DIFF CUT AT 200 KB` to the second line.

`[ VIEW ]` opens the pane with every finding:

```
▄▀▀▀▄ ▄▀▀▀▄   2P REVIEW  FAIL
▄▀▀▀▄ ▄▀▀▀▄  model:sonnet · VS origin/main · 2 KB
 ▀ ▀   ▀ ▀   ● 1 HIGH  ● 0 MED  ● 1 LOW
────────────────────────────────────────────────────────────
HIGH src/pay.ts:41
     Refund charges the customer instead.
LOW  src/pay.ts
     No log line.

[ SKIP NEXT ] GH PR CREATE IS REVIEWED FIRST
```

These captures are plain text. In the terminal the two players are half-block pixels: player one in light grey, player two (the reviewer) in co-op blue, both with peach faces. The title is white on blue, `FAIL` is red, `PASS ★` is lime, `FLAGGED` is orange, and severities are red (HIGH), orange (MED) and yellow (LOW). They use the PICO-8 palette.

The status line under the prompt stays under 40 columns: `CO-OP ▸ READY`, `CO-OP ▸ REVIEWING`, `CO-OP ▸ PASS`, `CO-OP ▸ FAIL 1H 1L`, `CO-OP ▸ FLAGGED 1M`, `CO-OP ▸ NO REVIEW`, `CO-OP ▸ SKIP NEXT`, `CO-OP ▸ SKIPPED` or `CO-OP ▸ NO DIFF`. Each review also ends with a toast such as `CO-OP ▸ 2P SAYS FAIL 1H 1L · PR BLOCKED`. VS Code and `claude -p` have no band or pane, so the status line, the toasts and `/coop`'s text reply are what you see there.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| None of its own. No `$.http`. | **Yes**, via `$.process.run`, only when a `gh pr create` is seen or `/coop` runs: `git rev-parse --verify --quiet <ref>^{commit}`, `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` and `git diff --no-color --no-ext-diff <base>...HEAD`, all read-only. If you set `command`, that command too, with the review prompt on stdin. | None. No `$.fs`. It reads `HOME` (`$.env.get`) only to expand a `~` in a leading `cd`. The last review and the skip flag are kept only for the session, in `$.state`. Nothing goes to `$.store`. | **Yes.** One `$.model.complete` per review, unless `command` is set (none then), and none when the same diff's verdict is reused. It reads `$.session.model` to pick the reviewer tier. | **No.** co-op never calls `$.prompt.submit`. | The diff (up to `maxDiffKb`) inside the review prompt, sent to your own model through the session's own client. With `command` set, it goes to whatever that command sends it to instead. |

## Limits

- **Only `gh pr create` / `gh pr new` in Bash is gated.** A PR opened another way (an MCP tool, the web, `gh api`, your own gh alias or a script that hides those words, `xargs gh ...`, or a quoted path such as `"/my bin/gh" pr create`) is not reviewed. Run `/coop` by hand for those. The command line is read with a light shell reading (quotes, escapes, heredocs), not a full parser.
- **The deny cannot carry a separate note.** The engine's deny result has no `context` field, so on a block the findings are in the deny text itself. Notes are attached only when the PR goes through.
- **The diff is the committed branch.** Uncommitted changes are not in `<base>...HEAD`, and neither is a `--head` branch other than the checked-out one.
- **The reviewer is advisory, not a sandbox.** The diff is untrusted text inside a prompt. The prompt tells the reviewer to treat it as data, but a diff written to fool a reviewer could still talk it into a pass.
- **Fail open.** Anything that stops a review (no base found, git or the reviewer failing, a timeout) lets the PR through with a toast and a note. co-op is a second opinion, not a lock.
- **Model names.** The default tier swap matches `opus`, `sonnet` and `haiku` in the session's model name. Any other name falls back to the session's own model.
- **Time.** `gh pr create` waits for the review, up to `timeoutSeconds`. Interrupting it (escape) cuts the model call; the review is dropped with no toast and no verdict, and `gh pr create` does not run. A reviewer `command` cannot be cut this way (`$.process.run` takes no signal), so it runs to its end or to `timeoutSeconds`, and its result is dropped the same way.

## Development

```
claude plugin validate co-op
claude plugin test co-op
```

Pure logic lives in `hooks/review.ts` (spotting `gh pr create`, reading `--base` and a leading `cd`, cutting the diff, the review prompt, parsing the verdict, the gate), `hooks/text.ts` (status, deny text and notes) and `hooks/pixels.ts` (the half-block sprite renderer and the two players). `hooks/register.tsx` connects them to the engine. The tests answer `git`, the reviewer command and the model from a fake world, cover every gate outcome, and mount the band and the pane on both `terminal` and `desktop`.
