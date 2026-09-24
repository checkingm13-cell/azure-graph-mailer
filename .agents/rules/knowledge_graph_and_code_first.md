# Knowledge Graph & Code-First Analysis Rule

## 1. Context-Memory First (No Redundant Re-Reading)
- All 21 documentation files from `docs/` and historical incident reports are fully indexed in agent context memory.
- **DO NOT** re-read documentation files or ask repetitive context questions if the answers already exist in memory.
- **NEVER** re-summarize entire doc files unless explicitly asked.

## 2. Code-First Knowledge Graph Protocol
Whenever the user asks for analysis, troubleshooting, or implementation:
- **Direct Code Output**: Lead immediately with the exact file path, line numbers, and the precise code block.
- **Result Analysis First**: Show the direct input -> processing -> output result first. Skip conversational filler, fluff, and unnecessary explanations.
- **Knowledge Graph Trace (Docs Vault -> Code Logic -> UI / DB)**:
  1. **Policy/Spec (Docs Vault)**: Identify the exact specification rule (e.g. OCI Custom Return Path, Two-phase template rendering, IST +330m normalization).
  2. **Code Engine**: Map directly to the implementing file (`src/services/templateEngine.js`, `queueWorker.js`, `storageService.js`, `api.js`, `app.js`).
  3. **Data State**: Map to SQLite table & column (`queue.subject`, `campaigns.status`, `accounts.daily_limit`).
  4. **Frontend / DOM**: Map to the exact HTML element ID / CSS selector.

## 3. Strict Local-Only Execution (No Unrequested Git Push)
- **NEVER** run `git push origin main` unless the user explicitly types the words "git push" or "push to github".
- All UI, CSS, backend, and template adjustments must remain strictly local on disk.

## 4. Engineering Principles Integration
- **Ponytail**: Minimal diffs, standard libraries, zero redundant abstractions, native CSS/JS before dependencies.
- **UI/UX Pro Max**: Mobile touch targets >= 44px, safe area insets, no horizontal layout breaking, high-contrast dark theme integrity.
- **Get Shit Done**: High-velocity direct execution with minimal turns.

## 5. Output Language Directive (Strict English)
- **ALL responses must be in English ONLY**, regardless of what language the user writes in (Gujarati, Hindi, Hinglish, etc.).
- Never reply in regional languages even if the user prompts in Gujarati or another language.

## 6. Database State Preservation & No Destructive Startup Seeding (CRITICAL)
- **Database Is Single Source of Truth**: The database stores live user configuration, customized email templates, multi-subject variations (`|`), and campaign states.
- **NEVER Overwrite User Data on Boot**: Schema seeders and migration routines (`schema.js`, `db.js`) must strictly use `INSERT ... ON CONFLICT DO NOTHING` or `if (!existing) { INSERT }`. 
- **FORBIDDEN**: Never run startup `UPDATE` queries on user-editable entities (`templates`, `accounts`, `campaigns`, `settings`) that overwrite database records with hardcoded repo files or strings. User edits made in the dashboard must remain permanently persistent across all server reboots, deployments, and PM2 restarts.
- **Additive Migrations Only**: All future schema modifications must use safe `ALTER TABLE ADD COLUMN` with fallback defaults without dropping or modifying user-entered column contents.
