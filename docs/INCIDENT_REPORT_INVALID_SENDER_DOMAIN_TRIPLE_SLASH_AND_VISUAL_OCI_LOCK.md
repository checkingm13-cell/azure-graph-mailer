---
title: "Incident Report: Invalid URL (https:///) Breakdown, SenderDomain Premature Rendering & Strict OCI Lock"
date: 2026-09-22
tags:
  - incident-report
  - post-mortem
  - senderdomain
  - template-engine
  - oci-lock
  - chrome-url-parsing
  - obsidian-vault
aliases:
  - Incident Report 2026-09-22
  - Triple Slash URL Bug
  - SenderDomain Fix
---

# 🚨 Incident Report: Invalid URL (`https:///`) Breakdown & Dynamic SenderDomain Architecture

| Metric | Value |
| :--- | :--- |
| **Incident Date** | September 22, 2026 ~17:35 – 18:05 IST |
| **Impacted Subsystems** | Template Engine (`src/services/templateEngine.js`), Static Previews (`public/email-preview*.html`), Campaign Queue Insertion (`src/routes/api.js`) |
| **User-Facing Symptom** | Chrome Error: `The page you were on is trying to send you to an invalid URL (https:///global-journal-for-research-analysis-GJRA/page/p/upload-your-article)` |
| **Severity** | High (Broken links for recipients and preview testers) |
| **Resolution Status** | Fully Diagnosed & Remediated |

---

## 1. Executive Summary

During testing of newly deployed Visual Graphic Card campaigns, users and previewers clicking CTA buttons or hero poster links encountered a browser block:
```
The page you were on is trying to send you to an invalid URL (https:///global-journal-for-research-analysis-GJRA/page/p/upload-your-article)
```

Notice the **triple forward slash** (`https:///`). The destination hostname was completely missing.

This post-mortem documents:
1. Why direct browser views of static HTML preview files broke.
2. Why queue insertion wiped out `{{senderDomain}}` before the sending account was assigned.
3. How the two-phase template resolution architecture permanently eliminates this vulnerability.

---

## 2. Root Cause Analysis (RCA)

Investigation revealed that the breakdown occurred due to a dual-vector lifecycle bug:

### Vector 1: Static Preview HTML in Client Browsers
* The preview files (`email-preview-gjra.html`, etc.) were hosted statically in `public/`.
* Inside the raw HTML, anchor tags were written with the unrendered template variable:
  ```html
  <a href="https://{{senderDomain}}/global-journal-for-research-analysis-GJRA/page/p/upload-your-article">
  ```
* When an operator opened `https://mailapp.balajiimpex.store/email-preview-gjra.html` in Google Chrome or Microsoft Edge and clicked the link, the browser attempted to parse `{{senderDomain}}` as an RFC-compliant hostname.
* Because curly brackets `{}` are illegal characters in standard domain names, Chromium stripped the host to an empty string, transforming the URL to `https:///global-journal-...`. The browser immediately aborted the request with the "invalid URL" safety warning.

### Vector 2: Premature Tag Annihilation in `api.js` Queue Insertion
* At campaign launch time (`POST /api/campaigns/launch-batches`), contacts are split into batches and written to the SQLite `queue` table.
* The route called `renderTemplate(assignedTemplate.body_html, { ...contact, _index: cIdx })`.
* At this stage, **no sender account had been selected yet** (because pool accounts are chosen dynamically at send-time by `queueWorker.js` based on real-time health and quota).
* In `templateEngine.js`:
  ```javascript
  const senderEmail = data.sender_email || '';
  const senderDomain = extractApexDomain(senderEmail); // Evaluated to "" (empty string)
  
  const map = {
    ...
    senderDomain: senderDomain, // Stored as ""
  };
  
  // Tag replacement executed:
  result = result.replace(/\{\{\s*senderDomain\s*\}\}/gi, ""); 
  ```
* The engine replaced `{{senderDomain}}` with an empty string!
* As a result, `queue.rendered_html` stored `https:///global-journal-...` directly into SQLite.
* When `queueWorker.js` later picked up the item and assigned `sayogita@send.letpublishandpropel.com`, the tag `{{senderDomain}}` had **already been annihilated**. There was nothing left to replace, and the recipient received an email with a broken `https:///` link.

---

## 3. Engineering Fix: Two-Phase Resolution Architecture

