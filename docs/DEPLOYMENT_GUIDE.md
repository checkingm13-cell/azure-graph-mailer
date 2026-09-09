---
title: "Azure Multi-Account Mailer - Deployment & Setup Guide"
date: 2026-09-09
tags:
  - azure
  - deployment
  - app-service
  - devops
  - obsidian-vault
aliases:
  - Deployment Guide
  - How to Deploy
---

# 🚀 Azure Multi-Account Mailer: Production Deployment Guide

> [!NOTE]
> **Obsidian Integration:** Step-by-step operational guide to deploying `azure-graph-mailer` to Azure App Service Linux.

---

## 1. Prerequisites Checklist

Before deploying, ensure you have:
1. **Active Azure Subscription** (Pay-As-You-Go).
2. **Microsoft Entra ID App Registration** (Already created! Client ID: `172c86cf...`).
3. **Microsoft 365 Business Basic License** ($7/mo in M365 Admin Center).
4. **Git** installed on your local machine.

---

## 2. Step-by-Step Azure Deployment

### Step 1: Create Azure App Service (Linux)
1. Go to [portal.azure.com](https://portal.azure.com).
2. Click **Create a resource** $\to$ **Web App**.
   * **Subscription:** Your Pay-As-You-Go subscription.
   * **Resource Group:** Create new or select existing (e.g., `rg-mailer`).
   * **Name:** `azure-graph-mailer-prod` (must be globally unique).
   * **Publish:** Code.
   * **Runtime stack:** **Node 20 LTS**.
   * **Operating System:** **Linux**.
   * **Pricing Plan:** **Basic B1** ($13/month).
3. Click **Review + Create** $\to$ **Create**.

---

### Step 2: Enable "Always On" (CRITICAL)
Without this setting, Azure App Service will sleep after 20 minutes of no web traffic, pausing your queue worker.
1. In your App Service, go to **Configuration** (or **Configuration $\to$ General settings**).
2. Find **Always On** and switch it to **On**.
3. Startup Command: enter `node src/app.js`.
4. Click **Save**.

---

### Step 3: Configure Environment Variables in Azure
In the Azure Portal under **Settings $\to$ Environment variables** (or **Configuration**), add the following:

| Setting Name | Value |
| :--- | :--- |
| `PORT` | `8080` (or leave default) |
| `NODE_ENV` | `production` |
| `DB_PATH` | `/home/data/mailer.db` *(Ensures persistence!)* |
| `DEFAULT_PROVIDER` | `GRAPH_API` |
| `AZURE_TENANT_ID` | `c1288b66-155d-4381-997b-ac06a073e27d` |
| `AZURE_CLIENT_ID` | `your-azure-client-id` |
| `AZURE_CLIENT_SECRET` | `your-azure-client-secret` |
| `DEFAULT_SENDER_EMAIL` | `editor@mail.theparipexjournal.com` |
| `GLOBAL_SEND_INTERVAL_MS` | `2500` |
| `DEFAULT_ACCOUNT_DAILY_LIMIT` | `500` |
| `ACCOUNT_COOLDOWN_SECONDS` | `60` |

Click **Apply** $\to$ **Confirm**.

---

### Step 4: Deploy Code from Local Machine

#### Option A: Deploy via VS Code (Easiest, 2 Clicks)
1. Open folder `D:\projects\azure-graph-mailer` in VS Code.
2. Install the official **Azure App Service** extension.
3. Sign into Azure.
4. Right-click the folder $\to$ select **Deploy to Web App...**
5. Select `azure-graph-mailer-prod`. Done!

#### Option B: Deploy via Git / GitHub
1. Create a private GitHub repository: `azure-graph-mailer`.
2. Push your local code:
   ```bash
   git add .
   git commit -m "feat: complete multi-account mailer engine"
   git push origin main
   ```
3. In Azure Portal $\to$ **Deployment Center** $\to$ connect GitHub $\to$ pick branch `main`. Azure will automatically build and deploy!

---

## 3. Post-Deployment Verification
1. Open `https://<your-app-name>.azurewebsites.net` in your browser.
2. You will see the **Azure Multi-Account Mailer Control Center** dashboard live.
3. Add your sender accounts in the **Sender Accounts Pool** tab.
4. Upload your CSV of authors in the **Contacts Directory** tab.
5. Launch your broadcast in the **Launch Campaign** tab.

---

## 🔗 Related Notes (Obsidian Links)
* [[COST_BREAKDOWN_AND_BUDGET]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[../README]]
