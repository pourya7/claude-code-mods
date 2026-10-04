Stand-in memory files for the radar demo (demos/tapes/radar.tape).

radar indexes the memory files in a user's own config, which are private, so
the demo copies these neutral, generic lessons to a temp folder and points
radar's `memoryDirs` at it. This README has no frontmatter, so radar skips it
quietly, the same way it skips a `MEMORY.md` index.
