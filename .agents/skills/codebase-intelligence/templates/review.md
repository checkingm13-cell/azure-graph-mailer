# Codebase Intelligence Review

**Scope:** <changed files> · **Context level:** <N> · **Base:** <ref>

## Summary

<Two or three sentences. Lead with the thing that would block a merge. If
nothing would, say so plainly.>

## Code
<Correctness, error handling, maintainability. From your own reading at
level 5; label it as such. Omit the section if you didn't read source.>

## Architecture
- Dependency boundaries: <clean | finding>
- Cycles: <none | list>
- Layering: <clean | violations, or "layer names don't match this project">

## Responsive
<Findings with confidence >= 0.5. Each as: file:line — pattern -> potential
consequence (confidence). Say "no responsive risks detected in changed files"
when that's the case.>

## User experience
<Findings mapped to the six properties. Same format.>

## User flow
<Only if a journey was reconstructed. State that it comes from imports and may
miss runtime navigation.>

## Needs human verification
<Findings between 0.5 and 0.75, each with the one check that would settle it.>

---
*Findings are patterns detected in source, not observed behaviour. Nothing here
was executed.*
