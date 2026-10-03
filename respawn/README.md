```
█▀█ █▀▀ █▀ █▀█ ▄▀█ █ █ █ █▄ █
█▀▄ ██▄ ▄█ █▀▀ █▀█ ▀▄▀▄▀ █ ▀█   CONTINUE? 9
```

# respawn — continue after a network death

**The problem:** a long, unattended turn dies on an API or connection error, and nothing happens until you come back and type `continue`. The study behind this library counted **~120 API connection errors**, each followed by a hand-typed "continue" or "try again".

respawn watches for a turn that ends with `reason: 'error'` in the main loop, shows an orange arcade `CONTINUE?` countdown, and submits `continue` for you when it reaches zero. It backs off on repeated failures and has a limited number of lives, so it cannot loop forever.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install respawn@claude-code-mods
```

## How it behaves

- **Trigger.** Only a main-loop turn that ends with `reason: 'error'` (an API error that used up its retries) starts a countdown. Answers, interrupts (`aborted`), refusals and subagent turns never do.
- **Backoff.** The countdown waits 10s, then 30s, 60s, 120s and 300s on each failure in a row. It stays at 300s after that.
- **Lives.** Each automatic continue costs one life. You get 3 per rolling hour by default (`♥♥♡`). With no lives left, the band shows `GAME OVER` and respawn does nothing more until you send a prompt yourself. GAME OVER holds even after the hour gives lives back, and a scheduled or background prompt does not end it. While it shows, the band counts down the minutes to the next life and refills the hearts as they return.
- **Cancel.** Any of these stops the countdown and resets the backoff to 10s:
  - typing anything in the prompt box
  - sending a prompt
  - a successful turn (this does not end `GAME OVER`, only your own prompt does)
  - `[GAME OVER]`
  - `/respawn off`
- **Continue now.** `[INSERT COIN]` skips the wait and spends a life. Pressing it twice quickly still sends one continue.
- **Quiet otherwise.** The band appears only while a countdown or `GAME OVER` is showing. It steps aside for a survey and for a subagent's transcript view.

## Commands

| Command | What it does |
|---|---|
| `/respawn` | Shows the state: `READY!`, `CONTINUE? n`, `GAME OVER` or `OFF`, the lives left this hour and the next wait. |
| `/respawn off` | Cancels any countdown and switches respawn off for the rest of the session. |
| `/respawn on` | Switches it back on. |

The band's buttons have hotkeys. Once the band has focus (ctrl+x tab or a click), press `c` for INSERT COIN, `x` for GAME OVER, or `o` for OK.

## Configuration (`userConfig`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `lives` | number | `3` | How many automatic continues respawn may spend in any rolling hour. `0` means it never continues by itself, but still shows `GAME OVER` when a turn dies. |
| `prompt` | string | `continue` | The text respawn submits when the countdown ends. Empty means `continue`. |

You can change these in the `/config` menu, or under `pluginConfigs.respawn` in your settings.

## The 8-bit UI

The band above the prompt during a countdown. The second failure in a row has a 30s wait, with 27s left:

```
▶ CONTINUE? ♥♥♡ 1UP RESPAWN
▄██▄██▄  ▀▀█ ▀▀█  TURN DIED ON AN API ERROR
▀█████▀  █▀▀  ▄▀  SENDING "CONTINUE" IN 27S
  ▀█▀    ███  █   TRY 2 · TYPE ANYTHING TO CANCEL
[ INSERT COIN ] [ GAME OVER ]
```

After three continues inside the same hour:

```
▶ GAME OVER ♡♡♡ 1UP RESPAWN
▄██▄██▄  OUT OF LIVES THIS HOUR
▀█████▀  NEXT LIFE IN 59 MIN
  ▀█▀    TYPE ANYTHING TO PLAY ON
[ OK ]
```

These captures are plain text. In the terminal, the heart is red with a pink shine. The digits are half-block pixels: orange, with a yellow top row and a brown drop shadow. They use the PICO-8 palette.

The status line under the prompt shows the same state in under 40 columns, for example `RESPAWN CONTINUE? 27 ♥♥♡` or `RESPAWN GAME OVER ♡♡♡`. VS Code and `claude -p` have no band, so the status line and `/respawn` are what you see there.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| None. No `$.http`. | None. No `$.process`. | None. No `$.fs`. The state is kept only for the session, in `$.state`. Nothing goes to `$.store`. | No. respawn makes no `$.model` call of its own. | **Yes.** When a countdown ends or you press INSERT COIN, it calls `$.prompt.submit` with the configured prompt (`continue`), as your own words. This is limited by `lives` per hour, and `/respawn off` switches it off. | Only that continue prompt, which goes to your own model as an ordinary turn. |

## Limits

- **Hot reload.** A reload, including the one a `userConfig` change causes, cancels the mod's timers. respawn picks a running countdown up again when it reloads, and submits at once if it fell due while it was reloading.
- **Interrupted turns.** A turn you interrupt (`aborted`) is never retried, even if the network was the cause.

## Development

```
claude plugin validate respawn
claude plugin test respawn
```

Pure logic lives in `hooks/logic.ts` (backoff, lives, transitions and text) and `hooks/pixels.ts` (the half-block sprite renderer and the digit font). `hooks/register.tsx` connects them to the engine. The tests use `mock.clock` and mount the band on both `terminal` and `desktop`.
