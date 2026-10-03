# stance

```
▄▀▀▀ ▀█▀ ▄▀▀▄ █▄ █ ▄▀▀▀ █▀▀▀
 ▀▀▄  █  █▀▀█ █ ▀█ █    █▀▀
▀▀▀   ▀  ▀  ▀ ▀  ▀  ▀▀▀ ▀▀▀▀   ★ SELECT YOUR CLASS ★
```

**Session modes that are enforced, not requested.** In a study of 242 of the author's own Claude Code sessions, "no code, no commit, no PR" was typed as a preamble in 44 of them. Typing it is a request the model can forget. With stance it is a rule: the tool call is refused before it runs.

| Stance | Badge | What it allows |
|---|---|---|
| `investigate` | magnifier | Findings only. Denies Edit/Write/NotebookEdit (except files under the OS temp dir or a session `scratchpad`), `git commit/push/branch <name>/switch -c/checkout -b/worktree add/merge/rebase/cherry-pick/revert/am`, `gh pr checkout`, every gh send that draft denies, and MCP tools whose name holds a write verb (`send post create save update delete merge comment reply publish`). |
| `draft` | quill | Work locally: no push, PR, issue or MCP post. Denies `git push`; gh write verbs on any noun (`create merge comment review edit close reopen ready delete transfer lock pin upload run rerun cancel set fork rename archive sync enable disable develop add remove ...`, for example `gh pr review`, `gh issue comment`, `gh release create`); `gh api` with a non-GET method or with `-f`/`-F`/`--input` fields (a GraphQL query is allowed, a mutation is not); and MCP write-verb tools. Edits and local commits are fine. |
| `build` | hammer | The default. Stance restricts nothing. |
| `ship` | rocket | Restricts nothing. The band reminds you to verify (tests, CI, review) before merging. |

Every deny names the stance and how to switch, for example:

```
STANCE INVESTIGATE: git commit is off in INVESTIGATE stance (findings only: no edits, commits or PRs).
Report instead, or ask the person to switch with /stance draft or /stance build.
```

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install stance@claude-code-mods
```

## Commands

| Command | What it does |
|---|---|
| `/stance` | Shows the current stance and who set it: `(default)`, `(auto-detected)` or `(set by you)`. |
| `/stance <name>` | Switches to `investigate` (or `inv`), `draft`, `build` or `ship`. Runs at once, even mid-turn. |

**Auto-detect.** When you type a prompt, these phrases (any case) switch the stance and toast `STANCE → INVESTIGATE`:

- `investigation task`, `investigation only`, `no code`, `no commit(s)`, `no PR(s)`, `findings only` switch to **investigate**.
- `do not send/post/reply` (or `don't`), `draft only` switch to **draft**.

When both kinds match, the stricter stance (investigate) wins. Auto-detect only reads prompts you typed (terminal, Remote Control or SDK), not peer or task messages. It can tighten the stance you chose with `/stance` or a band button, and it may loosen a stance it set itself, but never below the one you chose. When a phrase asks for less than your choice it toasts `STANCE KEPT: INVESTIGATE (SET BY YOU)`, naming the stance you chose.

**Telling the model.** Outside `build`, every prompt carries a short note with the stance's rules as prompt context. `/stance <name>` also leaves that note for the model. A subagent spawned with the Agent tool gets the note at the top of its prompt, and the subagent's own tool calls go through the same checks.

## Config

| Option | Default | What it does |
|---|---|---|
| `autoDetect` | `true` | Switches stance when a prompt uses one of the phrases above. |
| `showBuild` | `false` | Shows the band in `build` too. By default the band hides in `build`. |

## The band

The band sits above the prompt: the class badge in half-block pixels, the stance name in its colour (investigate blue, draft yellow, build orange, ship lime), a one-line rule, and buttons that switch on click. With the band focused (ctrl+x tab), the hotkeys `i`, `d`, `b` and `s` press them. The band hides in `build` and while a survey is showing. In VS Code and `claude -p`, where no band draws, the status line reads `STANCE ▶ INVESTIGATE` and `/stance` answers in text.

Text capture of the band on the terminal (colours dropped):

```
▄▀▀█▀▄    STANCE ★ INVESTIGATE
██████    FINDINGS ONLY. NO EDITS, COMMITS OR PRS.
 ▀▀▀▀▄    [ INV ] [ DRAFT ] [ BUILD ] [ SHIP ]
     ▀█▄
```

The other badges:

```
 draft      build      ship
     ▄▀█   █▀▀▀▀▀█      ▄██▄
   ▄▀▀▀    ▀▀▀▀▀▀▀      █▀▀█
  █▀▀         ██       ▄████▄
▄▀            ██       ▀ ▀▀ ▀
```

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| None | None | None read or written. It reads only the `TMPDIR` variable, to know which paths count as temp. | No | No | None. Outside `build`, the stance note is added to your own prompts and Agent prompts, which go to your own model as usual. |

State: the stance lives in session state (`$.state`, `stance.current`) and resets with each new session.

## Limits

- Bash is checked by parsing commands for `git` and `gh`. The parser respects quotes and splits on `;`, `&`, `|`, newlines, subshells `( )`, groups `{ }`, `$( )` and backticks (also inside double quotes). It drops env assignments and wrappers (`env sudo nice nohup time timeout xargs command exec stdbuf`), takes the basename of the command (`/usr/bin/git`), opens `sh/bash/zsh -c '...'` and `eval ...`, skips `git -C dir`/`-c k=v`, and reads attached short flags (`checkout -bfoo`). Not caught: aliases and shell functions, scripts and Makefiles, `git` reached through a variable (`$G push`) or another interpreter (`python -c`, `node -e`), here-docs fed to a shell, and `git` plumbing that writes refs (`update-ref`, `commit-tree`). The check is a seatbelt, not a sandbox.
- Only Bash, the edit tools and MCP tools are checked. Built-in tools such as SendMessage (messages to other agents in the session) stay allowed in every stance, so a subagent can still report back.
- Investigate does not stop Bash from writing files (`echo > file`). It stops the edit tools.
