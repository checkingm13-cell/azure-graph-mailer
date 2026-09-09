---
title: "Microsoft 365 Free Shared Mailbox & Send-As Setup Guide"
tags:
  - obsidian
  - m365
  - shared-mailbox
  - send-as
  - permissions
  - zero-cost
date: 2026-09-09
aliases:
  - Shared Mailbox Setup Guide
  - Free M365 Email Guide
---

# Microsoft 365 Free Shared Mailbox & Send-As Setup Guide

> **Official Step-by-Step Walkthrough for Creating Unlimited FREE Sender Accounts for Microsoft Graph API without paying extra per-user licensing fees.**

Related Notes:
- [[MICROSOFT_GRAPH_API_SPEC_AND_PERMISSIONS]]
- [[MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]]
- [[COST_BREAKDOWN_AND_BUDGET]]
- [[DEPLOYMENT_GUIDE]]
- [[ARCHITECTURE_AND_SYSTEM_DESIGN]]

---

## 🎯 Why Shared Mailboxes?
In Microsoft 365, a regular user mailbox requires a paid monthly license ($7/user/month). If you need 10 to 40 accounts for cold email rotation, paying for 40 separate licenses would cost ~$280/month (~₹25,000/month).

**The Solution:**
Microsoft allows any tenant with at least **1 valid paid base license** (e.g. M365 Business Basic) to create **unlimited Shared Mailboxes at ₹0.00 (100% FREE)**. Each shared mailbox gets up to 50 GB storage, full Exchange Online delivery reputation, and its own unique email address (`noreply@theparipexjournal.com`, `editor@theparipexjournal.com`, `outreach01@theparipexjournal.com`, etc.).

---

## 📋 Step-by-Step Setup Instructions

### Step 1: Create the FREE Shared Mailbox
1. Log into the **Microsoft 365 Admin Center**: [admin.microsoft.com](https://admin.microsoft.com).
2. In the left navigation menu, expand **Teams & groups**, then click **Shared mailboxes**.
3. At the top of the list, click the **+ Add a shared mailbox** button.
4. Fill in the form:
   * **Name / Display Name:** `Journal Automation` (or any human-readable sender name).
   * **Email address:** `noreply` @ `theparipexjournal.com` (select your verified custom domain from the dropdown).
5. Click **Save changes** (or **Add**).
6. *(Scaling to 40 Accounts)*: Repeat this step for each cold outreach identity you want in your rotation pool:
   * `outreach01@theparipexjournal.com`
   * `outreach02@theparipexjournal.com`
   * `editor@theparipexjournal.com`
   *(All of them are 100% free with zero extra monthly license cost!)*

---

### Step 2: Configure "Send As" Permissions (Critical for Delivery)
Microsoft Graph API requires the identity executing the call to have authorization to send on behalf of the shared mailbox.

1. In the **Shared mailboxes** list, click on your newly created mailbox (e.g., `noreply@theparipexjournal.com`).
2. A flyout panel will open on the right.
3. Under the **Members** section:
   * Click **Edit** under **Members** $\to$ Click **+ Add members** $\to$ Select your primary Admin account (e.g., **Hamza Memon**) $\to$ Click **Save**.
4. Under the **Send as permissions** section:
   * Click **Edit** (or **Manage Send As permissions**).
   * Click **+ Add permissions** $\to$ Select **Send as** $\to$ Select your Admin account $\to$ Click **Save**.
5. *(Optional)* Under **Read and manage permissions**:
   * Add your Admin account so you can open this mailbox's inbox directly inside Outlook on the web if you ever need to inspect incoming replies or test messages.

---

### Step 3: Verify Azure Entra ID App Registration & Permissions
Confirm that your background automation engine has the required tenant-wide application permissions:

1. Open the **Azure Portal**: [portal.azure.com](https://portal.azure.com).
2. Navigate to **Microsoft Entra ID** $\to$ **App registrations** $\to$ Click the **All applications** tab.
3. Select your application: **`JournalParipex-Email-Automation`** (Client ID: `172c86cf-bf4f-491d-a2dd-6d777a25e349`).
4. In the left menu, select **API permissions**.
5. Verify that:
   * **API / Permissions name:** `Microsoft Graph` $\to$ **`Mail.Send`**
   * **Type:** `Application`
   * **Status:** `Granted for [Your Organization / World Wide Journals]` with a green checkmark ✅.
   *(If not granted, click "Grant admin consent for [Organization]" at the top).*

---

### Step 4: Configure Your Local & Cloud `.env` File
Once your shared mailbox is created, update your environment variables:

```env
# Default Sender Mailbox (Your verified shared mailbox)
DEFAULT_SENDER_EMAIL=noreply@theparipexjournal.com
```

In your SQLite database or Web UI Dashboard (`http://localhost:5000` $\to$ Sender Accounts):
1. Click **+ Add Account**.
2. Enter Email: `noreply@theparipexjournal.com`
3. Set Daily Limit: `500` (or `25` during initial warmup week).
4. Set Cooldown: `60` seconds.
5. Click **Save**.

---

## 🧪 Verification: Send a Real Test Email via Graph API

To verify that Microsoft Graph API can successfully send through your new Shared Mailbox, run the test script:

```bash
# In your terminal:
node tests/send-real-test.js
```

### Expected Output:
```text
[GraphClient] Authenticating with Entra ID using Client Credentials...
[GraphClient] Dispatching email from: noreply@theparipexjournal.com
[GraphClient] Target recipient: your-personal-email@gmail.com
[GraphClient] HTTP 202 Accepted: Message queued by Exchange Online!
✅ TEST EMAIL DELIVERED SUCCESSFULLY! Check your inbox.
```
