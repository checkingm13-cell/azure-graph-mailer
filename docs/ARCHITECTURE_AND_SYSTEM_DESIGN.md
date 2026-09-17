---
title: "Production Architecture & Multi-Account Dispatch Engine"
date: 2026-09-17
tags:
  - architecture
  - multi-account
  - routing
  - graph-api
  - acs
  - oci
  - timezone-ist
  - queue-worker
  - obsidian-vault
aliases:
  - System Architecture
  - Engine Design
---

# 🏗️ Production Architecture & Multi-Account Dispatch Engine

> [!NOTE]
> Updated September 17, 2026: Multi-Provider Email Engine (Microsoft Graph API, Azure Communication Services, Oracle Cloud OCI SMTP) with automated batch-splitting, dynamic sender link rewriting, strict Indian Standard Time (IST / Asia/Kolkata) scheduling, dual-layer timeout guards, and automated account fallback.

---

## 1. System Topology Overview

```
                      [ Client Web Browser ]
                                │  (HTTP / REST)
                                ▼
                   [ Node.js 20 Express Server ]
                     (Azure App Service Linux)
                                │
        ┌───────────────────────┼────────────────────────┐
        ▼                       ▼                        ▼
[ SQLite 3 Native ]    [ Template Engine ]      [ Background Worker ]
 (WAL Concurrency)    (Dynamic Tag & Linker)    (Priority Queue Loop)
        │                                                │
[ IST Time Normalizer ]                                  │ (Parallel Slots: 10)
  (+330 min SQL Engine)                                  │
                                    ┌────────────────────┴────────────────────┐
                                    ▼                                         ▼
                            [ Smart Rotation ]                       [ Controlled Send ]
                          (Round-Robin by least                     (Pinned single sender
                             recent dispatch)                       with pool fallback)
                                    │                                         │
                 ┌──────────────────┼─────────────────────────┐               │
                 ▼                  ▼                         ▼               ▼
         [ Microsoft 365 ]   [ Azure ACS ]              [ Oracle OCI ] ◄──────┘
         (Graph REST API)    (Azure Cloud SDK)         (SMTP Relay Port 587)
         [15s Timeout]       [5s Race Guard]           [15s Timeout]
```

---

## 2. Supported Delivery Engines

| Engine | Protocol / Driver | Sending Speed | Default Limit | Target Use Case |
|---|---|---|---|---|
| **Microsoft Graph API** | `@microsoft/microsoft-graph-client` | ~30 msgs/min per mailbox | 500 – 1,000 / day | Primary author correspondence via licensed/shared M365 mailboxes. |
| **Azure ACS** | `@azure/communication-email` | 100 msgs/sec | 2,000 – 10,000 / day | High-volume transactional & bulk notification delivery without mailbox licenses. |
| **Oracle OCI Email** | `nodemailer` SMTP Relay (Port 587) | 10 – 50 msgs/sec | 10,000 / day | Low-cost enterprise newsletter dispatch across dedicated custom domains. |

---

## 3. Dynamic Template Engine & Link Routing

The template engine in `src/services/templateEngine.js` performs variable replacement and dynamic URL rewriting during queue generation:

### A. Supported Merge Tags
- `[FNAME]` / `{{FNAME}}`: First name extracted from recipient name (defaults to "Researcher").
- `[NAME]` / `{{Name}}`: Full recipient name.
- `{{Paper Title}}`: Target publication / article title.
- `{{email}}`: Recipient email address.
- `{{senderDomain}}`: Domain of the sender mailbox chosen to dispatch the email.

### B. Dynamic Relative Link Rewriting
Templates specify clean relative paths:
```html
<a href="/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article">Submit Article</a>
```
During queue rendering, the engine automatically detects the active sender's domain (`dr.reetashah@theparipexjournal.com` $\to$ `theparipexjournal.com`) and rewrites the link to:
```html
https://theparipexjournal.com/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article
```

---

## 4. Multi-Account Pool & Fair Rotation Algorithm

The pool manager (`src/services/accountPool.js`) and queue worker implement atomic round-robin dispatch:

1. **Least-Recently Dispatched Lease**:
   Accounts are sorted by `last_sent_at ASC NULLS FIRST`. The mailbox that has rested longest gets the next outgoing email.
2. **Quota Tracking**:
   Rolling 24-hour window tracked against `sent_today < daily_limit`.
3. **1-Click Quota Resets**:
   Admins can reset daily counters back to `0` or update limits across the entire pool with 1 click.
