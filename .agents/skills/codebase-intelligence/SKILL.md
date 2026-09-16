---
name: codebase-intelligence
description: Review code across four dimensions at once — correctness, architecture, responsive/UI risk, and user-experience gaps — using a deterministic index instead of reading the whole repo. Use this whenever the user asks to review changes, review a PR or diff, audit a codebase, check architecture or dependency health, find circular dependencies or layering violations, look for mobile/responsive problems, check whether UI code gives users loading/error/success feedback, map a user journey through the code, or asks "what will this change break". Also use it when the user wants a large codebase understood or documented without pasting the whole thing into context.
---

# Codebase Intelligence

A review system built on one rule:

> Deterministic facts → minimal relevant context → probabilistic reasoning → evidence-backed findings.

The tool extracts facts. You interpret them. Keeping those two jobs separate is
what makes findings trustworthy and keeps context small — you never read a
repository, you read a context pack sized to the change.

## Setup

The engine is `tools/ci.py`. Stdlib Python 3.9+, no network, no install.

```bash
python3 tools/ci.py index .        # first run: builds cache/ir.db
python3 tools/ci.py stats          # confirm it saw what you expected
```

Indexing is incremental — re-run it before any review, it only reparses files
whose hash changed. If `stats` reports far fewer files than the project has,
something is being ignored; pass `--ignore` patterns or check `.gitignore`.

## The core workflow: reviewing a change

Do **not** open source files first. Start at level 2 and climb only when
evidence justifies it. This is the whole point — a level-2 pack is a few
hundred tokens where the raw files would be tens of thousands.

```bash
python3 tools/ci.py index .
python3 tools/ci.py context . --changed --base main --level 2
```

The pack gives you: changed files and their roles, the symbols inside them,
what imports them, what they import, and any deterministic UI/UX findings.

Now decide, per the evidence:

| What the pack shows | Next step |
|---|---|
| Nothing surprising, small blast radius | Stay at level 2, review, done |
| Many dependents, or a shared/service file changed | `--level 3` for the impact radius |
| Layering or cycle concerns, or the change crosses roles | `--level 4` |
| A specific finding you cannot judge from facts alone | `--level 5` for source of changed files only |

Escalating should feel like a decision you can justify in one sentence. If you
can't say why you need more context, you don't.

Read `references/progressive-context.md` before using levels 3-5, since each
level has a specific question it is meant to answer and reaching for level 5 by
default defeats the design.

## Reading findings correctly

Findings from `signals` and from the context pack are **patterns with a
possible consequence**, not defects. The tool detected code shape; it did not
run the app. Preserve that distinction in what you write:

```
Detected pattern → potential UX consequence → confidence → human verification
```

Confidence is computed from corroborating and contradicting signals, so treat
it as a routing hint:

- **≥ 0.75** — report it plainly, with the evidence attached
- **0.5 – 0.75** — report it as a question, and say what would confirm it
- **< 0.5** — usually mention only if several such findings cluster in one area

Common reason a finding is wrong: the missing thing exists somewhere the file
doesn't show — confirmation in a parent, retry in an error boundary,
breakpoints in a global stylesheet. Each finding carries a `verify` field
naming exactly that possibility. Check it before reporting, and drop the
finding if you can see the guard elsewhere. A reviewer that cries wolf gets
ignored, which costs more than the missed finding would have.

## Architecture checks

```bash
python3 tools/ci.py graph --all        # cycles, layering violations, hubs
python3 tools/ci.py graph --of src/services/campaignService.js
```

Layering assumes `route → controller → service → repository`, inferred from
paths and content. If the project uses different names, the violations are
noise — say so rather than reporting them. A cycle is a real fact; whether it
matters depends on what's in it, which is your call, not the tool's.

## UI, responsive, and user-journey review

```bash
python3 tools/ci.py signals --min-confidence 0.5
python3 tools/ci.py signals --files src/components/CampaignTable.jsx
```

For judging what the findings mean — cognitive load, feedback gaps, recovery
paths, the six-property model (visibility, predictability, feedback, hierarchy,
consistency, recovery) — read `references/ux-model.md`. Don't invent UX
vocabulary; that file exists so findings stay consistent between runs.

To reconstruct a user journey, start from files with role `route`, follow the
graph outward, and check each hop for the four questions in `references/ux-model.md`.
State clearly that the journey is reconstructed from imports and may miss
runtime navigation.

## Report format

Use `templates/review.md`. Its shape matters: dimensions are separated so a
backend reviewer can skip the UX section, and every finding carries its
evidence so the reader can disagree with you using the same facts.

Two things to keep honest:

- Report clean dimensions as clean. A review that only ever produces warnings
  teaches the reader to skim.
- Never pad. Four real findings beat twelve with eight filler items.

## What this tool does not know

Say so when it matters, rather than implying coverage you don't have:

- It doesn't execute anything — no runtime behaviour, no actual render widths
- Symbol extraction is pattern-based, so dynamic dispatch, DI containers, and
  metaprogramming are invisible
- Import resolution handles relative paths, Python modules, and common aliases;
  exotic bundler aliases resolve as external
- It sees no CSS cascade, no design system, no screenshots
- Security and performance findings are not covered by the signal rules — if
  you report them, they come from your own reading at level 5, and you should
  label them as such

## Extending

Signal rules live in `SIGNAL_RULES` in `tools/ci.py`; findings are synthesised
in `synthesize_findings`. Keep that split — a new rule should add a *fact*,
and the judgement about it belongs in the synthesis function with an explicit
confidence derivation. See `references/adding-rules.md`.
