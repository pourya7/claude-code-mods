---
name: Back up a dirty file before discarding it
description: before you discard a change you just read in git diff, copy the file aside; checkout -- and restore throw away uncommitted work for good
triggers:
  - '\bgit\s+checkout\s+--\s'
  - '\bgit\s+restore\b'
---
- Never run `git checkout -- <file>` or `git restore <file>` on a file with changes until a copy exists.
- Always copy it aside first (for example `cp src/app.js src/app.js.bak`) and say where the copy is.
