# Plan: first wave (from SPEC.md)

Approach: scaffold the marketplace on `main`, then build the six mods in parallel on `feat/first-wave` (worktree `.worktrees/first-wave`), one agent per mod running RED → GREEN against `claude plugin test`, each mod adversarially reviewed and fixed, then README integration and a privacy sweep. One commit per task; the branch lands as a PR.

Parallel: T1–T6 are independent (separate folders, no shared code). T7 needs all of them. Risks: the mods API is days old (types file is the authority; `claude plugin validate` catches refusals early); parallel agents must not commit (index.lock races), so the orchestrator commits per mod.

## Tasks

- [x] T0 marketplace scaffold — size S
  - Acceptance: `.claude-plugin/marketplace.json` (name `claude-code-mods`), LICENSE (MIT), `.gitignore`, `tsconfig.json`, `scripts/check.sh`, README stub; pushed to `main`.
  - Verify: `scripts/check.sh` runs (no mods yet → exits 0); `git log origin/main`.
- [x] T1 anchor — size M — blocked by T0
  - Acceptance: SPEC.md › anchor acceptance bullets. Verify: `claude plugin validate anchor && claude plugin test anchor`.
- [x] T2 tripwire — size L — blocked by T0
  - Acceptance: SPEC.md › tripwire. Verify: validate + test.
- [x] T3 sentry — size L — blocked by T0
  - Acceptance: SPEC.md › sentry. Verify: validate + test.
- [x] T4 stance — size M — blocked by T0
  - Acceptance: SPEC.md › stance. Verify: validate + test.
- [x] T5 anti-cheat — size M — blocked by T0
  - Acceptance: SPEC.md › anti-cheat. Verify: validate + test.
- [x] T6 respawn — size S — blocked by T0
  - Acceptance: SPEC.md › respawn. Verify: validate + test.
- [x] T7 README + marketplace integration + privacy sweep — size M — blocked by T1–T6
  - Acceptance: SPEC.md success criteria 1, 2, 4, 5. Verify: `scripts/check.sh`; `claude plugin validate .` on the marketplace; grep for employer strings returns nothing.
- [ ] T8 PR — size XS — blocked by T7
  - Acceptance: `feat/first-wave` pushed, PR open against `main` with the check output.
