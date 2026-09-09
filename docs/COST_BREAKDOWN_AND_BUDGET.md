---
title: "Azure Multi-Account Mailer - Cost Breakdown & Monthly Budget"
date: 2026-09-09
tags:
  - azure
  - billing
  - cold-email
  - graph-api
  - system-architecture
  - obsidian-vault
aliases:
  - Cost Breakdown
  - Budget & Pricing
---

# 💰 Azure Multi-Account Mailer: Complete Cost Breakdown & Budget

> [!NOTE] 
> **Obsidian Integration:** This vault document outlines the exact, transparent monthly expenses for operating the **40-Account Azure Multi-Account Mailer**. There are zero hidden fees.

---

## 💳 Mandatory Monthly Expenses (Only 2 Paid Services)

To run this automated cold email infrastructure 24/7/365 in the cloud, you only pay for **two specific items**:

### 1. Microsoft 365 Admin Center (Email Identity & Engine)
* **What to buy:** 1x **Microsoft 365 Business Basic** License.
* **Why it's needed:** Microsoft Graph API requires an active Exchange Online tenant to route mail.
* **The Multiplier Secret:** Under this **ONE single license**, Microsoft allows you to create **unlimited Shared Mailboxes for FREE** (`account1@domain.com`, `account2@domain.com`, ..., `account40@domain.com`).
* **Monthly Cost:** ~$7.00/month = **~₹600 / month** (₹580 + 18% GST).
* **Where to pay:** [admin.microsoft.com](https://admin.microsoft.com) (Billing > Purchase Services).
* *Note:* You do **NOT** pay 40 × ₹600 = ₹24,000. You pay only **₹600 total** for all 40 accounts combined!

### 2. Microsoft Azure Portal (24/7 App Hosting & Worker Compute)
* **What to buy:** **Azure App Service** (Linux, Node.js 20 LTS).
* **Plan Tier:** **Basic B1 Tier** (1 vCPU, 1.75 GB RAM, 10 GB Disk).
* **Why B1:** Free (F1) tier lacks the **"Always On"** feature. B1 has "Always On" enabled, ensuring the background queue worker never goes to sleep when your laptop is turned off.
* **Monthly Cost:** ~$13.00/month = **~₹1,100 / month** (₹930 + 18% GST).
* **Where to pay:** [portal.azure.com](https://portal.azure.com) (Azure Subscriptions > Pay-As-You-Go card auto-debit at month end).

---

## 🎁 Everything That is 100% FREE (₹0.00 Cost)

| Service / Feature | Actual Cost | Why It Is Free |
| :--- | :--- | :--- |
| **Microsoft Graph API Calls** | **₹0.00** | Microsoft does not charge per API request. |
| **SQLite WAL Database** | **₹0.00** | Stored inside `/home/data/mailer.db` on your App Service persistent disk. Zero need for expensive Azure SQL ($15–$30/mo). |
| **Unlimited Shared Mailboxes** | **₹0.00** | Created under your 1 M365 tenant license. 40 mailboxes cost ₹0 extra. |
| **Outbound Data Transfer** | **₹0.00** | First 100 GB of outbound data per month from Azure is free (emails take < 500 MB). |
| **Domain DNS Setup** | **₹0.00** | Configured via your existing domain registrar (`theparipexjournal.com`). |

---

## 📊 Summary Budget Table

| Expense Item | Provider | Monthly Cost (INR) | Monthly Cost (USD) |
| :--- | :--- | :--- | :--- |
| 1x Microsoft 365 Business Basic | Microsoft 365 Admin | ~₹600 / month | $7.00 / month |
| 1x Azure App Service (Linux B1) | Microsoft Azure Cloud | ~₹1,100 / month | $13.00 / month |
| Database, API Calls, 40 Mailboxes | Embedded / Tenant | **₹0.00** | **$0.00** |
| **TOTAL ESTIMATED MONTHLY SPEND** | | **~₹1,700 / month** | **~$20.00 / month** |

---

## ⏳ Safe Payment Timeline (Do NOT Pay Anything Today!)

1. **Step 1 (Today):** **₹0 Cost.** The entire system is built and tested locally on your machine (`D:\projects\azure-graph-mailer`). All database schemas, rotation logic, and web dashboard functions run locally.
2. **Step 2 (Before Deployment):** When the code is 100% verified, you create the Azure App Service (B1) and purchase the single $7 M365 license.
3. **Step 3 (Production Launch):** Connect your custom domain, add your 40 shared mailboxes into the pool, and begin 24/7 sending.

---

## 🔗 Related Notes (Obsidian Links)
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[DEPLOYMENT_GUIDE]]
* [[../README]]
