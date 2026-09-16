# /gsd:plan Workflow

## Trigger
User requests `/gsd:plan` or asks to "plan", "design", or "spec" a feature.

## Instructions
1. **Analyze:** Read the user's request and relevant existing codebase files.
2. **Ask Clarifying Questions:** If the request is ambiguous, ask up to 3 targeted questions before proceeding.
3. **Draft Spec:** Create a new file in the `docs/specs/` directory (create the folder if it doesn't exist) named `YYYY-MM-DD-feature-name.md`.
4. **Spec Structure:** The spec must include:
   - **Goal:** 1-2 sentences on what we are building.
   - **Context:** What existing code is affected.
   - **Implementation Steps:** A numbered, atomic checklist of exactly what code to write/change.
   - **Edge Cases:** Potential bugs or errors to watch out for.
5. **Handoff:** Present the spec to the user and ask: "Does this spec look good to proceed to `/gsd:build`?"