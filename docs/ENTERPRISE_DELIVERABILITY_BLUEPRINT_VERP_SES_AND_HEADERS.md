---
title: "Enterprise Email Deliverability Blueprint: Federal Bank (SES) & Crocs (VERP) Reverse Engineering"
tags:
  - deliverability
  - headers
  - dkim
  - dmarc
  - verp
  - oci
  - ses
  - html-email
date: 2026-09-23
---

# 🏆 Enterprise Email Deliverability Blueprint: Federal Bank (SES) & Crocs (VERP) Analysis

This document provides a complete reverse-engineering and technical analysis of two real-world enterprise emails that achieved 100% Gmail Primary Inbox placement on September 23, 2026:
1. **Federal Bank / Scapia** — Financial transactional & credit card statement notice via Amazon SES (`comm2.federalbank.co.in`).
2. **Crocs / Discountwalas** — High-volume promotional e-commerce campaign via self-hosted PowerMTA/Mailwizz (`host.discountwalas.com`).

It details the exact architectural, DNS, header, MIME, and design specifications required to replicate this enterprise inboxing standard across our **Oracle OCI SMTP** and multi-provider mailer engine.

---

## 📊 High-Level Comparison Matrix

| Architectural Feature | Federal Bank / Scapia (SES) | Crocs / Discountwalas (Self-Hosted) | Azure Graph Mailer (Our Engine) |
| :--- | :--- | :--- | :--- |
| **Sending Engine** | Amazon SES (`ap-south-1.amazonses.com`) | Dedicated IP (`54.39.123.69`) via PowerMTA | Multi-Region Oracle OCI SMTP (`ap-mumbai-1`, `us-ashburn-1`) |
| **Frontend Platform** | CleverTap Enterprise | Mailwizz / Custom CRM | Custom Node.js + SQLite Web App |
| **DMARC Policy** | `p=REJECT; sp=REJECT; dis=NONE` | `p=REJECT; sp=REJECT; dis=NONE` | `p=REJECT` (Recommended) / `p=quarantine` |
| **DKIM Signature** | Dual DKIM (`@federalbank.co.in` + `@amazonses.com`) | Single DKIM (`@host.discountwalas.com`) | Author Domain DKIM (CNAME to OCI region) |
| **Return-Path Strategy** | Dedicated Subdomain (`comm2.federalbank.co.in`) | **VERP** (`info-recipient=gmail.com@host...`) | Direct Sender (`returnPath` in Nodemailer) |
| **Unsubscribe Standard** | One-Click RFC 8058 (`List-Unsubscribe-Post`) | Dual: HTTPS Link + Mailto URL + One-Click | Dual: HTTPS Link + Mailto URL + One-Click |
| **Feedback Loop (FBL)** | Amazon SES `Feedback-ID` | ESP Campaign `Feedback-ID` + `X-Report-Abuse` | Custom `Feedback-ID` (`journal:domain:oci`) |
| **MIME Structure** | `multipart/alternative` (`text/html` + CSS) | `multipart/alternative` (`text/plain` + `text/html`) | `multipart/alternative` (`text/plain` + `text/html`) |
| **Preheader Strategy** | Hidden preheader span (`display:none`) | Visible teaser in plain text | Configurable template preheaders |

---

## 🏛️ 1. Technical & Infrastructure Blueprint

### A. The Holy Trinity of Authentication (SPF, DKIM, DMARC)
Both emails achieved clean green passes on Google MX inspection:
```text
ARC-Authentication-Results: i=1; mx.google.com;
       dkim=pass header.i=@federalbank.co.in header.s=acls03;
       spf=pass (google.com: domain of ... designates IP as permitted sender);
       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=...
```

#### Why `p=REJECT` is Critical:
* Both senders enforce `p=REJECT`. Many senders stay on `p=none` out of fear of breaking legacy mail.
* **The Gmail Advantage:** Gmail's SpamAssassin and AI antispam models give massive reputation bonuses to domains with `p=reject`. It proves to Gmail that the sender actively polices their domain against spoofing.

### B. Custom Return-Path & VERP (Variable Envelope Return Path)
The Crocs email uses **VERP**:
```text
Return-Path: <info-sharifmemon64=gmail.com@host.discountwalas.com>
```
* **How VERP Works:** The recipient's email address (`sharifmemon64@gmail.com`) is dynamically encoded into the envelope sender (`info-sharifmemon64=gmail.com@...`).
* **Why It Matters:** When a mailbox is invalid or full, the receiving MTA generates an NDR (Non-Delivery Report) and sends it back to the Return-Path. The bounce server instantly identifies the bounced user without parsing unstandardized bounce email text bodies.
* **Implementation in Nodemailer / OCI:**
  ```javascript
  const cleanRecipient = toEmail.replace('@', '=');
  const verpReturnPath = `bounce-${cleanRecipient}@bounce.${senderApexDomain}`;
  
  const mailOptions = {
    from: `"${displayName}" <${senderEmail}>`,
    to: toEmail,
    envelope: {
      from: verpReturnPath, // SMTP MAIL FROM (Envelope Return-Path)
      to: toEmail
    },
    ...
  };
  ```

