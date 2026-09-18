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

## 5. Plesk Obsidian & Debian 12 Linux Deployment (VPS / Dedicated)

For hosting on standard Linux servers managed with **Plesk Obsidian (Debian 12.15)** (as referenced in `read-from-this.txt`):

### 5.1 Server Access & Prerequisites
1. **Enable SSH Access**:
   * In Plesk, navigate to **Websites & Domains** > Target Domain (e.g., `mailer.yourdomain.com`).
   * Click **Web Hosting Access** (or **FTP & SSH Access**).
   * Switch **Access to the server over SSH** from *Forbidden* to `/bin/bash`.
   * Set a password for the system user.
2. **Verify Node.js Version**:
   * Connect via SSH: `ssh your_user@your_server_ip -p 22`
   * Check Node version: `node -v` (Must be **Node.js 20 LTS** or **22 LTS** for native `node:sqlite`).
   * If Node.js is missing, install via NodeSource:
     ```bash
     curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
     apt-get install -y nodejs
     ```

### 5.2 Automated GitHub CI/CD Deployment via Plesk Git Extension

Plesk includes a native **Git** extension that auto-pulls from GitHub on commit:

1. In Plesk, navigate to **Websites & Domains** > `mailapp.balajiimpex.store` > **Git**.
2. Configure repository settings:
   * **Remote repository**: Selected
   * **Repository URL**: `https://github.com/checkingm13-cell/azure-graph-mailer/`
   * **Username**: `checkingm13-cell`
   * **Password**: *GitHub Personal Access Token (Classic with `repo` scope)*
   * **Repository name**: `mailapp.git`
   * **Deployment mode**: **Automatic**
   * **Server path**: `/mailapp.balajiimpex.store` (or `/httpdocs`)
3. Check **Enable additional deployment actions** and paste:
   ```bash
   npm install --omit=dev
   if ! command -v pm2 &> /dev/null; then
       npm install -g pm2
   fi
   pm2 restart mailapp || pm2 start src/app.js --name "mailapp"
   pm2 save
   ```
4. Click **OK**. Any `git push origin main` will now automatically pull, install packages, and restart PM2 without manual server access.

### 5.3 Manual CLI Deployment & Background PM2 Setup
```bash
# Navigate to web root
cd /var/www/vhosts/balajiimpex.store/mailapp.balajiimpex.store

# Clone repository or pull latest
git clone https://github.com/checkingm13-cell/azure-graph-mailer/ .

# Install production dependencies
npm install --omit=dev

# Verify environment file (.env)
cat << 'EOF' > .env
PORT=5000
NODE_ENV=production
DB_PATH=data/mailer.db
API_KEY=your_secure_api_key
EOF

# Install PM2 globally and launch
npm install -g pm2
pm2 start src/app.js --name "mailapp"
pm2 save
pm2 startup
```

### 5.4 Nginx Reverse Proxy Configuration in Plesk
1. In Plesk, go to **Websites & Domains** > **Apache & nginx Settings**.
2. Under **Additional nginx directives**, insert:
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
### 5.5 Troubleshooting Live Logs & Common Plesk Issues

#### 1. Let's Encrypt ACME Challenge Succeeded (`/.well-known/acme-challenge/` -> 200 OK)
* **Log Evidence:** Lines 64–73 in `read-from-this.txt` show Let's Encrypt servers connecting and receiving `200 OK` on `/.well-known/acme-challenge/`.
* **Result:** Your SSL certificate has been successfully validated and issued! HTTPS is now working.

#### 2. Serving Plesk Default Page (`200 GET / HTTP/1.1`) vs Node App
* **Log Evidence:** Lines 74–92 show incoming visitors getting `200 GET / HTTP/1.1` (size 4.93 KB, which is Plesk's default `index.html` placeholder).
* **Fix:** To replace the default placeholder with your mailer dashboard:
  1. Go to **Websites & Domains** > `mailapp.balajiimpex.store` > **Apache & nginx Settings**.
  2. In **Additional nginx directives**, ensure the `proxy_pass http://127.0.0.1:5000;` block from Section 5.4 is present.
  3. Ensure **Proxy mode** is checked or uncheck **Serve static files directly by nginx** so Nginx forwards `/` to Node.js port 5000.
  4. In Plesk **Files**, delete or rename `index.html` in `/mailapp.balajiimpex.store` if Apache is serving it before the proxy.

#### 3. Resolving `500 GET /favicon.ico` Error
* **Log Evidence:** Line 76 shows `500 GET /favicon.ico`.
* **Fix:** Express requires `public/favicon.ico` or a favicon handler to prevent Apache fallback from generating 500 errors. The app serves static assets from `/public`. Ensure `express.static(path.join(__dirname, '../public'))` is enabled in `src/app.js`.

---

## 🔗 Related Notes (Obsidian Links)
* [[ALGORITHM_TIMING_SCHEDULING_AND_WORKERS_DSA]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]
* [[README]]
