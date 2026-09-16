# Progressive Context Expansion

Each level answers one question. Pick the level by the question you actually
have, not by how thorough you want to look.

| Level | Question it answers | Contains |
|---|---|---|
| 0 | What changed? | paths, language, LOC, inferred role |
| 1 | What is inside the changed files? | symbol list with line numbers |
| 2 | Who touches this? | direct importers and imports + findings |
| 3 | How far does the change reach? | BFS impact radius by distance |
| 4 | Does it violate the architecture? | layers touched, cycles, layering violations |
| 5 | I need to read the code | source of changed files only (never neighbours) |

Findings are attached at every level, scoped to whatever is in view.

## Default

Level 2. It is enough for the large majority of changes and costs a few hundred
tokens.

## When to climb

Climb on evidence, and be able to name it:

- **2 to 3**: the pack shows more than ~5 dependents, or the changed file's role
  is `service`, `repository`, or `config` — shared code, wide blast radius.
- **3 to 4**: the impact radius crosses three or more roles, or the change is in
  a file that appears in a cycle.
- **4 to 5**: a specific finding cannot be resolved from facts — e.g. a
  feedback gap where you need to see whether the parent handles the error.
  Read the one file, not the neighbourhood.

## When to descend

If level 2 returns a single leaf component with no dependents and no findings,
review it and stop. Don't run level 4 "to be safe" — it adds tokens and adds
nothing.

## Useful flags

```bash
--base main             # diff against a branch instead of HEAD~1
--files a.js b.js       # explicit files instead of git
--depth 3               # widen BFS at level 3+ (default 2)
--max-neighbors 50      # raise the per-list cap (default 25)
--max-bytes 40000       # per-file source cap at level 5 (default 20000)
```

`approx_tokens` in the output is a rough size check. If a pack exceeds a few
thousand tokens, you almost certainly want a lower level or fewer seed files
rather than a bigger budget.