### C. RFC 8058 One-Click List-Unsubscribe
As of February 2024, Google and Yahoo require **RFC 8058 One-Click Unsubscribe** for all bulk senders (>5,000/day):
```text
List-Unsubscribe: <https://offers.discountwalas.com/unsubscribe/...>, <mailto:unsubscribe@domain.com?subject=Unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```
* Gmail renders a native **"Unsubscribe"** button right next to the sender's name in the header bar.
* When clicked, Gmail sends an HTTP `POST` request with body `List-Unsubscribe=One-Click` to the URL.
* **Deliverability Impact:** Prevents users from hitting the red "Report Spam" button, which destroys sender IP reputation.

---

## 🎨 2. Design, UX & HTML Email Engineering

### A. Hidden Preheader Text (The Secret Open-Rate Weapon)
In the Federal Bank email:
```html
<span class="preheader" style="display:none !important; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide:all; visibility:hidden;">
  Only 2 days to your statement. Bundle your purchases into easy EMIs.
</span>
```
* **Why It Works:** Gmail displays the Subject Line followed by the first ~80 characters of text found in the body.
* If omitted, Gmail displays: *"Can't see images? View in browser..."* or raw CSS code.
* The hidden preheader guarantees that the author or recipient sees a compelling preview in their mobile inbox.

### B. Microsoft Outlook MSO Conditionals
Outlook desktop uses Microsoft Word's rendering engine instead of Chromium or WebKit.
The Federal Bank template uses:
```html
<!--[if mso]>
<style type="text/css">
  body, table, td, p, a, span { font-family: Arial, sans-serif !important; }
</style>
<![endif]-->
<!--[if gte mso 9]>
<xml>
  <o:OfficeDocumentSettings>
    <o:AllowPNG/>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings>
</xml>
<![endif]-->
```
* Prevents 120 DPI display scaling bugs on high-resolution Windows monitors.
* Forces crisp PNG rendering.

### C. Bulletproof Table Layout vs Image-Only Emails
* Both templates avoid sending a single giant image.
* **Federal Bank:** 100% HTML tables, custom Google Fonts (`Lexend Deca`), inline CSS, clear typography hierarchy.
* **Crocs:** 600px width container, top navigation bar, 2-column product grid with `width="50%"`, CSS-styled buttons with `display:inline-block` and `border-radius`.
* **Deliverability Rule:** Spam filters penalize 100% image emails with zero text. The ideal text-to-image ratio is **60% text / 40% imagery**, or visual cards wrapped with semantic HTML tables, headings, and CTA buttons.

---

## 🛠️ 3. Actionable Checklist for Azure Graph Mailer

To replicate this enterprise standard across our production campaigns on `mailapp.balajiimpex.store`:

1. **Keep `multipart/alternative` Enabled:**
   * Our `ociMailer.js` already runs `htmlToPlainText(htmlBody)`. Always ensure plain text contains the core links so non-HTML readers and spam filters award top scores.
2. **Maintain Strict DMARC on All Sending Domains:**
   * Verify all 4 journal apex domains (`researchandrise.com`, `yourpaperedition.com`, `onlypaperpublication.com`, `yourpaperpublication.com`) have TXT record:
     `v=DMARC1; p=reject; rua=mailto:dmarc-reports@...`
3. **Inject Hidden Preheaders in All Visual Card Templates:**
   * Add a `<span style="display:none; max-height:0px; overflow:hidden;">` block at line 1 of templates #6, #7, #8, #9 with call-for-papers deadlines (e.g. *"Submit your manuscript for the October 2026 issue with fast-track peer review."*).
4. **Enforce RFC 8058 One-Click Unsubscribe Headers:**
   * Verified in `ociMailer.js`:
     ```javascript
     'List-Unsubscribe': `<https://${senderDomain}/unsubscribe>, <mailto:unsubscribe@${senderDomain}?subject=Unsubscribe>`,
     'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
     ```
5. **Add Optional VERP Envelope Routing:**
   * If bounce handling becomes automated in future releases, route the envelope sender through a dedicated bounce subdomain (`bounce.domain.com`) with the recipient hash.

---

## 📌 References & Related Vault Notes
- [[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]] — Visual cards, OCI engine locks, and CDN image hosting.
- [[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]] — The 4 core journal templates and dynamic apex link routing.
- [[MULTI_ACCOUNT_WARMUP_AND_ANTI_SPAM]] — Warmup schedules and sender reputation preservation.
- [[ARCHITECTURE_AND_SYSTEM_DESIGN]] — Multi-provider dispatch engine architecture.
