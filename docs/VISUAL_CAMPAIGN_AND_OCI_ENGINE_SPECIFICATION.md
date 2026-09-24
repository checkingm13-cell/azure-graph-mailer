---
title: "Visual Graphic Card Architecture & Oracle OCI Engine Specification"
date: 2026-09-23
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
> Official engineering specification for Visual Graphic Card campaigns, Method A reverse-proxy poster rewrites, 60/40 text-to-image ratios, automated `<img` categorization, and strict Oracle Cloud Infrastructure (OCI) sender engine locking.

---

## 1. Executive Summary & Design Philosophy

Visual Graphic Card templates are high-converting, single-poster email campaigns designed to replace traditional plain-text academic calls for papers (CFP). Rather than multiple dense paragraphs of unstyled text, each visual card contains:

1. **Hero Poster Graphic:** 600px responsive academic poster hosted via Method A (`https://{{senderDomain}}/posters/...`) redirecting to OCI Object Storage CDN.
2. **Primary CTA Button:** High-contrast, rounded action button linking directly to the journal's manuscript submission portal.
3. **Academic Feature Highlights:** 4-column semantic HTML feature grid (Rapid Review, Indexed, Global Reach, Certificate) providing a balanced 60/40 text-to-image ratio.
4. **CAN-SPAM Compliant Footer:** Full physical headquarters address (`Worldwide Journals · 801, 8th Floor, Corporate Park, Ahmedabad, Gujarat 380015, India`) and RFC 8058 One-Click Opt-Out link.

```
+-------------------------------------------------------------------+
|  [ HERO POSTER GRAPHIC: 600x600px ]                               |
|  Source: https://{{senderDomain}}/posters/GJRA-email.jpg          |
+-------------------------------------------------------------------+
|                                                                   |
|         [ SUBMIT MANUSCRIPT ONLINE -> (Call To Action) ]          |
|                                                                   |
+-------------------------------------------------------------------+
|   [⚡ Rapid Review]  [📚 Indexed]  [🌐 Global Reach]  [🎓 Cert]    |
+-------------------------------------------------------------------+
|  Worldwide Journals · Corporate Park, Ahmedabad, India · Opt Out  |
+-------------------------------------------------------------------+
```

---

## 2. Image Asset Delivery: Direct OCI Object Storage CDN (Standard)

### Why Direct OCI CDN Supersedes Method A for `<img src>`
Previously, Method A routed `<img src>` through a LiteSpeed `.htaccess` 301 redirect (`https://{{senderDomain}}/posters/...` $\to$ OCI Object Storage). However, empirical analysis of Gmail delivery revealed:

1. **Google Image Proxy (`googleusercontent.com`) Timeout Risk:** Google’s edge proxy crawlers require immediate 200 OK responses with low latency. Double-hop requests (SSL handshake with sender domain $\to$ 301 Moved Permanently $\to$ second SSL handshake with Oracle Cloud) frequently hit timeout thresholds or SSL verification hiccups.
2. **Permanent Error Caching:** Once Google Image Proxy encounters a timeout or 502/504 on the 301 hop, it caches the failure permanently for that specific URL string, rendering a broken image box indefinitely for that recipient.
3. **Link vs Image Distinction:**
   - **Clickable Links (`<a href>`):** Retain `https://{{senderDomain}}/...` because human clicks in standard web browsers follow 301 redirects flawlessly and maintain first-party domain reputation.
   - **Embedded Posters (`<img src>`):** Must use direct **Oracle Cloud Mumbai Object Storage CDN** URLs with zero redirect hops.

### Production Image Standard:
All visual card templates point directly to the OCI Mumbai Object Storage CDN:
```html
<img src="https://objectstorage.ap-mumbai-1.oraclecloud.com/n/bmgxwcqtiqic/b/wwjemailassets/o/posters/GJRA-email_7ec5b37cb5f5.jpg" width="640" height="640" border="0" alt="Call for Papers" style="display:block; width:100%; max-width:640px; height:auto; border-radius:14px;">
```

### Direct Google Edge Peering Benefits:
1. **0-Hop Fetch:** Google Image Proxy fetches directly from Oracle Cloud Mumbai (`ap-mumbai-1`) without hitting the sender domain web server.
2. **0.00s User Latency:** Google pre-caches the asset on `googleusercontent.com` with 100% reliability, eliminating broken image boxes in Gmail and Google Workspace.
3. **No Apache/LiteSpeed Load:** Offloads image bandwidth entirely from the sending domains' cPanel/LiteSpeed server (`103.224.246.201`).

---

## 3. Academic Feature Grid (60/40 Text-to-Image Balance)

Spam filters heavily penalize emails composed exclusively of images. Beneath every visual poster, we embed a 4-column semantic HTML feature grid:

