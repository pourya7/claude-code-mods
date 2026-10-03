```
█▀▄ █▀█ █▀▀ █▄▀
█▄▀ █▄█ █▄▄ █ █   HEADROOM 1.5 GIB ▶ LOW FUEL
```

# dock — container stacks per worktree

**The problem:** every git worktree boots its own `docker compose` stack, and nobody counts them. Delete a worktree and its stack keeps running, holding memory for code that no longer exists. Boot one more and the machine falls over. The study behind this library found **10 parallel container stacks crashing a machine**, and orphaned stacks left behind by deleted worktrees.

dock shows every compose stack on the machine with the worktree it was booted from and the memory it uses, marks the ones whose worktree is gone as `ORPHAN`, and asks you before a new stack boots when the engine's memory headroom is low. It only reads docker. It never stops, removes or boots anything itself.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install dock@claude-code-mods
```

## How it behaves

- **The pane.** `/dock` opens a pane and reads docker: compose projects (`docker compose ls`), containers and their compose labels (`docker ps`), per-container memory (`docker stats`) and the engine's total memory (`docker info`). It reads again every `intervalSeconds` (30 by default) while the pane is open, and never while it is closed. Only one read runs at a time: if docker is slow to answer, the next refresh, `[ RESCAN ]`, `/dock` and the guard wait for the read already running instead of starting another.
- **Rows.** One row per compose project, biggest first: its name, its state (`UP 2`, `UP 1 OFF 1`, `OFF 3`), a memory bar sized by its share of the engine, and its memory in GiB. Under it is the worktree it was booted from: the compose label `com.docker.compose.project.working_dir`, or the compose file's folder when no container carries the label. A `◆` marks the stack booted from this session's directory: the stack whose working directory is the deepest one holding it. A session in `~/work/app/.worktrees/feature-x` marks the `feature-x` stack, not the main checkout's `app` stack too.
- **Orphans.** When a stack's working directory no longer exists on disk, the row says `ORPHAN` in red. That is usually a stack from a deleted worktree.
- **Fuel gauge.** The header shows memory in use against the engine total as a pixel-art gauge, with a red mark where the headroom drops below `minHeadroomGiB`. Headroom is the engine total minus what every running container uses, compose or not. The gauge and the headroom turn red when you are below the minimum.
- **Guard.** When the model runs a Bash command containing `docker compose up` or `docker-compose up` (with any flags, after `cd … &&`, `sudo` or `VAR=1`), dock reads docker first. If the headroom is below `minHeadroomGiB` (3 GiB by default), the call turns into a permission ask that names the biggest stacks and the command that would free the biggest one. At or above the minimum, the call goes ahead untouched. Other commands are never probed. A plugin that only asks for a verdict (`$.tool.check`, where nothing runs) gets the same answer from dock's last read, with no new docker read and no toast; dock reads docker for it only when it has not read docker yet this session.
- **DOWN.** Each row has a `[ DOWN ]` button. It copies the exact command, such as `docker compose -p feature-x down`, to your clipboard and shows it in a toast. Where no clipboard is available, it puts the command in your prompt box instead, but only when the box is empty: a draft you are typing is never touched, and the toast shows the command for you to run. dock never runs it: you decide.
- **No docker.** If docker is not installed, or the daemon is not running, the pane and `/dock` say so, and the guard steps aside.

## Commands

| Command | What it does |
|---|---|
| `/dock` | Opens the pane, reads docker now, and replies with the same facts as text: memory used, headroom, one line per stack, and the command to free a running orphan. |

Pane buttons: `[ DOWN ]` per stack, `[ RESCAN ]` (hotkey `r`) and `[ CLOSE ]` (hotkey `x`). Hotkeys work once the pane has focus.

## Configuration (`userConfig`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `intervalSeconds` | number | `30` | How often the pane reads docker again while it is open (5 to 3600). |
| `guard` | boolean | `true` | Ask before a Bash `docker compose up` / `docker-compose up` when the headroom is low. Off means dock never reads docker unless you open the pane. |
| `minHeadroomGiB` | number | `3` | The free engine memory, in GiB, below which the guard asks. |

You can change these in the `/config` menu, or under `pluginConfigs.dock` in your settings.

## The UI

The pane with three stacks, one of them an orphan holding 4 GiB, on an 8 GiB engine:

```
▀▀▀▀▀▀▀▀▀▀▀▀  D O C K
 ▀ ▀   ▀▀▀    MEM ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀ 6.5/8.0 GIB
