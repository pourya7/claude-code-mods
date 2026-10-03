# prove-it

```
█▀█ █▀█ █▀█ █ █ █▀▀ ▄▄ █ ▀█▀      ▀▀
█▀▀ █▀▄ █▄█ ▀▄▀ ██▄    █  █    ▀▀▀▀▀▀▀▀   THE FIX MUST MAKE
                                ▄▀▀▀▀▄    A TEST FAIL FIRST
                               ▄▀▀  ▀▀▄
```

![prove-it reverting a fix, seeing the new test fail, restoring it and showing PROVEN](../assets/prove-it.gif)

**A test that passes with the fix removed proves nothing.** prove-it puts your changed source files back to how they were at the merge base, runs the changed tests and requires them to **fail**, puts your files back (checked by hash), runs the tests again and requires them to **pass**.

**The problem, in one line:** 64 memory notes in the study behind this library were verification traps: gates that ran zero times, "proofs" that checked nothing, and tests that passed with the fix removed.

## Install

```
/plugin marketplace add pourya7/claude-code-mods
/plugin install prove-it@claude-code-mods
```

Then set `testCommand` in `/config` (for example `npm test --` or `pytest`) and run `/prove`.

## How a proof runs

1. **Measure the change.** The base is the merge base of `HEAD` and the `base` option (by default origin's default branch, then `origin/main`, `origin/master`, `main`, `master`). Changed files are `git diff --no-renames --name-only <merge base>` (tracked, committed or not) plus untracked, not-ignored files. With `--no-renames`, a renamed file counts as its old path deleted and its new path added, so the run without the fix has the old file back. Files matching `testGlobs` are the tests. The tracked rest (or only those matching `sourceGlobs`) is the fix. Untracked files only ever count as tests.
2. **Put the fix aside.** prove-it first takes a lock, the folder `prove-it.lock` in the repository's git dir (made with `mkdir`, so only one proof gets it), and removes it when the proof ends. A second proof of the same working tree, from this session or another, stops with `a proof is already running in this repository` before it touches anything. Each changed source file is copied with `cp -p` to `$TMPDIR/prove-it-<time>/<path>`, and each copy is checked against the original with `git hash-object`. If any copy does not match, prove-it stops before it touches anything.
3. **Run without the fix.** Each source file gets its base version back, written from `git show <base>:<path>`. A file the fix added is removed, and a file the fix deleted comes back. Then the test command runs with the changed test files as arguments. It must fail (exit code not 0).
4. **Restore, and check.** Whatever happened in step 3, including the test command not starting or timing out, every file is copied back from the temp dir and its hash is compared with the one taken in step 2. A file the fix deleted is removed again and checked to be gone. If anything does not match, prove-it stops, says `RESTORE FAILED` and tells you where the copies are.
5. **Run with the fix.** The same test command must pass.

prove-it never runs `git stash`, `git checkout` or `git restore`, and it never deletes the copies in the temp dir.

| Verdict | Meaning | Gate |
|---|---|---|
| `PROVEN ★` | The tests fail without the fix and pass with it. | lets through |
| `NOT PROVEN` | The tests pass without the fix, so they do not test it. | refuses |
| `BROKEN` | The tests fail with the fix. | refuses |
| `NO TESTS CHANGED` | Source changed but no test file did. | refuses |
| `TESTS PASS` | Only tests changed and they pass. There is no fix to revert. | lets through |
| `NOTHING TO PROVE` | Nothing changed against the base. | lets through |
| `ERROR` | git or the test command could not run. Your files were restored. | refuses |
| `RESTORE FAILED` | A restored file did not match its copy. The copies are kept in the temp dir. | refuses |

## Commands

| Command | What it does |
|---|---|
| `/prove` or `/prove run` | Runs the proof now and replies with the verdict, the files and the last lines of both runs. The model reads the same reply. In `claude -p "/prove"` it exits 0 when the gate would let the change through, 1 otherwise. |
| `/prove status` | Shows the last proof without running anything. |
| `/prove skip` | Lets the next `git push` or `gh pr create` through without a proof, once. |

## The gate

With `gate` on, a Bash call that runs `git push` or `gh pr create` (or its alias `gh pr new`), in the main session or a subagent, runs the proof first. The usual spellings are caught: git's global options (`git -C dir push`, `git --git-dir .git push`), `gh -R owner/repo pr create`, wrappers such as `command`, `env`, `sudo`, `time` and `nohup`, a path such as `/usr/bin/git`, line continuations, `bash -c "..."`, `eval '...'`, `$(...)` and backticks. Other quoted text is ignored, so `echo "git push"` is not gated. The gate is a guard rail, not a security boundary: a git alias, a script that pushes, or a command line built at run time gets past it. A refused call returns the verdict, the reason and the way out to the model (`prove-it refused git push: NOT PROVEN. ...`), and you get a toast. If the change has not moved since a proof with the same result (same `HEAD`, same diff, same untracked tests, same test command), that proof is reused, so a push followed by a PR create runs the tests once. An `ERROR` or `RESTORE FAILED` proof is never reused.

## Options

Set them in `/config` or under `pluginConfigs.prove-it.options` in settings.

| Option | Default | Meaning |
|---|---|---|
| `testCommand` | (empty) | The command that runs tests, split on blanks (quotes group) and run without a shell at the repository root, with the changed test files appended. Empty means `/prove` says to set it. |
| `testGlobs` | `**/*.test.*, **/*_test.*, **/test_*.py, tests/**` | Comma-separated globs, relative to the repository root, that mark a changed file as a test. `*` stays inside one folder, `**` crosses folders. |
| `sourceGlobs` | (empty) | Comma-separated globs for the files that make up the fix. Empty means every changed tracked file that is not a test. Use it to leave docs and config alone, e.g. `src/**, lib/**`. |
| `base` | (empty) | The ref the change is measured against. Empty means detect it (see above). |
| `gate` | `false` | Run the proof before `git push` and `gh pr create` and refuse them unless the change is proven. |
| `timeoutSeconds` | `300` | How long each test run may take before it counts as an `ERROR`. At most 600. |

## What it looks like

In the terminal the sprites are drawn in PICO-8 colours: a gold star for `PROVEN ★`, a red cross for `NOT PROVEN` and `BROKEN`, a test tube bubbling red while the proof runs, and a cracked tube spilling orange for `ERROR`. This text capture loses the colours.

The band above the prompt while the tests run:

```
▶ PROVING... PROVE-IT
  ▀▀▀▀    1 WITHOUT THE FIX ◆
  ▄▀▀▄▀   2 WITH THE FIX ·
▄▀▄▀▄▄▀▄  YOUR FILES COME BACK EITHER WAY
▀▀▀▀▀▀▀▀
```

The band after a proof:

```
▶ PROVEN ★ PROVE-IT
   ▀▀     WITHOUT THE FIX × FAIL 1
▀▀▀▀▀▀▀▀  WITH THE FIX    ★ PASS
 ▄▀▀▀▀▄   1 SOURCE · 1 TEST · BASE a1b2c3d
▄▀▀  ▀▀▄  [ OK ] [ AGAIN ]
```

```
▶ NOT PROVEN PROVE-IT
▀▀▄  ▄▀▀  WITHOUT THE FIX ★ PASS
 ▀▀▀▀▀▀   WITH THE FIX    ★ PASS
 ▄▀▀▀▀▄   2 SOURCE · 1 TEST · BASE a1b2c3d
▀▀▀  ▀▀▀  [ OK ] [ AGAIN ]
```

**OK** hides the band until the next proof. **AGAIN** runs the proof again.

The `/prove` reply:

```
PROVE-IT ▸ PROVEN ★
The changed tests fail without the fix and pass with it.
  fix: src/add.ts
  tests: src/add.test.ts
  without the fix: FAIL (exit 1)
    1 failing
      adds: expected 3, got -1
  with the fix: PASS
    1 passing
  base: a1b2c3d
```

The status line reads `PROVE-IT ★ PROVEN`, `PROVE-IT ▸ NOT PROVEN`, `PROVE-IT ▸ PROVING 1/2` while it runs, or `PROVE-IT ▸ GATE ARMED` before the first proof when the gate is on. `· GATE` is added after a verdict while the gate is on.

## Permissions

| Network | Runs processes | Files | Calls a model | Auto-submits prompts | Data leaving the machine |
|---|---|---|---|---|---|
| None of its own. | Only on `/prove`, **AGAIN**, or a gated `git push` / `gh pr create`: `git` (`rev-parse`, `symbolic-ref`, `merge-base`, `diff`, `ls-files`, `show`, `hash-object`), `mkdir` and `rmdir` of the lock folder in the git dir, `mkdir -p` and `cp -p` into the temp dir, `cp -p` back, `rm -f` on a changed source file the fix added (after its copy is checked) or that the fix deleted (after the run without the fix), and your `testCommand`, twice. | Reads the `TMPDIR` variable. Writes the base versions of the changed source files into your working tree for the run without the fix, then copies your versions back and checks them by hash. Writes copies of those files to `$TMPDIR/prove-it-<time>/` and never deletes them. Makes and removes the empty folder `prove-it.lock` in the git dir while a proof runs. Keeps the last proof in session state. | No | No | None of its own. Your test command does whatever it does. |

## Limits

- **Your files are at their base versions while the first run goes.** An editor or a subagent that writes one of those files during the run has its write replaced by the restore. The proof runs inside the tool call or the command, so the main session waits for it.
- **An interrupt stops the proof early.** If you press Esc (or another plugin's hook settles first) while the proof runs, prove-it stops waiting for the tests, restores your files at once, says `INTERRUPTED · YOUR FILES ARE BACK` and keeps the band and status line up until the restore is done. The restore is quick, but it can take a moment after the session carries on, so wait for the toast before you edit a changed file. The test command itself cannot be stopped from a plugin and runs on to its end or its timeout, now against your restored files. A proof started with **AGAIN** has no interrupt.
- If Claude Code stops or the module reloads in the middle of a run, the files may be left at their base versions. Your versions are in the newest `$TMPDIR/prove-it-<time>/` folder; prove-it does not put them back on its own. The lock folder stays behind too, so the next proof refuses to run and says where to look; put your files back, then remove `prove-it.lock` from the git dir (`git rev-parse --absolute-git-dir` prints it).
- Any non-zero exit counts as a failure. A test that fails without the fix because it cannot import a module the fix added counts as proven; read the `without the fix` lines if that matters.
- Only the changed test files are passed to the test command. A runner that takes packages rather than files (for example `go test`) needs a small wrapper script as `testCommand`.
- Base versions are written as text from `git show`, so a changed binary source file may not revert byte for byte. Your own version is always restored from the byte-for-byte copy and checked by hash.
- The gate proves the session's working directory. A command like `cd ../other && git push` is checked against the session's repository, not `../other`.
- The gate sees the Bash tool only. A push made by another tool, an MCP server or you in a terminal is not gated.
