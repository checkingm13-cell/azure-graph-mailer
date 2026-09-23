---
title: "Azure Graph Mailer - Obsidian Documentation Vault"
tags:
  - obsidian
  - index
  - architecture
  - documentation
date: 2026-09-17
---

# 📚 Azure Graph Mailer — Knowledge Base & Vault Index

Welcome to the **Azure Graph Mailer** Obsidian Vault. This vault documents the full multi-provider architecture, deployment CI/CD pipelines, templates, anti-spam warmup rules, Indian Standard Time (IST) queue scheduling, and operational troubleshooting SOPs.

---

## 🚨 Incident Reports & Production Audits
- **[[INCIDENT_REPORT_INVALID_SENDER_DOMAIN_TRIPLE_SLASH_AND_VISUAL_OCI_LOCK]]**
  *Complete post-mortem of the September 22, 2026 triple-slash (`https:///`) link breakdown: premature tag annihilation at queue time vs dispatch time, client-side Chromium URL parsing, two-phase template resolution, and live LiteSpeed port 443 SSL audit.*
- **[[INCIDENT_REPORT_QUEUE_FREEZE_IST_TIMEZONE_AND_SEND_NOW_AUDIT]]**
  *Detailed post-mortem and architectural fixes for the September 17, 2026 queue freeze: unbounded Azure ACS poller hang, UTC vs IST (+05:30) timezone skew, priority Send-Now worker wake engine, 100ms ultra-fast pacing, and automatic account fallback.*
- **[[INCIDENT_REPORT_49_50_STUCK_BATCHES_AND_DSA_AUDIT]]**
  *Complete analysis and resolution of the 49/50 batch completion deadlock, M365 OAuth clock-skew cooldown failover, and algorithmic $O(1)$ database indexing audit for 1 Crore scale.*
- **[[MICROSOFT_550_5_7_708_ERROR_DIAGNOSIS_AND_FIX]]**
  *Complete analysis and step-by-step SOP for fixing NDR error `550 5.7.708 (Access denied, traffic not accepted from this IP)`.*
- **[[DEPLOYMENT_GUIDE#4-troubleshooting-common-deployment-issues]]**
  *Fixes for Azure ACS `Invalid connection string` and Azure App Service sleep timeout.*

---

## 🏗️ Architecture & Specifications
- **[[ENTERPRISE_DELIVERABILITY_BLUEPRINT_VERP_SES_AND_HEADERS]]**: Reverse-engineered deliverability blueprint from Federal Bank (Amazon SES) and Crocs (Self-Hosted PowerMTA/VERP): strict DMARC `p=reject`, dual DKIM, RFC 8058 One-Click Unsubscribe, VERP bounce routing, hidden preheaders, and MSO table engineering.
- **[[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]]**: Production specification for Visual Graphic Card campaigns, Worldwide Journals CDN hosting, automated `<img` tag categorization, Google Image Proxy edge pre-caching, strict Oracle OCI SMTP engine lock, and Step 2 radio card UI.
- **[[ALGORITHM_TIMING_SCHEDULING_AND_WORKERS_DSA]]**: Deep technical reference covering fair round-robin interleaving via SQL window functions, 100ms/2500ms pacing and interruptible sleep worker loops, IST timezone arithmetic, two-tier batching (`is_batch`), and test-recipient injection at batch heads.
- **[[ARCHITECTURE_AND_SYSTEM_DESIGN]]**: High-performance multi-provider engine (Graph API, Azure ACS, Oracle OCI SMTP), fair rotation, dynamic link rewriting, strict Indian Standard Time (IST) normalization (`+330 minutes`), and automatic account fallback upon saturation or cooldown.
- **[[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]**: Production batch dispatch engine, rate limits, staggered queue scheduling, priority rank ordering (Send Now Tier 0), and series prefix isolation.
- **[[MICROSOFT_GRAPH_API_SPEC_AND_PERMISSIONS]]**: Microsoft Entra ID App Registrations, application permissions (`Mail.Send`), and token caching.
- **[[GRAPH_VS_ACS_AND_GOOGLE_DORKING_LEADS]]**: Deep comparison between Microsoft Graph API, Azure Communication Services (ACS), and Oracle OCI.

---

## 📑 Templates & Dynamic Routing
- **[[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]]**: Specifications for the 4 core academic journals (**IJSR**, **IJAR**, **GJRA**, **Paripex**), official CDN assets, automated `<img` categorization, and apex domain link routing.
- **[[ACADEMIC_OSINT_ART_TAXONOMY_AND_CREATIVE_PROMPTS]]**: Creative design blueprint and generative prompts for academic poster art taxonomy.

---

## ⚙️ Operations, Warmup & Scaling
- **[[OCI_OBJECT_STORAGE_AND_CDN_IMAGE_HOSTING_SOP]]**: Standard Operating Procedure for provisioning public OCI Object Storage buckets, Pre-Authenticated Requests (PAR), setting image MIME types, and automated 1-click dashboard upload roadmap.
- **[[DEPLOYMENT_GUIDE]]**: Sub-35-second CI/CD deployment guide with GitHub Actions and Azure App Service Linux.
- **[[M365_SHARED_MAILBOX_SETUP_GUIDE]]**: Creating and routing mailboxes via Microsoft 365 Shared Mailboxes without extra licensing costs.
- **[[MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]]**: Deliverability, SPF/DKIM/DMARC setup, and account warm-up curves.
- **[[SCALE_TO_40_ACCOUNTS_AND_PROJECT_STATUS]]**: Scaling roadmap across 40 sender mailboxes and current tenant status.
- **[[COST_BREAKDOWN_AND_BUDGET]]**: Complete cost estimation and licensing optimization.
