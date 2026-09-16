---
title: "Production Architecture & Multi-Account Dispatch Engine"
date: 2026-09-16
tags:
  - architecture
  - multi-account
  - routing
  - graph-api
  - acs
  - oci
  - obsidian-vault
aliases:
  - System Architecture
  - Engine Design
---

# 🏗️ Production Architecture & Multi-Account Dispatch Engine

> [!NOTE]
> Updated September 2026: Multi-Provider Email Engine (Microsoft Graph API, Azure Communication Services, Oracle Cloud OCI SMTP) with automated batch-splitting, dynamic sender link rewriting, and live account pool management.

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
 (WAL Concurrency)    (Dynamic Tag & Linker)      (Atomic Lease Loop)
                                                         │
                                    ┌────────────────────┴────────────────────┐
                                    ▼                                         ▼
                            [ Smart Rotation ]                       [ Controlled Send ]
                          (Round-Robin by least                     (Pinned single sender
                             recent dispatch)                        with pool fallback)
                                    │                                         │
                 ┌──────────────────┼─────────────────────────┐               │
                 ▼                  ▼                         ▼               ▼
         [ Microsoft 365 ]   [ Azure ACS ]              [ Oracle OCI ] ◄──────┘
         (Graph REST API)    (Azure Cloud SDK)         (SMTP Relay Port 587)
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

The pool manager (`src/services/accountPool.js`) implements atomic round-robin dispatch:

1. **Least-Recently Dispatched Lease**:
   Accounts are sorted by `last_sent_at ASC NULLS FIRST`. The mailbox that has rested longest gets the next outgoing email.
2. **Quota Tracking**:
   Rolling 24-hour window tracked against `sent_today < daily_limit`.
3. **1-Click Quota Resets**:
   Admins can reset daily counters back to `0` or update limits across the entire pool with 1 click.
4. **Automated Cooldown & Backoff**:
   - HTTP 429 (Graph rate-limiting): Automatically places account on a 120s cooldown and yields message to sibling mailbox.
   - SMTP 455 (OCI rate-limiting): Automatically places account on a 60s cooldown and yields message.

---

## 🔗 Related Notes (Obsidian Links)
* [[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]
* [[DEPLOYMENT_GUIDE]]
* [[MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]]
* [[README]]
