---
title: "Technical Specification: Production Campaign Scheduling & Real-Time Monitor"
date: 2026-09-17
tags:
  - specification
  - scheduler
  - queue-worker
  - timezone-ist
  - batch-chaining
  - obsidian-vault
aliases:
  - Campaign Scheduler Spec
  - Queue Engine Spec
---

# ⏱️ Technical Specification: Production Campaign Scheduling & Real-Time Monitor

**Target System:** `azure-graph-mailer`  
**Author:** Antigravity Engineering  
**Status:** PRODUCTION IMPLEMENTED & VERIFIED  
**Date:** September 17, 2026  

---

## 1. Goal & Requirements Overview

The campaign scheduling engine orchestrates multi-account, high-throughput delivery across Indian academic journals with:
1. **Multi-Account Leasing & Auto-Fallback:** Primary sender pinning with automatic round-robin fallback across healthy pool mailboxes if the pinned sender is busy, throttled, or reaches its daily limit.
2. **Strict Indian Standard Time (IST) Normalization:** All user schedules, execution queries, and database logs operate anchored to `Asia/Kolkata` (`UTC+05:30`).
3. **Instant Send-Now Priority Engine:** 1-Click "Send Now" trigger with reactive worker wakeup (`0ms` polling delay), top-tier queue rank ordering, and 100ms ultra-fast pacing.
4. **Pre-Flight Projected Schedule Timeline:** Preview modal computes projected start and completion times per batch before launch.
5. **Deterministic Batch Chaining:** Automatic sequential execution of multi-batch series (`Batch_01` $\to$ `Batch_02` $\to$ `...`) isolated strictly by campaign series prefix.
6. **Live Frontend Campaign Monitor:** Hero card with real-time progress bar, dynamic ETA, and 1-Click Pause/Resume/Cancel controls.

---

## 2. Database Schema Definition

### Table: `campaigns`
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `name TEXT NOT NULL`: E.g., `17-9-26-campaign01_Batch_01`.
- `parent_id INTEGER`: Links child batches to parent series.
- `template_id INTEGER NOT NULL REFERENCES templates(id)`
- `status TEXT DEFAULT 'SCHEDULED'`: `SCHEDULED`, `QUEUED`, `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED`.
- `total_count INTEGER DEFAULT 0`
- `sent_count INTEGER DEFAULT 0`
- `failed_count INTEGER DEFAULT 0`
- `scheduled_at DATETIME`: Target execution timestamp in IST (`YYYY-MM-DD HH:mm:ss`).
- `started_at DATETIME`: Time first email dispatched in IST.
- `completed_at DATETIME`: Time last email dispatched in IST.
- `pinned_account_id INTEGER REFERENCES accounts(id)`: Preferred sender mailbox.
- `fallback_allowed INTEGER DEFAULT 1`: Permits automatic pool leasing when pinned account is saturated.
- `custom_interval_ms INTEGER DEFAULT 2500`

### Table: `queue`
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `campaign_id INTEGER NOT NULL REFERENCES campaigns(id)`
- `contact_id INTEGER REFERENCES contacts(id)`
- `email TEXT NOT NULL`
- `name TEXT`
- `subject TEXT NOT NULL`
- `rendered_html TEXT NOT NULL`
- `status TEXT DEFAULT 'queued'`: `queued`, `sending`, `sent`, `failed`.
- `account_id INTEGER REFERENCES accounts(id)`: Leased sender account.
- `scheduled_at DATETIME`: Eligible execution time in IST. `NULL` denotes immediate dispatch.
- `sent_at DATETIME`: Dispatch timestamp in IST.
- `accepted_at DATETIME`: Upstream provider acceptance timestamp in IST.
- `attempts INTEGER DEFAULT 0`
- `last_error TEXT`
- `provider_message_id TEXT`

---

## 3. Queue Worker Scheduler Engine (`src/services/queueWorker.js`)

### 3.1 Priority Queue Selection Query (IST Anchored)
The worker extracts eligible queue items up to the active concurrency limit (default: 10):

```sql
SELECT q.*, c.name AS campaign_name, c.status AS campaign_status,
       c.mode AS campaign_mode,
       COALESCE(c.pinned_account_id, c.sender_account_id) AS campaign_pinned_account_id,
       c.fallback_allowed AS campaign_fallback_allowed,
       c.custom_interval_ms AS campaign_custom_interval_ms
FROM queue q
JOIN campaigns c ON q.campaign_id = c.id
WHERE q.status = 'queued'
  AND (q.scheduled_at IS NULL OR q.scheduled_at <= datetime('now', '+330 minutes'))
  AND c.status IN ('SCHEDULED', 'QUEUED', 'RUNNING')
ORDER BY 
  CASE 
    WHEN q.campaign_id IN (:priorityIds) THEN 0 
    WHEN c.status = 'RUNNING' THEN 1 
    ELSE 2 
  END ASC,
  CASE WHEN q.scheduled_at IS NULL THEN 0 ELSE 1 END ASC,
  q.scheduled_at ASC,
  q.id ASC
LIMIT :concurrency;
```

