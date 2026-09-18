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

## 5. Plesk Obsidian & Debian 12 Linux Production Deployment

Detailed infrastructure reference for hosting `azure-graph-mailer` on **Plesk Obsidian (v18.0.80) on Debian 12.15 (Linux)**.

---

### 5.1 Server Specifications & SSH Access
* **Domain / URL:** `https://mailapp.balajiimpex.store`
* **Parent Subscription Domain:** `balajiimpex.store`
* **Server IP Address:** `192.99.152.30` (Port `22`)
* **System / SSH User:** `balajiimpex.store_bml3kawopzt`
* **Shell Access Type:** `/bin/bash` (Configured in Plesk under *Hosting Settings* > *System user's credentials* > *SSH access*)
* **Home Directory:** `/var/www/vhosts/balajiimpex.store`
* **Web Root / App Directory:** `/var/www/vhosts/balajiimpex.store/mailapp.balajiimpex.store`

#### Direct Terminal Connection:
```bash
ssh balajiimpex.store_bml3kawopzt@192.99.152.30 -p 22
```

---

### 5.2 Server Runtimes: Node.js & PM2 Paths
On Plesk Debian 12, Node.js binaries live under Plesk's versioned path:
* **Node.js 22 LTS Binary:** `/opt/plesk/node/22/bin/node` (v22.23.2)
* **npm Binary:** `/opt/plesk/node/22/bin/npm` (v10.9.8)
* **Native SQLite Support:** Native `node:sqlite` verified and active.
* **PM2 Process Manager:** Installed in user prefix:
  * Binary: `/var/www/vhosts/balajiimpex.store/.npm-global/bin/pm2` (v7.0.4)
  * Exported in `~/.bashrc`:
    ```bash
    export PATH=/opt/plesk/node/22/bin:/var/www/vhosts/balajiimpex.store/.npm-global/bin:$PATH
    ```

---

### 5.3 Remote GitHub Repository Sync & CI/CD
The server directory is initialized as a live tracking Git repository:
* **Remote Origin:** `https://github.com/checkingm13-cell/azure-graph-mailer.git`
* **Branch:** `main`

#### Updating Server to Latest Commit:
Whenever code is pushed to GitHub, run this single command to pull and restart:
```bash
cd /var/www/vhosts/balajiimpex.store/mailapp.balajiimpex.store
git fetch origin main
git reset --hard origin/main
~/.npm-global/bin/pm2 restart azure-graph-mailer
```

---

### 5.4 PM2 24/7 Process Management
The application runs continuously as **`azure-graph-mailer`**:
* **Process Name:** `azure-graph-mailer`
* **Internal Port:** `5000` (`http://127.0.0.1:5000`)
* **State File:** `/var/www/vhosts/balajiimpex.store/.pm2/dump.pm2`

#### Essential Commands:
```bash
# Check status:
~/.npm-global/bin/pm2 status

# View live logs:
~/.npm-global/bin/pm2 logs azure-graph-mailer

# Restart process:
~/.npm-global/bin/pm2 restart azure-graph-mailer

# Save state for server reboots:
~/.npm-global/bin/pm2 save
```

---

### 5.5 Plesk Nginx Reverse Proxy Configuration
To route incoming traffic from `https://mailapp.balajiimpex.store` to the Node.js process on port `5000`:

1. Go to **Websites & Domains** > `mailapp.balajiimpex.store` > **Apache & nginx Settings**.
2. **Proxy Mode Note:**
   * If Proxy mode is **ON**, do **NOT** define a manual `location /` in *Additional nginx directives*, or Nginx will error with:
     ```text
     nginx: [emerg] duplicate location "/" in vhost_nginx.conf
     ```
   * **Fix:** Either turn **Proxy mode OFF** before adding the custom `location /` directive, OR use **Additional Apache directives**:
     ```apache
     ProxyPreserveHost On
     ProxyPass / http://127.0.0.1:5000/
     ProxyPassReverse / http://127.0.0.1:5000/
     ```
3. Direct Nginx configuration (with Proxy Mode OFF):
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:5000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_cache_bypass $http_upgrade;
       proxy_read_timeout 300s;
       proxy_connect_timeout 300s;
       client_max_body_size 50M;
   }
   ```

---

### 5.6 Troubleshooting Live Logs & Common Plesk Issues

#### 1. Let's Encrypt ACME Challenge Succeeded (`/.well-known/acme-challenge/` -> 200 OK)
* **Log Evidence:** Lines 64–73 in server logs showed Let's Encrypt servers connecting and receiving `200 OK` on `/.well-known/acme-challenge/`.
* **Result:** SSL certificate successfully validated and issued. HTTPS is active on `mailapp.balajiimpex.store`.

#### 2. Serving Plesk Default Page (`200 GET / HTTP/1.1`) vs Node App
* **Cause:** Default `index.html` file in `/mailapp.balajiimpex.store` intercepted requests before proxying.
* **Fix:** Deleted/renamed `index.html` to `index.html.bak`.

#### 3. Resolving 500 Error on Campaign Launch (`start is not defined`)
* **Cause:** In `src/routes/api.js`, the batch slice loop was missing `const start = i * numericBatchSize; const end = start + numericBatchSize;`.
* **Fix:** Added `start` and `end` definitions in commit `1f17bb7`, synced to server, and restarted PM2.

---

## 🔗 Related Notes (Obsidian Links)
* [[ALGORITHM_TIMING_SCHEDULING_AND_WORKERS_DSA]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]
* [[README]]
