---
title: "SOP: Oracle Cloud Infrastructure (OCI) Object Storage, S3 Compatibility API & Image Hosting"
date: 2026-09-23
tags:
  - oci
  - object-storage
  - s3-api
  - aws-sdk
  - cdn
  - asset-hosting
  - email-deliverability
  - sop
  - obsidian-vault
aliases:
  - OCI Object Storage SOP
  - OCI Image Hosting
  - OCI S3 API Integration
---

# 📦 SOP: Oracle Cloud Infrastructure (OCI) Object Storage & S3 API Image Hosting

> [!IMPORTANT]
> Comprehensive Standard Operating Procedure for provisioning OCI Object Storage buckets, integrating the S3 Compatibility API with `@aws-sdk/client-s3`, enabling the in-app dashboard upload modal, configuring dynamic template insertion, and deploying Method A `.htaccess` reverse-proxy redirects.

---

## 1. Architectural Overview & Design Pattern

Visual Graphic Card email campaigns require reliable, high-throughput image hosting that renders in 0.00s across Gmail, Google Workspace, and Microsoft Outlook.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      IMAGE UPLOAD & DISPATCH PIPELINE                  │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Dashboard UI     │ Drag-and-drop file into Upload Modal             │
│ 2. Express Backend  │ POST /api/upload-image (multer memory storage)   │
│ 3. S3 Compat API    │ @aws-sdk/client-s3 PutObjectCommand              │
│ 4. OCI Bucket       │ wwjemailassets in ap-mumbai-1 (Standard Tier)    │
│ 5. Template Inject  │ Direct OCI CDN URL into <img> tag in SQLite DB   │
│ 6. Google Proxy     │ 0-hop direct fetch from Oracle Cloud Mumbai CDN  │
└────────────────────────────────────────────────────────────────────────┘
```

> [!TIP]
> **Why Direct OCI CDN for `<img>` vs Sender Domain for `<a href>`:**
> - `<img src>` tags use direct Oracle Cloud Object Storage URLs to prevent Google Image Proxy from hitting 301 redirect timeouts.
> - `<a href>` links retain `https://{{senderDomain}}/...` to preserve domain alignment and sender reputation for user clicks.

### Why OCI Object Storage S3 Compatibility?
* **Native Node.js SDK:** Uses standard `@aws-sdk/client-s3` without heavy proprietary OCI binaries.
* **Standard Storage Tier:** Millisecond first-byte read latency.
* **Direct Google Edge Peering:** Oracle Cloud Mumbai (`ap-mumbai-1`) maintains direct fiber interconnects with Google India POPs, eliminating image proxy timeouts.

---

## 2. Server Configuration & Environment Variables

### Production Credentials (`.env`):
To enable programmatic uploads from the dashboard, configure the following keys in your environment:

```env
# OCI Object Storage S3 Compatibility Credentials
OCI_S3_ACCESS_KEY=your_oci_customer_secret_access_key
OCI_S3_SECRET_KEY=your_oci_customer_secret_key
OCI_S3_NAMESPACE=bmgxwcqtiqic
OCI_S3_BUCKET=wwjemailassets
OCI_S3_REGION=ap-mumbai-1
```

### Generating OCI S3 Customer Secret Keys in OCI Console:
1. Log into **[cloud.oracle.com](https://cloud.oracle.com)**.
2. In top-right user menu, click **Profile / User Settings** (e.g. `checkingm13@gmail.com`).
3. Under **Resources** (bottom left), select **Customer Secret Keys**.
4. Click **Generate Secret Key**:
   - Name: `mailer-s3-uploader`
5. **Copy the Secret Key immediately** (it will never be displayed again) $\to$ `OCI_S3_SECRET_KEY`.
6. Copy the **Access Key** shown in the table $\to$ `OCI_S3_ACCESS_KEY`.

---

## 3. Backend Implementation (`server.js`)

The upload engine is implemented using Multer (in-memory buffering) and the AWS SDK v3 S3 client:

```javascript
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// Configure Multer for memory buffering (max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Lazy-initialized OCI S3 Client
let s3Client = null;
function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.OCI_S3_REGION || 'ap-mumbai-1',
      endpoint: `https://${process.env.OCI_S3_NAMESPACE}.compat.objectstorage.${process.env.OCI_S3_REGION || 'ap-mumbai-1'}.oraclecloud.com`,
      credentials: {
        accessKeyId: process.env.OCI_S3_ACCESS_KEY,
        secretAccessKey: process.env.OCI_S3_SECRET_KEY
      },
      forcePathStyle: true
    });
  }
  return s3Client;
}

