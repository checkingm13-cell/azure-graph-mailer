# /gsd:build Workflow

## Trigger
User requests `/gsd:build` or says "start building", "implement", or "code it".

## Instructions
1. **Load Spec:** Read the active spec file (from `/gsd:plan`).
2. **Step-by-Step Execution:** Look at the "Implementation Steps" in the spec. Execute **only step 1**.
3. **Verify:** After writing the code for step 1, briefly explain what was done.
4. **Prompt:** Ask the user: "Step 1 complete. Shall I proceed to Step 2?"
5. **Loop:** Repeat until all steps are done. If you encounter an error, stop and report it immediately. Do not guess or write massive blocks of code to "fix" it blindly.