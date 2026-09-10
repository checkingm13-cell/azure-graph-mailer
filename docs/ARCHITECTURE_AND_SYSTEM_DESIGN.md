---
title: "Azure Multi-Account Mailer - System Architecture & Scaling Design"
date: 2026-09-09
tags:
  - azure
  - system-design
  - architecture
  - multi-account
  - sqlite
  - graph-api
  - obsidian-vault
aliases:
  - System Design
  - Architecture Blueprint
---

# 🏗️ System Architecture & Scaling Design: Multi-Account Mailer

> [!NOTE]
> **Obsidian Integration:** This architectural document explains the internal mechanisms of the **Round-Robin Multi-Account Pool**, the **Database Schema**, and the **Pacing Engine**.
> Master SOP & Checklist: [[SCALE_TO_40_ACCOUNTS_AND_PROJECT_STATUS]]

---

## 1. High-Level System Flow

```
[ User Browser / Phone ]
          │
          ▼  (Access Dashboard UI)
┌──────────────────────────────────────────────────────────────┐
│                    AZURE APP SERVICE (B1)                    │
│                                                              │
│   1. Express Web UI & REST API                              │
│      ↳ Drag & Drop CSV Author Importer                       │
│      ↳ Dynamic Email Template Builder                        │
│      ↳ Multi-Account Pool Monitor                            │
│                                                              │
│   2. Native SQLite WAL Engine (/home/data/mailer.db)         │
│      ↳ High-concurrency ACID transactions                    │
│      ↳ Persistent disk storage surviving restarts            │
│                                                              │
│   3. 24/7 Queue Worker & Account Pool Manager                │
│      ↳ Round-Robin Account Leaser                            │
│      ↳ Per-account 60s cooldown enforcement                  │
│      ↳ Rolling 24-hour daily quota cap (500/account)         │
└──────────────────────────────┬───────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │                                     │
            ▼ (HTTP/2 REST)                       ▼ (REST / SMTP)
  [ Microsoft Graph API ]              [ Azure Communication Services ]
  • Uses M365 Shared Mailboxes         • Pure Pay-As-You-Go ($0.00025/mail)
  • Supreme Primary Inboxing           • High-volume unmetered pipeline
            │                                     │
            └──────────────────┬──────────────────┘
                               │
                               ▼
                       [ Recipient Inbox ]
```

---

## 2. Multi-Account Rotation Algorithm (The Anti-Spam Shield)

When sending thousands of cold outreach emails, sending them all through a single email address causes instant spam-box placement or account suspension.

Our engine solves this via the **Round-Robin Pool Manager** (`src/services/accountPool.js`):

```sql
SELECT * FROM accounts
WHERE is_active = 1
  AND sent_today < daily_limit
  AND (
    last_sent_at IS NULL
    OR (strftime('%s', 'now') - strftime('%s', last_sent_at)) >= cooldown_seconds
  )
ORDER BY last_sent_at ASC
LIMIT 1;
```

### The Math of Scaling to 40 Accounts:
* If you have **1 account** sending 1 email every 60 seconds $\to$ **60 emails / hour**.
* If you have **40 accounts** rotating with a 60-second cooldown per account:
  $$\text{Global Throughput} = \frac{40 \text{ accounts}}{60 \text{ seconds}} \approx \mathbf{1\text{ email sent every } 1.5\text{ seconds!}}$$
* **The Magic:** The server is sending emails at rapid speeds, but **from the perspective of Google and Microsoft spam filters, each individual account only sends 1 email per minute!**

---

## 3. Database Schema (SQLite in WAL Mode)

The database runs on **Node.js 24 native SQLite (`node:sqlite`)** in **Write-Ahead Logging (WAL)** mode. Zero native C++ compilation, zero external dependencies, 100% crash-proof.

```sql
-- 1. ACCOUNTS (1 to 40+ sender identities)
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'GRAPH_API',
    daily_limit INTEGER NOT NULL DEFAULT 500,
    sent_today INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT,
    cooldown_seconds INTEGER NOT NULL DEFAULT 60,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. CONTACTS (Author recipient directory)
CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    paper_title TEXT DEFAULT '',
    affiliation TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 3. TEMPLATES (Reusable dynamic templates)
CREATE TABLE templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 4. CAMPAIGNS (Broadcast batches)
CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    total_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    scheduled_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- 5. QUEUE (Atomic pipeline)
CREATE TABLE queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    contact_id INTEGER,
    account_id INTEGER,
    email TEXT NOT NULL,
    name TEXT DEFAULT '',
    subject TEXT NOT NULL,
    rendered_html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT DEFAULT '',
    sent_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- 6. LOGS (Live audit trail)
CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    account_id INTEGER,
    level TEXT NOT NULL DEFAULT 'INFO',
    message TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🔗 Related Notes (Obsidian Links)
* [[COST_BREAKDOWN_AND_BUDGET]]
* [[DEPLOYMENT_GUIDE]]
* [[../README]]