4. **Automated Cooldown & Backoff**:
   - HTTP 429 (Graph rate-limiting): Automatically places account on a 120s cooldown and yields message to sibling mailbox.
   - SMTP 455 (OCI rate-limiting): Automatically places account on a 60s cooldown and yields message.
   - Auth / Clock Skew (`AADSTS700024`): Automatically applies a 600s cooldown and rotates to healthy accounts immediately.
5. **Automatic Account Fallback**:
   When a pinned account reaches its daily limit (`sent_today >= daily_limit`) or enters cooldown, the dispatcher automatically leases an available healthy account from the pool instead of halting the batch.

---

## 5. Indian Standard Time (IST / Asia/Kolkata) Engine

To eliminate the 5.5-hour UTC lag where scheduled campaigns were trapped in waiting states, the architecture enforces strict Indian Standard Time (`UTC+05:30`):

- **Process-Level Timezone**: `process.env.TZ = 'Asia/Kolkata'` set on startup in `src/utils/time.js`.
- **Database Engine UTC Offsets**: All SQLite temporal expressions use explicit `+330 minutes` modifiers:
  - `datetime('now', '+330 minutes')` replaces standard UTC `datetime('now')`.
  - `strftime('%s', 'now', '+330 minutes')` for epoch comparisons against cooldowns.
- **Strict Input Parsing**: `parseIST(input)` automatically detects datetime strings without timezone specifiers and anchors them to `+05:30`.
- **Deterministic Formatting**: `toISTString()` leverages `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'` to guarantee valid SQLite timestamps (`YYYY-MM-DD HH:mm:ss`).

---

## 6. Priority Queue Rank Ordering & Event-Driven Worker Wakeup

The queue worker features a 3-tier rank-ordering query engine:

```sql
ORDER BY 
  CASE 
    WHEN q.campaign_id IN (:priorityIds) THEN 0 
    WHEN c.status = 'RUNNING' THEN 1 
    ELSE 2 
  END ASC,
  CASE WHEN q.scheduled_at IS NULL THEN 0 ELSE 1 END ASC,
  q.scheduled_at ASC,
  q.id ASC
LIMIT :maxDispatchCount
```

- **Instant Worker Wakeup**: The worker uses `interruptibleSleep(ms)`. When "Send Now" is triggered via API, `queueWorker.wake()` clears sleep timers and resumes the loop instantly without polling latency.
- **Dynamic Concurrency**: Leases up to 10 concurrent dispatch slots simultaneously (configurable via `worker_concurrency` setting).
- **Adaptive Pacing**:
  - **100ms Ultra-Fast Pacing**: Activated when priority/instant campaigns are in progress.
  - **500ms–2000ms Balanced Pacing**: Used during regular warmup and continuous delivery.

---

## 7. Dual-Layer Timeout Guards & Watchdog Auto-Recovery

To prevent single-threaded Node.js event-loop freezes caused by hanging network pollers:

1. **ACS Micro-Timeout Guard**: `poller.pollUntilDone()` in `src/services/acsMailer.js` is raced with a 5-second timeout. If the poller takes longer than 5 seconds, the message is treated as `Accepted` with its cloud operation ID.
2. **Global Provider Timeout**: Every dispatch call across Graph, ACS, and OCI is wrapped in a 15-second `withTimeout(promise, 15000, desc)`.
3. **30-Second Background Watchdog**: Every 30 seconds, `queueWorker.checkWatchdog()` queries for any email stranded in `status = 'sending'` and resets it to `status = 'queued'` in IST time, guaranteeing self-healing after system crashes or transient disconnects.

---

## 8. Batch Chaining with Strict Prefix Isolation

The `BatchChainManager` (`src/services/batchChainManager.js`) sequences multi-batch campaigns (`Batch_01` $\to$ `Batch_02` $\to$ `...` $\to$ `Batch_40`):

- **Series Prefix Extraction**: Extracts the campaign base name using `/^(.*)_Batch_\d+$/`.
- **Targeted Lookups**: Queries next batch using strict pattern `${baseName}_Batch_${nextBatchStr}` rather than loose `%_Batch_%` wildcards, preventing cross-campaign race conditions.
- **Auto-Reconciliation**: If a batch has 49 sent and 1 permanently failed item, the watchdog reconciles `(sent_count + failed_count) >= total_count` and triggers the next sequential batch automatically.

---

## 🔗 Related Notes (Obsidian Links)
* [[INCIDENT_REPORT_QUEUE_FREEZE_IST_TIMEZONE_AND_SEND_NOW_AUDIT]]
* [[INCIDENT_REPORT_49_50_STUCK_BATCHES_AND_DSA_AUDIT]]
* [[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]
* [[DEPLOYMENT_GUIDE]]
* [[MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]]
* [[README]]
