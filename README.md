---
title: "Azure Multi-Account Mailer - Obsidian Vault & Project Overview"
date: 2026-09-09
tags:
  - azure
  - email-engine
  - multi-account
  - graph-api
  - readme
  - obsidian-vault
aliases:
  - Azure Graph Mailer
  - Main Index
---

# ⚡ Azure Multi-Account Mailer Engine

> **Enterprise-grade, 24/7 cold email infrastructure supporting 1 to 40+ sender accounts using Microsoft Graph API & Azure Communication Services.**

[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org)
[![Database](https://img.shields.io/badge/Database-SQLite%20(WAL)-blue.svg)](https://sqlite.org)
[![Cloud](https://img.shields.io/badge/Cloud-Azure%20App%20Service-blue.svg)](https://azure.microsoft.com)
[![License](https://img.shields.io/badge/Cost-~₹1,700/month-emerald.svg)](#)

---

## 📚 Obsidian Vault Knowledge Base

This folder is configured as an **Obsidian-ready vault**. You can open `D:\projects\azure-graph-mailer` directly in Obsidian to browse all linked technical documentation:

* 💰 **[[docs/COST_BREAKDOWN_AND_BUDGET]]**: Complete monthly expense calculation (~₹1,700/mo total), free vs paid features, and how 1 M365 license powers 40 accounts for ₹0 extra.
* 🏗️ **[[docs/ARCHITECTURE_AND_SYSTEM_DESIGN]]**: Detailed multi-account rotation algorithm, database schema, and Graph API vs ACS technical comparison.
* 📜 **[[docs/MICROSOFT_GRAPH_API_SPEC_AND_PERMISSIONS]]**: Deep-dive into Microsoft Graph `Mail.Send` permissions, `POST /users/{id}/sendMail` schema, `202 Accepted` responses, and 429 throttling policies.
* 🛡️ **[[docs/MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]]**: Deliverability physics, Google Multi-Send bounce post-mortem, SPF/DKIM/DMARC setup, and 4-week mailbox warmup ramp schedule.
* 🚀 **[[docs/DEPLOYMENT_GUIDE]]**: Step-by-step instructions for deploying to Azure App Service Linux with "Always On" persistence.

---

## 🌟 Key Features

1. **Multi-Account Fair Rotation:** Rotates dispatches across 1 to 40+ sender mailboxes using fair round-robin scheduling, ensuring no single mailbox exceeds anti-spam rate limits.
2. **Strict Anti-Spam Pacing:**
   * Global 2.5s pacing (24 emails/minute maximum).
   * Per-account 60s cooldown intervals.
   * Rolling 24-hour daily quota caps (default 500 emails/account).
3. **Dual Provider Support:** Supports both **Microsoft Graph API** (via M365 Shared Mailboxes for primary inboxing) and **Azure Communication Services (ACS)** (pure pay-as-you-go).
4. **Crash & Restart Proof:** Built on Node.js native SQLite in Write-Ahead Logging (WAL) mode. Persistent storage at `/home/data/mailer.db` survives reboots with zero data loss.
5. **Modern Browser Dashboard:** Real-time account pool fuel gauges, CSV contact drag-and-drop parser, dynamic template editor, and live terminal logs.

---

## ⚡ Quick Start (Run Locally)

### 1. Install Dependencies
```bash
npm install
```

### 2. Verify Database & Authentication Handshake
```bash
npm run test:db    # Tests SQLite WAL transactions
npm run test:pool  # Tests multi-account rotation & cooldowns
npm run test:auth  # Tests real Microsoft Entra ID token handshake
```

### 3. Start Local Server
```bash
npm start
```
Open your browser to: **`http://localhost:5000`**

---

## 📡 REST API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Engine state, queue counts, and pool telemetry |
| `POST` | `/api/worker/pause` | Pauses 24/7 background queue worker |
| `POST` | `/api/worker/resume` | Resumes background queue worker |
| `GET` | `/api/accounts` | Lists all sender accounts in the pool |
| `POST` | `/api/accounts` | Adds a new sender account to the pool |
| `DELETE`| `/api/accounts/:id` | Removes an account from the pool |
| `POST` | `/api/contacts/upload`| Parses and saves CSV author directory |
| `GET` | `/api/templates` | Lists saved email templates |
| `POST` | `/api/templates` | Creates or edits an email template |
| `POST` | `/api/campaigns/create`| Enqueues a broadcast batch across the pool |
| `GET` | `/api/logs` | Real-time audit log stream |

---

## 📁 Repository Structure

```text
D:\projects\azure-graph-mailer\
├── .env                        # Active Entra ID & server credentials
├── .env.example                # Configuration template
├── .gitignore                  # Git exclusions (node_modules, data, .env)
├── package.json                # Pure Node.js dependencies
├── README.md                   # Project overview & Obsidian entry
├── docs/                       # Obsidian Vault Documentation
│   ├── COST_BREAKDOWN_AND_BUDGET.md
│   ├── ARCHITECTURE_AND_SYSTEM_DESIGN.md
│   ├── MICROSOFT_GRAPH_API_SPEC_AND_PERMISSIONS.md
│   ├── MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM.md
│   └── DEPLOYMENT_GUIDE.md
├── src/
│   ├── app.js                  # Main Express server entry point
│   ├── config/env.js           # Validated environment configuration
│   ├── db/
│   │   ├── index.js            # Node.js 24 native SQLite connection (WAL)
│   │   └── schema.js           # 6-table database migration schema
│   ├── graph/graphClient.js    # Entra ID token & Graph SDK client
│   ├── services/
│   │   ├── accountPool.js      # Multi-account rotation algorithm
│   │   ├── graphMailer.js      # Microsoft Graph sendMail dispatcher
│   │   ├── acsMailer.js        # Azure Communication Services fallback
│   │   ├── queueWorker.js      # 24/7 background worker loop
│   │   └── templateEngine.js   # Dynamic tag merger ({{Name}}, etc.)
│   └── routes/api.js           # REST API endpoints
├── public/                     # Operational Web Dashboard
│   ├── index.html              # Modern dark-theme control panel
│   ├── css/style.css           # Responsive styles & fuel gauges
│   └── js/app.js               # Frontend telemetry & AJAX controller
├── tests/                      # Automated Verification Tests
│   ├── db-test.js              # Database integrity & transactions
│   ├── pool-test.js            # Multi-account rotation & quotas
│   └── graph-auth-test.js      # Entra ID OAuth handshake test
└── data/                       # Local SQLite database (git-ignored)
    └── mailer.db
```
