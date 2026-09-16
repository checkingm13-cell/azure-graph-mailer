---
title: "Standard Journal Templates & Dynamic Link Routing"
date: 2026-09-16
tags:
  - templates
  - dynamic-routing
  - call-for-papers
  - ijsr
  - ijar
  - gjra
  - paripex
  - obsidian-vault
aliases:
  - Journal Templates
  - Dynamic Links
---

# 📑 Standard Journal Templates & Dynamic Link Routing

> [!NOTE]
> Operational documentation for the 4 core academic journals supported by `azure-graph-mailer`: **IJSR**, **IJAR**, **GJRA**, and **Paripex**.

---

## 1. Supported Academic Journals

1. **International Journal of Scientific Research (IJSR)**
   - *ISSN:* `2277-8179`
   - *Indexing:* UGC & NMC Accepted, PubMed Indexed
   - *Upload Endpoint:* `/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article`
   - *Opt-out Endpoint:* `/international-journal-of-scientific-research-(IJSR)/page/p/OptOut`

2. **Indian Journal of Applied Research (IJAR)**
   - *ISSN:* `2249-555X`
   - *Indexing:* UGC & NMC Accepted, PubMed Indexed
   - *Upload Endpoint:* `/indian-journal-of-applied-research-(IJAR)/page/u/upload-your-article`
   - *Opt-out Endpoint:* `/indian-journal-of-applied-research-(IJAR)/page/u/OptOut`

3. **Global Journal For Research Analysis (GJRA)**
   - *ISSN:* `2277-8160`
   - *Indexing:* UGC & NMC Accepted, PubMed Indexed
   - *Upload Endpoint:* `/global-journal-for-research-analysis-GJRA/page/p/upload-your-article`
   - *Opt-out Endpoint:* `/global-journal-for-research-analysis-GJRA/page/p/OptOut`

4. **Paripex Indian Journal of Research (Paripex)**
   - *ISSN:* `2250-1991`
   - *Indexing:* UGC & NMC Accepted, PubMed Indexed
   - *Upload Endpoint:* `/paripex/page/p/upload-your-article`
   - *Opt-out Endpoint:* `/paripex/page/p/OptOut`

---

## 2. Dynamic Tag Resolution Mechanics

The template renderer in `src/services/templateEngine.js` resolves tags at runtime per recipient and per sending mailbox:

| Tag | Example Input | Rendered Output | Notes |
|---|---|---|---|
| `[FNAME]` or `{{FNAME}}` | `Dr. Rajesh Patel` | `Dr.` or `Rajesh` | Extracts recipient's first name. |
| `[NAME]` or `{{Name}}` | `Dr. Rajesh Patel` | `Dr. Rajesh Patel` | Full recipient name. |
| `{{Paper Title}}` | `Recent Trends in AI` | `Recent Trends in AI` | Derived from CSV upload. |
| `{{senderDomain}}` | Sender: `editor@theparipexjournal.com` | `theparipexjournal.com` | Resolves to active sender mailbox domain. |

---

## 3. Dynamic Relative Link Prepending

To maximize inbox placement and maintain domain reputation across multi-account pools, links are saved as relative paths in HTML:

```html
<a href="/paripex/page/p/upload-your-article">Submit Your Manuscript</a>
```

When an email is dispatched:
- If sent from `rishank@mail.theparipexjournal.com`:
  $\to$ Link becomes `https://mail.theparipexjournal.com/paripex/page/p/upload-your-article`
- If sent from `newsletter@education.yourpaperedition.com`:
  $\to$ Link becomes `https://education.yourpaperedition.com/paripex/page/p/upload-your-article`

No manual link editing is needed when switching sender domains.

---

## 🔗 Related Notes (Obsidian Links)
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[SPEC_PRODUCTION_CAMPAIGN_SCHEDULER]]
* [[README]]
