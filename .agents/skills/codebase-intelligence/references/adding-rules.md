# Adding rules

Two layers, and the split is the point.

## Layer 1 — a signal is a fact

Add to `SIGNAL_RULES` in `tools/ci.py`. A signal must be something a regex can
observe with no interpretation, named `domain.thing`:

```python
("state.optimistic", re.compile(r"\boptimisticUpdate|setQueryData\b")),
```

Signals are stored per file with line numbers. They carry no severity and no
opinion. Only files whose language is in `UI_LANGS` are scanned for signals.

## Layer 2 — a finding is a judgement with a derivation

Add to `synthesize_findings`. Every finding needs:

- `rule`, `severity`, `file`, `line`
- `pattern` — what was observed, in facts
- `potential_consequence` — what it might mean for a person
- `evidence` — the signals and counts behind it, including negative evidence
- `confidence` — built from a base plus named adjustments
- `verify` — the most likely reason this finding is wrong

Derive confidence explicitly so it can be argued with:

```python
conf = 0.5                                   # base for this pattern
if has("ui.button"): conf += 0.15            # corroborating
if has("guard.confirm"): conf -= 0.3         # contradicting
```

A rule with a hardcoded confidence and no adjustments is a rule that will never
learn it was wrong. If you can't name what would lower the confidence, the rule
isn't ready.

## Scoping a rule to the right layer

`roles.get(path)` gives the inferred role. UX rules should generally require
`role in ("component", "route")` or a corroborating `ui.*` signal — otherwise
a rule about destructive UI actions fires on every repository method named
`remove()`.

## Testing a rule

Write the smallest file that should trigger it and the smallest that should
not, then:

```bash
python3 tools/ci.py index /tmp/fixture --force
python3 tools/ci.py --pretty signals
```

A rule that fires on the negative fixture costs more trust than it earns.
