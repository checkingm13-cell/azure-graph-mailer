---
title: "SOP: Oracle Cloud Infrastructure (OCI) Object Storage & CDN Asset Hosting"
date: 2026-09-22
tags:
  - oci
  - object-storage
  - cdn
  - google-image-proxy
  - asset-hosting
  - email-deliverability
  - sop
  - obsidian-vault
aliases:
  - OCI Object Storage SOP
  - OCI Image Hosting
  - OCI CDN Assets
---

# 📦 SOP: Oracle Cloud Infrastructure (OCI) Object Storage & CDN Asset Hosting

> [!IMPORTANT]
> Standard Operating Procedure (SOP) for provisioning public buckets on Oracle Cloud Infrastructure (OCI), uploading campaign graphics, generating permanent high-speed CDN URLs, and configuring Google Image Proxy edge pre-caching.

---

## 1. Overview & Architectural Role

Visual email campaigns require public, high-throughput, SSL-secured graphic hosting that satisfies Google Image Proxy's pre-caching requirements. Hosting assets on Oracle Cloud Infrastructure (OCI) Object Storage provides:
* **Isolation from Web Hosting:** If the primary journal web server faces high traffic or maintenance, email poster images remain 100% online with 99.99% cloud SLA.
* **Direct Fiber Peering:** Oracle Cloud Mumbai (`ap-mumbai-1`) maintains direct low-latency peering with Google edge points of presence across India.
* **No Anti-Bot Captchas:** Unlike aggressive website WAFs, OCI Object Storage endpoints do not issue challenge pages or bot checks to Google crawler IP ranges.

---

## 2. Step-by-Step OCI Web Console Setup

### Step 1: Bucket Provisioning
1. Log into **[cloud.oracle.com](https://cloud.oracle.com)** with your tenancy credentials.
2. Open the main navigation menu (top-left ☰) $\to$ **Storage** $\to$ **Buckets**.
3. Select your designated compartment and region (e.g. `ap-mumbai-1`).
4. Click **Create Bucket**:
   - **Bucket Name:** `wwj-email-assets`
   - **Default Storage Tier:** Select **Standard** *(Never select Archive tier; Standard tier guarantees millisecond read response for email opens)*.
   - **Encryption:** Oracle-managed key.
5. Click **Create**.

### Step 2: Enable Public Bucket Visibility
1. Click the bucket name (`wwj-email-assets`) to enter its detail page.
2. Under **Bucket Information**, locate the **Visibility** setting.
3. Click **Edit Visibility**:
   - Change from *Private* to **Public**.
4. Click **Save Changes**.

> [!NOTE]
> Public visibility allows anonymous HTTP `GET` requests for files inside the bucket. Anonymous users cannot list, modify, or delete files—they can only read known object paths.

### Step 3: Upload Campaign Graphics with Proper MIME Types
1. Scroll down to the **Objects** section and click **Upload**.
2. Drag and drop your visual cards (e.g. `GJRA-email.jpg`, `IJAR-email.jpg`).
3. Click **Advanced (Optional)**:
   - **Content-Type:** Explicitly set to `image/jpeg` (for `.jpg`) or `image/png` (for `.png`).
   - *(Critical: If left as `application/octet-stream`, Gmail will treat the file as a raw binary download and refuse to render it inline).*
4. Click **Upload**.

### Step 4: Extract the Public Permanent CDN URL
1. Next to the uploaded object, click the **three dots (⋮)** $\to$ **View Object Details**.
2. Locate the **URL Path (URI)** field:
   ```
   https://objectstorage.ap-mumbai-1.oraclecloud.com/n/<tenancy-namespace>/b/wwj-email-assets/o/<file-name>.jpg
   ```
3. Copy this URL. It is immediately ready for insertion into email template `<img src="...">` tags.

---

## 3. Alternative: Pre-Authenticated Requests (PAR)

If organizational policy mandates that the bucket itself remain **Private**:
1. Inside the private bucket, click the **three dots (⋮)** next to the specific file.
2. Click **Create Pre-Authenticated Request (PAR)**.
3. Configuration:
   - **Access Type:** Permit reads on "Object".
   - **Expiration Date:** Set 5 to 10 years into the future (e.g., Dec 31, 2035).
4. Click **Create Pre-Authenticated Request**.
5. Copy the generated PAR URL. Google Image Proxy will authenticate using the query token embedded in the URL.

---

## 4. Technical Analysis: Redirecting vs Direct Hosting

A common architectural question: *Can we set an Apache/LiteSpeed redirect on `worldwidejournals.com` pointing to the OCI bucket to avoid uploading?*

### The Verdict: Direct Hosting is Strongly Superior
1. **Redirects Do Not Eliminate Uploading:** For an HTTP 301/302 redirect from WWJ to OCI to succeed, the file must already exist in the OCI bucket. Otherwise, the recipient receives a `404 Not Found`.
2. **Latency Penalty:** A redirect introduces a 2-hop roundtrip (Google Proxy $\to$ WWJ $\to$ 301 $\to$ OCI $\to$ 200 OK), doubling latency.
3. **Spam Score Impact:** Anti-spam engines (Barracuda, SpamAssassin) assign higher risk scores to email images that bounce across cross-domain redirects compared to static direct URLs.
4. **Current WWJ CDN Status:** The existing endpoints on `worldwidejournals.com/.../M-Images/...` are already protected by **Sucuri CloudProxy Anycast CDN**, responding with `X-Sucuri-Cache: HIT` and **HTTP/3** in under 25ms.

---

## 5. Automated Mailer Dashboard Roadmap (Programmatic Upload)

To eliminate logging into the Oracle Cloud Console every month, the platform supports an integrated upload pipeline via the **OCI REST API / SDK**:

```
[ User drops JPG into Mailer Dashboard (Tab 4) ]
                       │
                       ▼
[ Express API Route: POST /api/templates/upload-asset ]
                       │
                       ▼
[ OCI SDK: PutObjectRequest (Content-Type: image/jpeg) ]
                       │
                       ▼
[ OCI Object Storage Bucket: wwj-email-assets ]
                       │
                       ▼
[ Returns Public HTTPS URL directly into Template Editor ]
```

---

## 🔗 Related Notes (Obsidian Links)
* [[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]]
* [[INCIDENT_REPORT_INVALID_SENDER_DOMAIN_TRIPLE_SLASH_AND_VISUAL_OCI_LOCK]]
* [[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]]
* [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
* [[README]]
