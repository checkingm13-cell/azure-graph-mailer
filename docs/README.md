---
title: "Azure Graph Mailer - Obsidian Documentation Vault"
tags:
  - obsidian
  - index
  - architecture
  - documentation
date: 2026-09-16
---

# 📚 Azure Graph Mailer — Knowledge Base & Vault Index

Welcome to the **Azure Graph Mailer** Obsidian Vault. This vault documents the full multi-provider architecture, deployment CI/CD pipelines, templates, anti-spam warmup rules, and operational troubleshooting SOPs.

---

## 🚨 Critical Troubleshooting & NDR Fixes
- **[[MICROSOFT_550_5_7_708_ERROR_DIAGNOSIS_AND_FIX]]**
  *Complete analysis and step-by-step SOP for fixing NDR error `550 5.7.708 (Access denied, traffic not accepted from this IP)`.*
- **[[DEPLOYMENT_GUIDE#4-troubleshooting-common-deployment-issues]]**
  *Fixes for Azure ACS `Invalid connection string` and Azure App Service sleep timeout.*

---

## 🏗️ Architecture & Specifications
- **[[ARCHITECTURE_AND_SYSTEM_DESIGN]]**: High-performance multi-provider engine (Graph API, Azure ACS, Oracle OCI SMTP), fair rotation, and dynamic link rewriting.
- **[[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]**: Production batch dispatch engine, rate limits, and staggered queue scheduling.
- **[[MICROSOFT_GRAPH_API_SPEC_AND_PERMISSIONS]]**: Microsoft Entra ID App Registrations, application permissions (`Mail.Send`), and token caching.
- **[[GRAPH_VS_ACS_AND_GOOGLE_DORKING_LEADS]]**: Deep comparison between Microsoft Graph API, Azure Communication Services (ACS), and Oracle OCI.

---

## 📑 Templates & Dynamic Routing
- **[[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]]**: Specifications for the 4 core academic journals (**IJSR**, **IJAR**, **GJRA**, **Paripex**), merge tags (`[FNAME]`), and automatic domain link routing.

---

## ⚙️ Operations, Warmup & Scaling
- **[[DEPLOYMENT_GUIDE]]**: Sub-35-second CI/CD deployment guide with GitHub Actions and Azure App Service Linux.
- **[[M365_SHARED_MAILBOX_SETUP_GUIDE]]**: Creating and routing mailboxes via Microsoft 365 Shared Mailboxes without extra licensing costs.
- **[[MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]]**: Deliverability, SPF/DKIM/DMARC setup, and account warm-up curves.
- **[[SCALE_TO_40_ACCOUNTS_AND_PROJECT_STATUS]]**: Scaling roadmap across 40 sender mailboxes and current tenant status.
- **[[COST_BREAKDOWN_AND_BUDGET]]**: Complete cost estimation and licensing optimization.