// Upload Endpoint
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const client = getS3Client();
    const cleanFilename = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `${Date.now()}-${cleanFilename}`;
    const bucket = process.env.OCI_S3_BUCKET || 'wwjemailassets';
    const namespace = process.env.OCI_S3_NAMESPACE;
    const region = process.env.OCI_S3_REGION || 'ap-mumbai-1';

    // Upload to OCI Object Storage
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'image/jpeg'
    }));

    // Generate permanent OCI CDN URL
    const ociUrl = `https://objectstorage.${region}.oraclecloud.com/n/${namespace}/b/${bucket}/o/${encodeURIComponent(objectKey)}`;
    const senderDomainUrl = `https://{{senderDomain}}/posters/${encodeURIComponent(objectKey)}`;

    // Optional: Auto-update template if templateId provided
    if (req.body.templateId) {
      const template = getTemplateById(req.body.templateId);
      if (template) {
        const targetUrl = req.body.urlType === 'senderDomain' ? senderDomainUrl : ociUrl;
        const updatedHtml = template.html_body.replace(
          /<img\b([^>]*?)src=["'][^"']*?["']([^>]*?)>/i,
          `<img$1src="${targetUrl}"$2>`
        );
        updateTemplateHtml(req.body.templateId, updatedHtml);
      }
    }

    res.json({
      success: true,
      ociUrl,
      senderDomainUrl,
      objectKey
    });
  } catch (err) {
    console.error('Image upload failed:', err);
    res.status(500).json({ error: err.message });
  }
});
```

---

## 4. Frontend Dashboard UI (`public/index.html` & `public/js/app.js`)

### Modal Capabilities:
1. **File Input:** Supports JPG, PNG, WEBP up to 10MB.
2. **URL Routing Mode Selection:**
   - **Method A (Recommended):** Dynamic Sender Domain (`https://{{senderDomain}}/posters/...`).
   - **Direct OCI CDN:** Direct public cloud URL (`https://objectstorage.ap-mumbai-1.oraclecloud.com/...`).
3. **Target Template Selector:** Dropdown dynamically populated with all database templates (e.g. *GJRA Call for Papers*, *Paripex October Issue*). Selecting a template automatically updates its `<img src="...">` tag upon successful upload.

---

## 5. Method A Apache / LiteSpeed Rewrite Rule

To enable the `https://{{senderDomain}}/posters/...` URL pattern without hosting large image files on the cPanel server:

Add the following rule to the root `.htaccess` of each sending domain (`researchandrise.com`, `onlypaperpublication.com`, `yourpaperpublication.com`):

```apache
# ====================================================================
# METHOD A: WWJ POSTER ASSET 301 REWRITE TO OCI OBJECT STORAGE CDN
# ====================================================================
RewriteEngine On
RewriteRule ^posters/(.*)$ https://objectstorage.ap-mumbai-1.oraclecloud.com/n/bmgxwcqtiqic/b/wwjemailassets/o/$1 [R=301,L]
```

### Operational Verification:
Test the rewrite using PowerShell:
```powershell
curl.exe -I "https://education.researchandrise.com/posters/GJRA-email.jpg"
```
**Expected Response:**
```text
HTTP/2 301
location: https://objectstorage.ap-mumbai-1.oraclecloud.com/n/bmgxwcqtiqic/b/wwjemailassets/o/GJRA-email.jpg
```

---

## 6. Production Troubleshooting & Post-Mortem

### Issue: `Upload failed: Unexpected token '<'`
* **Symptom:** When clicking "Upload Poster" in the dashboard, the browser alert displayed: `Upload failed: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
* **Root Cause:** The production server on `mailapp.balajiimpex.store` returned an HTML 404/500 error page because:
  1. The new `/api/upload-image` route was not yet loaded in the running PM2 memory.
  2. The `@aws-sdk/client-s3` dependency was missing from `node_modules` on the server.
* **Resolution Executed:**
  ```bash
  ssh balajiimpex.store_bml3kawopzt@balajiimpex.store
  cd /var/www/vhosts/balajiimpex.store/mailapp.balajiimpex.store
  npm install --production @aws-sdk/client-s3
  pm2 restart 0
  ```
  Verified `POST /api/upload-image` returns `200 OK` with valid JSON payload.

---

## 🔗 Related Documentation
- [[ENTERPRISE_DELIVERABILITY_BLUEPRINT_VERP_SES_AND_HEADERS]]
- [[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]]
- [[JOURNAL_TEMPLATES_AND_DYNAMIC_LINKS]]
- [[ARCHITECTURE_AND_SYSTEM_DESIGN]]
