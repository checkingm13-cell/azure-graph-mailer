---
title: "Visual Graphic Card Architecture & Oracle OCI Engine Specification"
date: 2026-09-22
tags:
  - visual-campaigns
  - oci-smtp
  - cdn-pre-caching
  - deliverability
  - google-image-proxy
  - templates
  - obsidian-vault
aliases:
  - Visual Campaigns
  - OCI Engine Lock
  - CDN Pre-Caching
---

# 🖼️ Visual Graphic Card Architecture & Oracle OCI Engine Specification

> [!IMPORTANT]
> Official engineering specification for Visual Graphic Card campaigns, Worldwide Journals CDN hosting, automated `<img` categorization, and strict Oracle Cloud Infrastructure (OCI) sender engine locking.

---

## 1. Executive Summary & Design Philosophy

Visual Graphic Card templates are high-converting, single-poster email campaigns designed to replace traditional plain-text academic calls for papers (CFP). Rather than multiple paragraphs of text, each visual card contains:
1. **Hero Poster Graphic:** 640px responsive Swiss/editorial poster hosted on the official Worldwide Journals CDN.
2. **Primary CTA Button:** High-contrast, rounded action button linking directly to the journal's manuscript submission portal.
3. **One-Click Opt-Out Footer:** Clean, compliant unsubscribe link ensuring 100% CAN-SPAM and GDPR compliance.

```
+-------------------------------------------------------------------+
|  [ HERO POSTER GRAPHIC: 640x640px CDN JPG ]                       |
|  Hosted on: https://www.worldwidejournals.com/.../M-Images/...    |
+-------------------------------------------------------------------+
|                                                                   |
|         [ SUBMIT MANUSCRIPT ONLINE -> (Call To Action) ]          |
|                                                                   |
+-------------------------------------------------------------------+
|  To permanently cease future calls for papers, click Opt Out.     |
+-------------------------------------------------------------------+
```

---

## 2. Google Image Proxy Pre-Caching (The MakeMyTrip Architecture)

### The Deliverability Problem with CID Attachments
Historically, embedding images in bulk emails via MIME Multipart Content-ID (`cid:image_name`) had severe drawbacks:
* Email size increased from **3 KB to 120+ KB** per recipient, multiplying server bandwidth by 40x.
* Microsoft Graph API and Azure ACS mailboxes throttled or failed when pushing large MIME payloads.
* Spam filters (Gmail, Outlook, Yahoo) assign higher spam scores to emails containing heavy raw image attachments compared to text.

### The Solution: Public HTTPS CDN with Automatic Edge Pre-Caching
When an author receives an email in Gmail or Google Workspace containing an HTTPS image URL:
1. **Google Image Proxy** automatically fetches the image from our CDN edge and stores it on Google's global cache servers (`googleusercontent.com`).
2. This fetch happens **in the background before the author opens the email**.
3. When the recipient opens the message, the image renders with **0.00s latency** without prompting "Click here to download pictures".
4. The recipient's IP is never exposed to external servers, satisfying privacy standards.

### Official CDN Asset Directory
All visual assets are permanently hosted on the official Worldwide Journals Sucuri CDN:

| Journal | Asset Name | CDN URL | Size |
| :--- | :--- | :--- | :--- |
| **IJAR** | 4-Step Author Guide | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/IJAR-email.jpg` | 77 KB |
| **IJSR** | Swiss Typographic Poster | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/IJSR-email.jpg` | 104 KB |
| **PARIPEX** | Swiss Typographic Poster | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/PARIPEX-email.jpg` | 96 KB |
| **GJRA** | Swiss Typographic Poster | `https://www.worldwidejournals.com/global-journal-for-research-analysis-GJRA/M-Images/GJRA-email.jpg` | 101 KB |

> [!CAUTION]
> **Internal Domain Security:** Under no circumstances should internal application domains (e.g. `mailapp.balajiimpex.store`) appear in email bodies or image links. All public-facing creative assets must strictly point to `https://www.worldwidejournals.com/...`.

---

## 3. Automatic `<img` Categorization & Strict OCI Lock