```html
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px; border-top:1px solid #e2e8f0; padding-top:16px;">
  <tr>
    <td align="center" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <!-- Column 1 -->
          <td align="center" style="padding:0 12px;">
            <div style="font-size:16px; line-height:20px;">⚡</div>
            <div style="font-size:11px; font-weight:700; color:#1e293b; text-transform:uppercase; margin-top:4px;">Rapid Review</div>
            <div style="font-size:10px; color:#64748b;">Initial decision in 48-72h</div>
          </td>
          <!-- Column 2 -->
          <td align="center" style="padding:0 12px; border-left:1px solid #cbd5e1;">
            <div style="font-size:16px; line-height:20px;">📚</div>
            <div style="font-size:11px; font-weight:700; color:#1e293b; text-transform:uppercase; margin-top:4px;">Indexed</div>
            <div style="font-size:10px; color:#64748b;">Global academic databases</div>
          </td>
          <!-- Column 3 -->
          <td align="center" style="padding:0 12px; border-left:1px solid #cbd5e1;">
            <div style="font-size:16px; line-height:20px;">🌐</div>
            <div style="font-size:11px; font-weight:700; color:#1e293b; text-transform:uppercase; margin-top:4px;">Global Reach</div>
            <div style="font-size:10px; color:#64748b;">Crossref DOI & Open Access</div>
          </td>
          <!-- Column 4 -->
          <td align="center" style="padding:0 12px; border-left:1px solid #cbd5e1;">
            <div style="font-size:16px; line-height:20px;">🎓</div>
            <div style="font-size:11px; font-weight:700; color:#1e293b; text-transform:uppercase; margin-top:4px;">Certificate</div>
            <div style="font-size:10px; color:#64748b;">Digital e-Certificate for authors</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

---

## 4. Outlook / MSO Conditional Sanitization

Microsoft Word powers the email rendering engine in Microsoft Outlook for Windows. The following adjustments ensure flawless rendering across Outlook 2016, 2019, 2021, and M365 Desktop:

1. **Removed `<noscript>` inside `<xml>`:**
   Placing `<noscript>` inside Outlook conditional XML blocks causes syntax errors in Word's parser, resulting in raw code display or collapsed tables.
2. **Stripped Unsupported Modern CSS:**
   * Removed `box-shadow` (unsupported; replaced with semantic table borders).
   * Removed `aspect-ratio` (replaced with explicit HTML `width` and `height` attributes).
   * Removed `fetchpriority` and `decoding` attributes.
3. **Office DPI Normalization:**
   ```html
   <!--[if gte mso 9]>
   <xml>
     <o:OfficeDocumentSettings>
       <o:AllowPNG/>
       <o:PixelsPerInch>96</o:PixelsPerInch>
     </o:OfficeDocumentSettings>
   </xml>
   <![endif]-->
   ```

---

## 5. Automatic `<img` Categorization & Strict OCI Lock

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

### Why Visual Cards Send Exclusively via Oracle OCI
1. **Dedicated Sender Infrastructure:** Oracle OCI regional accounts operate across designated publication domains (`researchandrise.com`, `onlypaperpublication.com`, `yourpaperpublication.com`) that possess custom return paths and matching SPF/DKIM/DMARC records.
2. **M365 Mailbox Protection:** Microsoft Graph API mailboxes are tied to personal editorial identities and should not absorb high-volume visual poster traffic.
3. **Queue Enforcement:** If a queue item contains an `<img` tag, `queueWorker.js` filters candidate accounts strictly to `provider === 'OCI'`. If all OCI accounts are cooling down, the dispatch is delayed rather than leaking to Microsoft Graph or ACS.

---

## 6. Dynamic `{{senderDomain}}` Link Architecture

Visual templates use `{{senderDomain}}` in all interactive CTA elements:
```html
<a href="https://{{senderDomain}}/global-journal-for-research-analysis-GJRA/page/p/upload-your-article">
  Submit Manuscript Online &rarr;
</a>
```

* **At Queue Creation:** `{{senderDomain}}` is preserved intact so the database queue retains the unrendered variable.
* **At Send Time:** When `queueWorker.js` selects an OCI account (e.g. `editor@publication.onlypaperpublication.com`), `extractApexDomain()` strips the `publication.` subdomain and outputs `onlypaperpublication.com`.
* **In Recipient's Inbox:** Resolves to `https://onlypaperpublication.com/global-journal-for-research-analysis-GJRA/page/p/upload-your-article`.
* **On Port 443:** The LiteSpeed application server at `103.224.246.201` serves the active upload form over SSL with zero domain mismatch.

---

## 🔗 Related Documentation
- [[ENTERPRISE_DELIVERABILITY_BLUEPRINT_VERP_SES_AND_HEADERS]]
- [[OCI_OBJECT_STORAGE_AND_CDN_IMAGE_HOSTING_SOP]]
- [[INCIDENT_REPORT_INVALID_SENDER_DOMAIN_TRIPLE_SLASH_AND_VISUAL_OCI_LOCK]]
- [[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]]
- [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
