---
title: "Azure Web App CI/CD Pipeline & Fast Deployment Guide"
date: 2026-09-16
tags:
  - azure
  - deployment
  - app-service
  - github-actions
  - devops
  - obsidian-vault
aliases:
  - Deployment Guide
  - CI/CD Pipeline
---

# 🚀 Azure Web App CI/CD Pipeline & Fast Deployment Guide

> [!NOTE]
> Production deployment configuration for `paripex-mailer-app` hosted on Azure App Service (Linux Node 20 LTS) via GitHub Actions.

---

## 1. Fast Deployment Architecture

Earlier pipeline deployments took **2 to 3+ minutes** due to uploading uncompressed folders with tens of thousands of `node_modules` files and remote Oryx build execution.

The optimized deployment runs in **under 35 seconds**:

```
[ Git Push to main ]
        │
        ▼
[ GitHub Runner ] ──► [ npm ci --omit=dev ] ──► [ Create release.zip ]
                                                        │ (1 single compressed stream)
                                                        ▼
                                             [ azure/webapps-deploy@v3 ]
                                                        │
                                                        ▼
                                       [ Azure App Service Kudu ]
                                       (Instant Mount & Worker Boot)
```

---

## 2. GitHub Actions Workflow Configuration

Located at `.github/workflows/main_paripex-mailer-app.yml`:

```yaml
name: Rapid & Secure Azure Web App Deployment

on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js LTS
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install Production Dependencies
        run: npm ci --omit=dev

      # Package directly into a single zip (exclude dev/test files)
      - name: Create Clean Deployment Archive
        run: |
          zip -q -r release.zip . -x ".git/*" ".github/*" "tests/*" "*.md"

      - name: Login to Azure
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZUREAPPSERVICE_CLIENTID_EECFD65A373B4B7B964F0D953BC008D4 }}
          tenant-id: ${{ secrets.AZUREAPPSERVICE_TENANTID_ADDF7064233A4843AD97AC6BDD366422 }}
          subscription-id: ${{ secrets.AZUREAPPSERVICE_SUBSCRIPTIONID_B86E2BDB93B14E92B6BD707FD34B6FE2 }}

      # Direct Zip Deploy to Azure App Service
      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v3
        with:
          app-name: 'paripex-mailer-app'
          slot-name: 'Production'
          package: release.zip
```

---

## 3. Environment Variables (Azure App Service Portal)

Set these under **Configuration $\to$ Application Settings** in Azure Portal:

| Setting Key | Example Value | Description |
|---|---|---|
| `PORT` | `5000` | Port Express listens on. |
| `NODE_ENV` | `production` | Production runtime flags. |
| `DB_PATH` | `data/mailer.db` | SQLite WAL database file path. |
| `DEFAULT_PROVIDER` | `GRAPH_API` | Primary fallback provider (`GRAPH_API`, `AZURE_ACS`, `OCI`). |
| `AZURE_COMMUNICATION_CONNECTION_STRING` | `endpoint=https://<resource>.communication.azure.com/;accesskey=<key>` | Azure Communication Services endpoint & key. |
| `ACS_SENDER_EMAIL` | `DoNotReply@mail.theparipexjournal.com` | Verified ACS sender mailbox. |
| `GLOBAL_SEND_INTERVAL_MS` | `100` | Dispatch delay between consecutive emails. |
| `DEFAULT_ACCOUNT_DAILY_LIMIT` | `1000` | Default daily limit assigned to new accounts. |

---

## 4. Troubleshooting Common Deployment Issues

### A. Missing `endpoint=` in ACS Connection String
- **Symptom:** `Invalid connection string https://...` in queue error log.
- **Fix:** Ensure the string starts with `endpoint=`. The engine in `src/services/acsMailer.js` now auto-prepends `endpoint=` defensively if omitted.

### B. Azure App Service Sleep / Inactivity
- **Fix:** In Azure Portal $\to$ App Service $\to$ **Configuration** $\to$ **General Settings** $\to$ ensure **Always On** is set to **On**.

---

## 🔗 Related Notes (Obsidian Links)
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]
* [[README]]