▄▀▄▀▀▀▄▀▀▀▄▄  HEADROOM 1.5 GIB ▶ LOW FUEL (MIN 3)

  feature-x UP 1 OFF 1 ▀▀▀▀▀▀▀▀  4.0G [ DOWN ]
    ORPHAN /work/app/.worktrees/feature-x

◆ app       UP 2       ▀▀▀▀▀▀▀▀  2.0G [ DOWN ]
    /work/app

  api       OFF 2      ▀▀▀▀▀▀▀▀  0.0G [ DOWN ]
    /work/api

[ RESCAN ] [ CLOSE ] EVERY 30S WHILE OPEN · DOWN COPIES, NEVER RUNS
```

The guard's ask, when the model tries `docker compose up -d` in that state:

```
DOCK: LOW FUEL. Only 1.5 GiB free of 8.0 GiB; the minimum before booting another stack is 3 GiB.
Biggest stacks: feature-x 4.0 GiB (ORPHAN), app 2.0 GiB.
To free memory first: docker compose -p feature-x down
```

The `/dock` reply:

```
DOCK: 6.5 of 8.0 GiB used, 1.5 GiB headroom. LOW FUEL (under 3 GiB).
feature-x  UP 1 OFF 1    4.0 GiB  ORPHAN (/work/app/.worktrees/feature-x is gone)
app        UP 2          2.0 GiB  /work/app
api        OFF 2         0.0 GiB  /work/api
Free an orphan: docker compose -p feature-x down
```

These captures are plain text. In the terminal, the crane is navy with a blue container stack and an orange container on the hook. The gauge and bars are half-block pixels with a lit top row and a shadow row: blue while there is fuel, red past the red mark. Everything uses the PICO-8 palette.

VS Code and `claude -p` draw no pane, so the `/dock` reply and the guard's ask are what you see there.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| None. No `$.http`. | **Yes, four read-only docker commands, and nothing else:** `docker info --format json`, `docker compose ls --all --format json`, `docker ps --all --no-trunc --format json` and `docker stats --no-stream --format json`. They run on `/dock`, on `[ RESCAN ]`, every `intervalSeconds` while the pane is open, and before each Bash `docker compose up` while `guard` is on. dock never runs `down`, `stop`, `rm`, `kill`, `prune` or `up`. | Checks whether each stack's working directory exists (`$.fs.exists`). Reads and writes no files. The last scan and the session's directory are kept for the session in `$.state`. Nothing goes to `$.store`. | No. dock makes no `$.model` call. | No. `[ DOWN ]` copies a command to your clipboard, or puts it in an empty prompt box when there is no clipboard (it reads the box first, with `$.prompt.read`, so it never overwrites a draft). It never sends it. | None of its own. The `/dock` reply is a command output the model reads, and the guard's ask reason (stack names, sizes, paths) goes to whatever decides permissions in your mode: the dialog, or the auto-mode classifier. |

## Limits

- **The guard reads the command text.** It sees `docker compose up` and `docker-compose up` typed into a Bash call. A stack booted by a script (`make up`, `npm run dev`) or by you outside Claude Code is not guarded, though it shows in the pane.
- **What headroom means.** It is the engine's `MemTotal` (the Docker Desktop VM's memory, or the host's on Linux) minus what running containers use now. It does not count the engine's own overhead, build caches, or memory a container will grow into after it boots.
- **Orphans are judged on this disk.** A stack on a remote docker context, or one whose folder was moved, also reads `ORPHAN`. A stack whose working directory dock cannot find out reads `WORKTREE UNKNOWN`, never `ORPHAN`.
- **`docker stats` is slow.** It samples for about two seconds, so each scan, and each guarded `compose up`, waits that long.
- **Hot reload.** A reload cancels the refresh timer. dock arms it again when it reloads if the pane is still open.
- **Asks follow your mode.** dock answers `ask`; who answers that is your session's permission decider (the dialog, the auto-mode classifier, or a headless host), not dock.

## Development

```
claude plugin validate dock
claude plugin test dock
```

Pure logic lives in `hooks/docker.ts` (the read-only probes, output parsers, stack joining, orphan marking, headroom and compose-up detection), `hooks/text.ts` (the guard's ask and the `/dock` reply) and `hooks/pixels.ts` (the half-block renderer, the crane, the fuel gauge and memory bars). `hooks/register.tsx` connects them to the engine. The tests answer `process.run` from recorded docker output, use `mock.clock` for the refresh timer, check that every docker command dock runs only reads, and mount the pane on both `terminal` and `desktop`.
