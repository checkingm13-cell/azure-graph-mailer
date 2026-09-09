---
title: "Multi-Account Cold Email Warmup & Anti-Spam Strategy"
tags:
  - obsidian
  - anti-spam
  - deliverability
  - m365
  - warmup
date: 2026-09-09
aliases:
  - Deliverability & Anti-Spam Guide
  - Multi-Account Warmup Plan
---

# Multi-Account Cold Email Warmup & Anti-Spam Strategy

This guide details how to configure custom domain DNS, execute safe mailbox warmup, and scale cold email volume to **thousands of emails per day** while maintaining **98%+ primary inbox placement** and avoiding spam filters or provider bans.

Related Notes:
- [[MICROSOFT_GRAPH_API_SPEC_AND_PERMISSIONS]]
- [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
- [[COST_BREAKDOWN_AND_BUDGET]]

---

## 1. Forensics: Why Did Google Multi-Send Fail?

In `read-from-this.txt`, attempts to send volume through standard Google multi-send generated bounce notifications:
```
From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>
Subject: Messages not sent (over daily email limit)
Your message wasn't sent because you've reached the daily sending limit.
```

### The Root Cause:
1. **Google Multi-Send Limits:**
   - Standard Google Workspace has a 1,500 to 2,000 email daily limit, but **multi-send mode has an internal daily limit of 1,500 external recipients** that is dynamically lowered if emails are sent in burst intervals.
   - Sending hundreds of emails in quick succession triggers automated abuse heuristic engines, suspending outgoing mail for 24 hours.
2. **The "Single Cannon" Fallacy:**
   - Attempting to send 2,000+ emails from **one single email address** guarantees spam folder relegation and mailbox throttling.
3. **The Solution (Distributed Sender Pool):**
   - Instead of 1 account sending 2,000 emails, configure **40 accounts each sending 50 emails**.
   - To spam filters (SpamAssassin, Barracuda, Google Postmaster), 50 emails/day appears as normal human conversational traffic.

---

## 2. DNS Authentication: SPF, DKIM, and DMARC

Before sending a single live email from your domain (`theparipexjournal.com` or `mail.theparipexjournal.com`), you **must** configure these three DNS records in your domain registrar (GoDaddy, Cloudflare, Namecheap):

### 1. SPF (Sender Policy Framework) - TXT Record
Validates that Microsoft 365 servers are authorized to send on behalf of your domain.
- **Host / Name:** `@` (or `mail` if using subdomain `mail.theparipexjournal.com`)
- **Type:** `TXT`
- **Value:** `v=spf1 include:spf.protection.outlook.com -all`

### 2. DKIM (DomainKeys Identified Mail) - 2x CNAME Records
Cryptographically signs every outgoing email header. Set up in Microsoft 365 Admin Center -> Security -> DKIM.
- **Record 1:**
  - **Host:** `selector1._domainkey`
  - **Type:** `CNAME`
  - **Value:** `selector1-theparipexjournal-com._domainkey.YOUR_TENANT.onmicrosoft.com`
- **Record 2:**
  - **Host:** `selector2._domainkey`
  - **Type:** `CNAME`
  - **Value:** `selector2-theparipexjournal-com._domainkey.YOUR_TENANT.onmicrosoft.com`

### 3. DMARC (Domain-based Message Authentication) - TXT Record
Enforces policy if SPF or DKIM fail.
- **Host / Name:** `_dmarc`
- **Type:** `TXT`
- **Value:** `v=DMARC1; p=none; sp=none; pct=100; rua=mailto:dmarc-reports@theparipexjournal.com`

---

## 3. Account Warmup Schedule (4-Week Ramp-Up)

New domains and fresh mailboxes have **zero sender reputation**. Blasting 500 emails on Day 1 will permanently destroy domain reputation. 

Follow this automated ramp-up matrix:

| Week | Daily Limit Per Account | Cooldown Between Sends | 10 Accounts Volume/Day | 40 Accounts Volume/Day |
| :--- | :--- | :--- | :--- | :--- |
| **Week 1** | **15 emails / day** | **180 seconds (3 min)** | 150 emails | 600 emails |
| **Week 2** | **35 emails / day** | **120 seconds (2 min)** | 350 emails | 1,400 emails |
| **Week 3** | **75 emails / day** | **90 seconds (1.5 min)** | 750 emails | 3,000 emails |
| **Week 4+** | **150-250 emails / day** | **60 seconds (1 min)** | **1,500 - 2,500 emails** | **6,000 - 10,000 emails** |

> [!TIP]
> In `azure-graph-mailer`, you can adjust the `daily_limit` and `cooldown_seconds` per account in 1 click from the Dashboard UI (`/api/accounts`) or SQL without restarting the server!

---

## 4. Cold Outreach Content Guidelines (Bypassing Filters)

1. **Personalization Merge Tags:**
   - Every email MUST include dynamic tags: `{{Name}}`, `{{Paper_Title}}`, `{{Affiliation}}`. Emails with identical content across 500 recipients trigger Bayesian spam filters.
2. **Text-to-Link Ratio:**
   - Maximum 1 or 2 links per email. Never use raw URL shorteners (bit.ly, tinyurl).
   - Use clean, full domain hyperlinks.
3. **Opt-Out / Unsubscribe Mechanism:**
   - Include a polite one-line opt-out sentence at the bottom:
     `"If you do not wish to receive further calls for papers, please reply with 'unsubscribe' and we will remove your contact."`
   - Mark unsubscribes in the dashboard immediately to maintain zero spam complaints.