To guarantee that links always resolve to the active rotating sender's apex domain without breaking, the template engine was refactored into a **Two-Phase Architecture**:

```
PHASE 1: Queue Insertion (api.js)
Input:  <a href="https://{{senderDomain}}/upload">
Action: Render recipient variables ({{Name}}, {{Paper Title}}).
Rule:   DO NOT touch {{senderDomain}} or {{sender_email}}.
Result in SQLite queue: <a href="https://{{senderDomain}}/upload"> (PRESERVED)

                     │
                     ▼
PHASE 2: Worker Dispatch (queueWorker.js)
Input:  Queue item + Selected Account (e.g. newsletter@education.yourpaperedition.com)
Action: extractApexDomain('newsletter@education.yourpaperedition.com') -> 'yourpaperedition.com'
Rule:   Replace {{senderDomain}} with 'yourpaperedition.com'.
Rule:   Self-healing: If input already contains "https:///", rewrite to "https://yourpaperedition.com/".
Result sent to recipient: <a href="https://yourpaperedition.com/upload"> (100% VALID)
```

### Key Code Implementation (`src/services/templateEngine.js`)
```javascript
// Only inject sender domain tags into the replacement map if senderDomain is ACTUALLY known!
if (senderDomain) {
  map['sender_domain'] = senderDomain;
  map['senderDomain'] = senderDomain;
  map['sender_email'] = senderEmail;
}

// If sender domain is known (Phase 2):
if (senderDomain) {
  // 1. Rewrite relative links to sender domain
  result = result.replace(/<a\b([^>]*?)\bhref=["'](\/(?!\/)[^"']*)["']([^>]*)>/gi, (m, pfx, path, sfx) => {
    return `<a${pfx}href="https://${senderDomain}${path}"${sfx}>`;
  });
  // 2. Self-heal any corrupted triple slashes
  result = result.replace(/https?:\/\/\//gi, `https://${senderDomain}/`);
  // 3. Clean up unreplaced tags
  result = result.replace(/https?:\/\/(?:\{\{\s*senderDomain\s*\}\}|\{\s*senderDomain\s*\})/gi, `https://${senderDomain}`);
} else {
  // Phase 1 (Queue insertion): Preserve tags and heal any accidental triple slashes back to {{senderDomain}}
  result = result.replace(/https?:\/\/\//gi, 'https://{{senderDomain}}/');
}
```

---

## 4. Live Server DNS & SSL Audit

We verified that the rotating apex domains actually host active web servers on port 443 capable of receiving manuscript submissions:

| Domain | DNS A-Record | Web Server Response (Port 80) | SSL Response (Port 443) |
| :--- | :--- | :--- | :--- |
| `yourpaperedition.com` | `103.224.246.201` | `HTTP/1.1 200 OK` (LiteSpeed) | `HTTP/1.1 200 OK` (SSL Valid) |
| `theparipexjournal.com` | `103.224.246.201` | `HTTP/1.1 200 OK` (LiteSpeed) | `HTTP/1.1 200 OK` (SSL Valid) |
| `letpublishandpropel.com` | `103.224.246.201` | `HTTP/1.1 200 OK` (LiteSpeed) | `HTTP/1.1 200 OK` (SSL Valid) |
| `onlypaperpublication.com`| `103.224.246.201` | `HTTP/1.1 200 OK` (LiteSpeed) | `HTTP/1.1 200 OK` (SSL Valid) |

* **Subdomain Finding:** Subdomains (e.g. `education.yourpaperedition.com`) do not listen on port 443.
* **Apex Requirement:** Links **must** use the apex domain (`yourpaperedition.com`), which `extractApexDomain()` enforces by stripping subdomains.

---

## 5. Standard Operating Procedure (SOP) & Safeguards

1. **Static HTML Previews:** In all standalone preview HTML files (`public/email-preview*.html`), include a client-side script so clicking links inside Chrome preview tabs dynamically defaults to a live domain without breaking.
2. **Never Render Sender Tags at Queueing Time:** Never pass `sender_email` or `senderDomain` to `renderTemplate` inside `router.post('/campaigns/launch-batches')`.
3. **Queue Worker Self-Healing:** The queue worker must always execute `renderTemplate` on `item.rendered_html` right before socket transmission to bind the selected account's domain.

---

## 🔗 Related Notes (Obsidian Graph)
* [[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]]
* [[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[README]]
