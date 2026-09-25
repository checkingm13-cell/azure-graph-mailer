---
title: "Incident Report: Account Deletion FK Constraints, Suppression Persistence, and Queue Worker Resilience"
date: 2026-09-25
tags:
  - incident-report
  - accounts-pool
  - sqlite-fk
  - queue-worker
  - controlled-send
  - obsidian-vault
aliases:
  - Account Deletion & FK Resilience Report
  - Controlled Send Dropdown Audit
---

# 🛡️ Incident Report: Account Deletion FK Constraints, Suppression Persistence, and Queue Worker Resilience

> [!NOTE]
> Incident Resolution Date: September 25, 2026  
> Components: `src/routes/api.js`, `src/app.js`, `src/services/queueWorker.js`, `public/js/app.js`  
> Environments Tested: Local Development & Production (`mailapp.balajiimpex.store`) via PM2

---

## 1. Executive Summary

During operational management of the Sender Accounts Pool, three related lifecycle issues were identified and resolved:

1. **HTTP 500 Foreign Key Error on Deletion**: Attempting to delete an account via `DELETE /api/accounts/:id` crashed with SQLite error: `Error: FOREIGN KEY constraint failed` when past records in `campaigns`, `queue`, or `delivery_logs` referenced that account ID. Because the response was an unhandled 500 HTML page from NGINX/Plesk, the frontend reported `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
2. **Re-seeding on Server Restart**: Deleted accounts reappeared in the pool whenever the Node application restarted because `seedDefaultAccount()` in `src/app.js` re-inserted missing seed accounts into the database.
3. **Controlled Send Inactive Account Exposure**: Inactive or disabled accounts (`is_active = 0`) still appeared in the Controlled Send, Quick Test, and Rerun dropdowns, which could lead to campaigns stalling if dispatched to disabled senders without fallback.
4. **Queue Worker Infinite Postponement Loop**: If a pinned sender account in a Controlled Send campaign was disabled or deleted while the queue was running and fallback was disabled, `QueueWorker` postponed the items every 60 seconds indefinitely.

---

## 2. Root Cause Analysis

### A. SQLite Foreign Key Constraint Enforcement (`FOREIGN KEY constraint failed`)
The SQLite schema activates strict foreign keys on connection:
```sql
PRAGMA foreign_keys = ON;
```
Tables `campaigns` (`pinned_account_id`, `sender_account_id`), `queue` (`account_id`), and `delivery_logs` (`account_id`) enforce foreign key integrity against `accounts(id)`. Executing `DELETE FROM accounts WHERE id = ?` without first nullifying these references caused SQLite to abort the transaction with `FOREIGN KEY constraint failed`.

### B. Boot Seeder Re-Insertion
In `src/app.js`, `seedDefaultAccount()` evaluated:
```javascript
const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(sender.email);
if (!existing) {
  AccountPool.upsertAccount({ ... });
}
```
When an account was deleted, `existing` became null on the next PM2 restart, resurrecting the deleted account.

### C. Dropdown Filtering Missing `is_active` Condition
In `public/js/app.js`, `updateBatchSenderDropdown()` filtered only by `provider === 'OCI'`, without checking `a.is_active === 1`. Consequently, disabled accounts remained selectable in Controlled Send mode.

---

## 3. Engineering Resolution

### 1. Atomic Unlink & Deletion Transaction (`src/routes/api.js`)
Account deletion now executes inside an atomic SQLite transaction that safely sets foreign key references to `NULL` before deleting the account:
```javascript
const deleteTx = db.transaction(() => {
  db.prepare('UPDATE campaigns SET pinned_account_id = NULL WHERE pinned_account_id = ?').run(account.id);
  db.prepare('UPDATE campaigns SET sender_account_id = NULL WHERE sender_account_id = ?').run(account.id);
  db.prepare('UPDATE queue SET account_id = NULL WHERE account_id = ?').run(account.id);
  db.prepare('UPDATE delivery_logs SET account_id = NULL WHERE account_id = ?').run(account.id);
  db.prepare('UPDATE logs SET account_id = NULL WHERE account_id = ?').run(account.id);

  db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
});
```

### 2. Persistent Suppression List (`settings.suppressed_accounts`)
- When an account is deleted, its email is stored in `settings.suppressed_accounts` (JSON array).
- On server startup, `seedDefaultAccount()` in `src/app.js` reads this list and skips seeding any deleted accounts.
- If an operator manually creates the account again via `POST /api/accounts`, the email is removed from the suppression list.

### 3. Queue Worker Deadlock Protection (`src/services/queueWorker.js`)
If a pinned sender account is disabled or deleted during queue processing:
- Detects `!pinnedCheck || pinnedCheck.is_active === 0`.
- Automatically sets `campaigns.status = 'PAUSED'`.
- Sets a clear explanatory error in `queue.last_error` (`Assigned sender account was deleted/disabled. Campaign automatically paused`).
- Prevents infinite 60-second postponement loops.

### 4. Frontend Dropdown Filtering (`public/js/app.js`)
Filtered all sender dropdowns to active accounts only:
```javascript
const activeAccounts = allLoadedAccounts.filter(a => a.is_active === 1);
const eligibleAccounts = isVisual
  ? activeAccounts.filter(a => a.provider === 'OCI')
  : activeAccounts;
```
Delete and Toggle actions now validate `res.ok` and display error dialogs if server errors occur.

### 5. Template Deletion Guard Expansion (`src/routes/api.js`)
Updated template deletion validation to check `status IN ('SCHEDULED', 'QUEUED', 'RUNNING', 'PAUSED')` to protect scheduled campaigns from cascading deletion.

---

## 4. Verification & Validation

| Verification Check | Target / Endpoint | Result |
|---|---|---|
| **Local Syntax & DB Init** | `node -e "require('./src/app')"` | ✅ Clean boot, tables intact |
| **Git Push to Main** | `checkingm13-cell/azure-graph-mailer` | ✅ Commit `304c918` pushed |
| **Live Server Pull & PM2** | `mailapp.balajiimpex.store` | ✅ Fast-forwarded & restarted cleanly |
| **Live Account Deletion** | `DELETE /api/accounts/4` | ✅ HTTP 200 OK (`Account permanently removed`) |
| **Foreign Key Safety** | `accounts(id) -> campaigns, queue, logs` | ✅ Clean nullification without constraint errors |
| **Suppression Persistence** | PM2 restart on live server | ✅ Deleted account did not re-seed |
| **Live API Health** | `/health`, `/api/accounts`, `/api/templates` | ✅ All endpoints healthy and responsive |