To prevent human configuration errors and eliminate ambiguous dropdown menus, templates are automatically categorized into two clear segments:

```
                          Template Body HTML
                                  │
                     Contains an <img ...> tag?
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                   ▼
             [ YES ]                             [ NO ]
     🖼️ Visual Graphic Card              📄 Standard Text CFP
  (IJAR, IJSR, PARIPEX, GJRA)        (Standard CFP, Fast-Track...)
                │                                   │
                ▼                                   ▼
    Strict Oracle OCI Lock                All Providers Allowed
  (Graph API & ACS Excluded)           (Graph API, Azure ACS, OCI)
```

### Why Visual Cards Must Send Exclusively via Oracle OCI
1. **Domain Consistency:** Microsoft Graph API mailboxes are tied to specific journal identities (e.g. `dr.reetashah@theparipexjournal.com`), whereas Visual Cards are rotated across multiple distinct publication brands.
2. **Dedicated Rotating Infrastructure:** Oracle OCI regional SMTP accounts operate across designated sender publication domains (`yourpaperedition.com`, `letpublishandpropel.com`, `onlypaperpublication.com`, `researchandrise.com`) that have matching SPF, DKIM, and LiteSpeed upload portal listeners.
3. **Queue Worker Enforcement:** In `src/services/queueWorker.js`, if an item is categorized as visual:
   ```javascript
   const isVisualItem = item.campaign_category === 'VISUAL' || 
                        item.template_category === 'VISUAL' || 
                        (item.rendered_html && /<img\b/i.test(item.rendered_html));

   const eligiblePool = isVisualItem 
     ? availableAccounts.filter(a => a.provider === 'OCI')
     : availableAccounts;
   ```
   If all OCI accounts are busy or on cooldown, the item is postponed 60s rather than leaking to Graph API or ACS.

---

## 4. Launch Campaign UI Specification (Step 2)

In the Launch Campaign modal, Step 2 provides a 2-segment radio card interface:

```html
<!-- Segment 1: Visual Graphic Cards (Default) -->
[●] 🖼️ Visual Graphic Cards (Oracle OCI Auto-Rotated)
    High-converting journal posters with CTA buttons.
    Dispatches strictly via Oracle OCI regional SMTP.

<!-- Segment 2: Standard Text CFP -->
[○] 📄 Standard Text CFP (All Providers)
    Classic academic text call for papers.
    Compatible with Microsoft Graph API, Azure ACS, and OCI.
```

### Dynamic Behavior
* Selecting **Visual Graphic Cards**:
  - Populates `#batchTemplateSelect` and `#templateCheckboxesList` with image-bearing templates.
  - Displays the active status badge: `🏛️ Oracle OCI Engine Locked`.
  - Restricts Controlled Send account selection to `provider === 'OCI'`.
* Selecting **Standard Text CFP**:
  - Populates templates with text-only CFP letters.
  - Displays status badge: `🌐 All Providers Active`.
  - Enables all accounts across all providers.

---

## 5. Dynamic `{{senderDomain}}` Link Architecture

Visual templates use `{{senderDomain}}` in all interactive elements:
```html
<a href="https://{{senderDomain}}/global-journal-for-research-analysis-GJRA/page/p/upload-your-article">
  Submit Manuscript Online &rarr;
</a>
```

* **At Queue Creation:** `{{senderDomain}}` is preserved intact so the database queue retains the unrendered variable.
* **At Send Time:** When `queueWorker.js` selects an OCI account (e.g. `newsletter@education.yourpaperedition.com`), `extractApexDomain()` strips the `education.` subdomain and outputs `yourpaperedition.com`.
* **In Recipient's Inbox:** The link resolves to `https://yourpaperedition.com/global-journal-for-research-analysis-GJRA/page/p/upload-your-article`.
* **On Port 443:** The LiteSpeed application server at `103.224.246.201` serves the active upload form over SSL with zero domain mismatch.

---

## 🔗 Related Notes (Obsidian Graph)
* [[INCIDENT_REPORT_INVALID_SENDER_DOMAIN_TRIPLE_SLASH_AND_VISUAL_OCI_LOCK]]
* [[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[README]]