### 3.2 Account Lease & Auto-Fallback Logic
```javascript
let account = null;
if (item.campaign_pinned_account_id) {
  account = availableAccounts.find(a => a.id === item.campaign_pinned_account_id && !assignedAccountIds.has(a.id));
  // Auto-Fallback if pinned account is saturated (sent_today >= daily_limit) or in cooldown
  if (!account) {
    account = availableAccounts.find(a => !assignedAccountIds.has(a.id)) || availableAccounts[idx % availableAccounts.length];
  }
} else {
  account = availableAccounts.find(a => !assignedAccountIds.has(a.id)) || availableAccounts[idx % availableAccounts.length];
}
```

### 3.3 Lifecycle Hooks
- **Campaign Activation**: When first email dispatches:
  `UPDATE campaigns SET status = 'RUNNING', started_at = COALESCE(started_at, datetime('now', '+330 minutes')) WHERE id = ?`
- **Campaign Completion**: When `COUNT(status IN ('queued', 'sending')) = 0`:
  `UPDATE campaigns SET status = 'COMPLETED', completed_at = datetime('now', '+330 minutes') WHERE id = ?`
- **Batch Chaining Trigger**: Calls `batchChainManager.checkAndTriggerNextBatch(campaignId, batchNumber)` immediately upon completion.
- **Stranded Email Watchdog**: Every 30s, rescues stranded `sending` records:
  `UPDATE queue SET status = 'queued', account_id = NULL, scheduled_at = datetime('now', '+330 minutes') WHERE status = 'sending'`

---

## 4. API Endpoints

1. `POST /api/campaigns/:id/send-now`:
   - Recursively targets campaign and child batches (`parent_id = :id` OR `name LIKE ':name_Batch_%'`).
   - Clears `scheduled_at = NULL` and marks campaigns `RUNNING`.
   - Invokes `queueWorker.triggerInstantSend(targetIds)`: adds IDs to `priorityCampaignIds` and calls `wake()`.
2. `POST /api/campaigns/:id/pause`: Pauses campaign (`status = 'PAUSED'`).
3. `POST /api/campaigns/:id/resume`: Resumes paused campaign (`status = 'RUNNING'`).
4. `POST /api/campaigns/:id/cancel`: Cancels campaign and marks pending queue items as `failed`.
5. `POST /api/campaigns/bulk-action`: Bulk executes `PAUSED`, `RESUMED`, or `CANCELLED` across multiple campaign IDs.
6. `GET /api/campaigns/active-monitor`: Returns active campaign telemetry, ETA, sender health, and upcoming batches.

---

## 5. Pacing & Concurrency Controls

- **Worker Concurrency**: 10 concurrent dispatches per loop tick (managed via `worker_concurrency` setting, capped at 20).
- **Dual Pacing Modes**:
  - **Priority Instant Send**: `100ms` sleep between loop ticks when priority campaigns are active.
  - **Normal Pacing**: `Math.max(500, Math.min(sendIntervalMs, 2000))` (500ms–2000ms) to maintain healthy sender reputation.
- **Interruptible Sleep**: Uses `interruptibleSleep(ms)` allowing `queueWorker.wake()` to break the sleep timer instantaneously.

---

## 6. Batch Chain Manager Specification

- **Naming Convention**: `${baseCampaignName}_Batch_${batchNumber}` (e.g., `17-9-26-campaign01_Batch_01`).
- **Strict Series Isolation**: Queries next batch using `${baseName}_Batch_${nextBatchStr}`.
- **Auto-Reconciliation**: If tail items experience persistent clock-skew or auth errors, watchdog auto-fails them and marks campaign `COMPLETED` once `(sent + failed) >= total_count`.

---

## 🔗 Related Notes (Obsidian Links)
* [[INCIDENT_REPORT_QUEUE_FREEZE_IST_TIMEZONE_AND_SEND_NOW_AUDIT]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[INCIDENT_REPORT_49_50_STUCK_BATCHES_AND_DSA_AUDIT]]
* [[DEPLOYMENT_GUIDE]]
* [[README]]
