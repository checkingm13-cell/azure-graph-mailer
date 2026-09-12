---
title: "Azure Graph Mailer - Obsidian Documentation Vault"
tags:
  - obsidian
  - index
  - architecture
  - documentation
date: 2026-09-12
---

# 📚 Azure Graph Mailer — Knowledge Base & Vault Index

Welcome to the **Azure Graph Mailer** Obsidian Vault. This vault documents the full architecture, troubleshooting SOPs, anti-spam warmup rules, and system configurations.

---

## 🚨 Critical Troubleshooting & NDR Fixes
- **[[MICROSOFT_550_5_7_708_ERROR_DIAGNOSIS_AND_FIX]]**
  *Complete analysis and step-by-step SOP for fixing NDR error `550 5.7.708 (Access denied, traffic not accepted from this IP)`.*
  *Covers why manual sending works while automated Graph API sending is blocked, and how to unblock it in 2 minutes.*

---

## 🏗️ Architecture & Specifications
- **[[ARCHITECTURE_AND_SYSTEM_DESIGN]]**: System overview, dispatch pipelines, and architecture diagrams.
- **[[MICROSOFT_GRAPH_API_SPEC_AND_PERMISSIONS]]**: Graph API endpoints, application permissions (`Mail.Send`), and authentication flow.
- **[[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]**: Production batch dispatch engine, rate limits, and scheduling rules.
- **[[GRAPH_VS_ACS_AND_GOOGLE_DORKING_LEADS]]**: Comparison between Microsoft Graph API and Azure Communication Services (ACS).

---

## ⚙️ Operations, Warmup & Scaling
- **[[M365_SHARED_MAILBOX_SETUP_GUIDE]]**: Creating and routing mailboxes via Microsoft 365 Shared Mailboxes without extra licensing costs.
- **[[MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]]**: Deliverability, SPF/DKIM/DMARC setup, and account warm-up curves.
- **[[SCALE_TO_40_ACCOUNTS_AND_PROJECT_STATUS]]**: Scaling roadmap across 40 sender mailboxes and current tenant status.
- **[[DEPLOYMENT_GUIDE]]**: Local and cloud deployment SOPs (Azure App Service).
- **[[COST_BREAKDOWN_AND_BUDGET]]**: Full cost estimation and licensing optimization.
