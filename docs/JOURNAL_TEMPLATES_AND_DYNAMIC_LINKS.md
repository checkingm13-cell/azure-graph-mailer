---
title: "Standard Journal Templates, Visual Cards & Dynamic Link Routing"
date: 2026-09-22
tags:
  - templates
  - dynamic-routing
  - call-for-papers
  - visual-cards
  - ijsr
  - ijar
  - gjra
  - paripex
  - obsidian-vault
aliases:
  - Journal Templates
  - Dynamic Links
  - Visual Cards
---

# 📑 Standard Journal Templates, Visual Cards & Dynamic Link Routing

> [!NOTE]
> Operational documentation for the 4 core academic journals supported by `azure-graph-mailer`: **IJSR**, **IJAR**, **GJRA**, and **Paripex**. Covers both **Standard Text CFP** and **Visual Graphic Card** templates.

---

## 1. Supported Academic Journals & Official CDN Assets

| Journal | ISSN | Primary CTA Endpoint | Official CDN Visual Poster URL |
| :--- | :--- | :--- | :--- |
| **IJAR** | `2249-555X` | `/indian-journal-of-applied-research-(IJAR)/page/u/upload-your-article` | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/IJAR-email.jpg` |
| **IJSR** | `2277-8179` | `/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article` | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/IJSR-email.jpg` |
| **GJRA** | `2277-8160` | `/global-journal-for-research-analysis-GJRA/page/p/upload-your-article` | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/GJRA-email.jpg` |
| **PARIPEX** | `2250-1991` | `/paripex/page/p/upload-your-article` | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/PARIPEX-email.jpg` |

---

## 2. Template Categorization Engine

Templates are automatically categorized using standard `<img` detection:

1. **🖼️ Visual Graphic Cards:** Templates containing an `<img ...>` tag. Automatically locked to the **Oracle OCI Regional SMTP Pool** for zero-leak delivery.
2. **📄 Standard Text CFP:** Templates without image tags. Open to **all providers** (Microsoft Graph API, Azure ACS, and Oracle OCI).

---

## 3. Dynamic Tag Resolution Mechanics

The template renderer in `src/services/templateEngine.js` resolves tags across two distinct phases:

| Tag | Example Input | Rendered Output | Resolution Phase |
| :--- | :--- | :--- | :--- |
| `[FNAME]` or `{{FNAME}}` | `Dr. Rajesh Patel` | `Dr.` or `Rajesh` | Phase 1 (Queue Creation) |
| `[NAME]` or `{{Name}}` | `Dr. Rajesh Patel` | `Dr. Rajesh Patel` | Phase 1 (Queue Creation) |
| `{{Paper Title}}` | `Recent Trends in AI` | `Recent Trends in AI` | Phase 1 (Queue Creation) |
| `{{senderDomain}}` | Sender: `newsletter@education.yourpaperedition.com` | `yourpaperedition.com` | Phase 2 (Worker Dispatch) |

---

## 4. Apex Domain Stripping & Dynamic Link Routing

To ensure high inbox deliverability and match active LiteSpeed web server SSL certificates on port 443:

1. **Subdomains are Automatically Stripped:**
   - Email: `academic@education.yourseducationmatter.com` $\to$ Apex: `yourseducationmatter.com`
   - Email: `sayogita@send.letpublishandpropel.com` $\to$ Apex: `letpublishandpropel.com`
   - Email: `dr.reetashah@theparipexjournal.com` $\to$ Apex: `theparipexjournal.com`

2. **Relative Path Rewriting:**
   Any relative link in HTML:
   ```html
   <a href="/paripex/page/p/upload-your-article">Submit Paper</a>
   ```
   Is dynamically rewritten upon socket transmission to:
   ```html
   <a href="https://yourpaperedition.com/paripex/page/p/upload-your-article">Submit Paper</a>
   ```

3. **Protection Against `https:///`:**
   At queue creation time, `{{senderDomain}}` is left unrendered. When the dispatch worker assigns an account, it binds the apex domain, eliminating empty hostnames.

---

## 🔗 Related Notes (Obsidian Links)
* [[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]]
* [[INCIDENT_REPORT_INVALID_SENDER_DOMAIN_TRIPLE_SLASH_AND_VISUAL_OCI_LOCK]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]
* [[README]]
