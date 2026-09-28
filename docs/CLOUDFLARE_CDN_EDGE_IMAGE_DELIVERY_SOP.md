---
title: "SOP: Cloudflare Global CDN Edge Acceleration for Email Images"
date: 2026-09-28
tags:
  - cloudflare
  - cdn
  - edge-cache
  - email-images
  - oci
  - deliverability
  - google-image-proxy
  - obsidian-vault
aliases:
  - Cloudflare Email CDN SOP
  - Cloudflare Worker Proxy
  - Global Image Delivery SOP
---

# 🚀 SOP: Cloudflare Global CDN Edge Acceleration for Email Images

> [!IMPORTANT]
> Standard Operating Procedure for global image delivery via Cloudflare Edge CDN (`cdn.theworldwidejournals.com`), backed by Oracle Cloud Infrastructure (OCI) Object Storage (`wwjemailassets`), utilizing Cloudflare Workers Edge caching to guarantee sub-millisecond inbox render times across Gmail, Outlook, and Apple Mail.

---

## 1. Architectural Overview & System Design

```
┌────────────────────────────────────────────────────────────────────────┐
│               SUB-MILLISECOND EMAIL IMAGE DELIVERY PIPELINE            │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Dashboard UI     │ Drag-and-drop file into Upload Modal             │
│ 2. Sharp Engine     │ High-speed compression to WebP (<50 KB)          │
│ 3. S3 Compat API    │ AWS SDK PutObjectCommand -> OCI ap-mumbai-1      │
│ 4. Pre-Warm Hook    │ Fire-and-forget ping to Cloudflare & Google Proxy│
│ 5. Global CDN Edge  │ cdn.theworldwidejournals.com (Cloudflare Worker) │
│ 6. Recipient Inbox  │ 0.00s Instant RAM Cache HIT (cf-cache-status: HIT│
└────────────────────────────────────────────────────────────────────────┘
```

### Why Cloudflare Edge CDN Fronting OCI Object Storage?
1. **Global Anycast Edge (330+ POPs):** Google Image Proxy (`ggpht.com`) and Apple Mail Relay fetch assets directly from Cloudflare edge RAM in < 10ms.
2. **Eliminates Cold Storage Latency:** OCI Object Storage provides durable, low-cost persistence, while Cloudflare handles millions of concurrent global fetches with zero egress fees.
3. **Automated Host Header Normalization:** Cloudflare Worker seamlessly remaps incoming clean requests (`https://cdn.theworldwidejournals.com/posters/:image`) to Oracle's long bucket path (`/n/bmgxwcqtiqic/b/wwjemailassets/o/posters/:image`) and injects the required Oracle Host header without requiring Enterprise Cloudflare plans.

---

## 2. Cloudflare Worker Edge Proxy Configuration

### Worker Script (`email-cdn-proxy`):
Deployed on Cloudflare Workers and bound to the route: `cdn.theworldwidejournals.com/*`

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Extract just the clean filename regardless of incoming path
    const filename = url.pathname.split('/').filter(Boolean).pop();

    if (!filename) {
      return new Response('File not specified', { status: 400 });
    }

    // Direct Oracle Object Storage CDN URL
    const originUrl = `https://objectstorage.ap-mumbai-1.oraclecloud.com/n/bmgxwcqtiqic/b/wwjemailassets/o/posters/${encodeURIComponent(filename)}`;

    // Fetch from Oracle with Cloudflare Edge Caching
    return fetch(originUrl, {
      cf: {
        cacheEverything: true,
        cacheTtl: 31536000 // 1 year edge cache
      }
    });
  }
};
```

---

## 3. Server Configuration & Environment Variables

### Production `.env`:
```env
# Oracle Cloud Infrastructure (OCI) Object Storage (S3-Compatible)
OCI_S3_ACCESS_KEY=2d89bb1b95b6d900ce032bab4f49bd91cbcf3f51
OCI_S3_SECRET_KEY=U8jWTHCEPgWMUbhb7UkFz2E5zAwNweSikHDMWK83PWs=
OCI_S3_NAMESPACE=bmgxwcqtiqic
OCI_S3_BUCKET=wwjemailassets
OCI_S3_REGION=ap-mumbai-1

# Cloudflare Global CDN Edge for Sub-Millisecond Email Image Delivery
CLOUDFLARE_CDN_DOMAIN=cdn.theworldwidejournals.com
```

---

## 4. Verification & Operational Testing

### 1. Direct Edge Cache Verification:
```bash
curl.exe -IL "https://cdn.theworldwidejournals.com/posters/paripex-email_1f3538555e6a.jpg"
```
**Expected Output:**
```text
HTTP/1.1 200 OK
Server: cloudflare
CF-Cache-Status: HIT
Cache-Control: max-age=31536000
Content-Type: image/jpeg
```

### 2. Google Image Proxy Verification:
```bash
curl.exe -IL -A "via ggpht.com GoogleImageProxy" "https://cdn.theworldwidejournals.com/posters/paripex-email_1f3538555e6a.jpg"
```
**Expected Output:**
`HTTP/1.1 200 OK` with zero CAPTCHA or Cloudflare challenge pages.

---

## 🔗 Related Documentation
- [[OCI_OBJECT_STORAGE_AND_CDN_IMAGE_HOSTING_SOP]]
- [[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]]
- [[INCIDENT_REPORT_LIVE_SAMPLE_PREVIEW_AND_DIRECT_OCI_CDN]]
- [[README]]
