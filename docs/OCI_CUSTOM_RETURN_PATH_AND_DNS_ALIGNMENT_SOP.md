---
title: "SOP: OCI Custom Return Path & Complete DNS Alignment Runbook"
date: 2026-09-23
tags:
  - oci
  - email-delivery
  - custom-return-path
  - dkim
  - dmarc
  - spf
  - dns
  - sop
  - obsidian-vault
aliases:
  - OCI DNS Alignment SOP
  - Custom Return Path Setup
  - Email Delivery DNS Configuration
---

# 🌐 SOP: OCI Custom Return Path & Complete DNS Alignment Runbook

> [!IMPORTANT]
> Standard Operating Procedure (SOP) for configuring, validating, and troubleshooting DNS authentication records across Oracle Cloud Infrastructure (OCI) Email Delivery and cPanel DNS Zone Editor. Follow this runbook whenever onboarding a new sending domain or subdomain.

---

## 1. Prerequisites & Required Access

Before beginning, ensure you have:
1. Administrator access to **[cloud.oracle.com](https://cloud.oracle.com)** (Email Delivery service).
2. Administrator access to **cPanel / WHM** (Zone Editor) for the root domain.
3. Access to terminal / PowerShell for DNS resolution validation.

---

## 2. Step-by-Step Configuration in OCI Console

### Step 1: Create Email Domain in OCI
1. Open the OCI Console $\to$ Navigation menu (☰) $\to$ **Developer Services** $\to$ **Email Delivery** $\to$ **Email Domains**.
2. Select your designated compartment (e.g. `checkingm13 (root)`).
3. Click **Create Email Domain**:
   - **Email Domain Name:** Enter the sending subdomain (e.g. `publication.onlypaperpublication.com` or `education.researchandrise.com`).
4. Click **Create Email Domain**.

### Step 2: Generate DKIM Keys
1. In the newly created email domain detail page, click **Add DKIM**:
   - **DKIM Selector:** `oci`
2. Click **Add DKIM**.
3. OCI will display the required DNS CNAME record:
   - **Name:** `oci._domainkey.<subdomain>.<domain>.com`
   - **Value:** `oci.<subdomain>.<domain>.com.dkim.bom1.oracleemaildelivery.com`

### Step 3: Configure Custom Return Path (CRITICAL)
1. In the email domain detail page, under **General Information**, find **Custom Return Path**.
2. Click **Configure Custom Return Path**:
   - **Subdomain Prefix:** Enter `bom1`
3. Click **Submit**.
4. OCI will provide the required CNAME record:
   - **Name:** `bom1.<subdomain>.<domain>.com`
   - **Value:** `bom1.rp.oracleemaildelivery.com`

---

## 3. Step-by-Step DNS Records in cPanel Zone Editor

Log into cPanel $\to$ **Zone Editor** $\to$ Click **Manage** next to the apex domain. Add or update the following records:

### 1. Custom Return Path (CNAME)
* **Name:** `bom1.<subdomain>.<domain>.com.`
* **TTL:** `14400` (or `3600`)
* **Type:** `CNAME`
* **Record:** `bom1.rp.oracleemaildelivery.com`

### 2. OCI DKIM Signing Key (CNAME)
* **Name:** `oci._domainkey.<subdomain>.<domain>.com.`
* **TTL:** `14400`
* **Type:** `CNAME`
* **Record:** `oci.<subdomain>.<domain>.com.dkim.bom1.oracleemaildelivery.com`

### 3. Strict DMARC Policy (Apex Domain TXT)
* **Name:** `_dmarc.<domain>.com.`
* **TTL:** `14400`
* **Type:** `TXT`
* **Record:** `v=DMARC1;p=reject;sp=reject;adkim=r;aspf=r;pct=100;fo=0;rf=afrf;ri=86400`

### 4. Explicit Subdomain DMARC Policy (Subdomain TXT)
* **Name:** `_dmarc.<subdomain>.<domain>.com.`
* **TTL:** `14400`
* **Type:** `TXT`
* **Record:** `v=DMARC1;p=reject;sp=reject;adkim=r;aspf=r;pct=100;fo=0;rf=afrf;ri=86400`

### 5. SPF Record (TXT)
On the apex domain or sending subdomain:
* **Name:** `<subdomain>.<domain>.com.`
* **TTL:** `14400`
* **Type:** `TXT`
* **Record:** `v=spf1 include:recipient.email.oraclecloud.com ~all`

---

## 4. Verification Commands (CLI)

Run these checks in PowerShell or Linux terminal before sending any production traffic:

### A. Verify Custom Return Path CNAME
```powershell
Resolve-DnsName -Name "bom1.publication.onlypaperpublication.com" -Type CNAME
```
**Expected Output:**
```text
Name                                     Type   TTL   Section   NameHost
----                                     ----   ---   -------   --------
bom1.publication.onlypaperpublication... CNAME  14400 Answer    bom1.rp.oracleemaildelivery.com
```

### B. Verify DKIM Key Delegation
```powershell
Resolve-DnsName -Name "oci._domainkey.publication.onlypaperpublication.com" -Type CNAME
```
**Expected Output:**
Points to `oci.publication.onlypaperpublication.com.dkim.bom1.oracleemaildelivery.com`.

### C. Verify Strict DMARC Enforcement
```powershell
Resolve-DnsName -Name "_dmarc.publication.onlypaperpublication.com" -Type TXT
```
**Expected Output:**
Must contain `p=reject; sp=reject; aspf=r`.

---

## 5. Domain Inventory & Status Matrix

| Domain | Subdomain | Custom Return Path | DKIM Selector | DMARC Policy | SPF Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **researchandrise.com** | `education` | `bom1.education...` | `oci` | `p=reject; sp=reject` | Pass |
| **onlypaperpublication.com** | `publication` | `bom1.publication...` | `oci` | `p=reject; sp=reject` | Pass |
| **onlypaperpublication.com** | `publish` | Pending Setup | `oci` | `p=reject; sp=reject` | Pass |
| **yourpaperpublication.com** | `publication` | `bom1.publication...` | Pending | `p=reject; sp=reject` | Pass |
| **yourpaperpublication.com** | `education` | `bom1.education...` | Pending | `p=reject; sp=reject` | Pass |

---

## 6. Pre-Flight Deliverability Checklist

Before launching any cold campaign using a newly registered domain:
- [ ] OCI Email Domain status is **Active**.
- [ ] DKIM status in OCI Console shows **Active** (green checkmark).
- [ ] Custom Return Path status in OCI Console shows **Active**.
- [ ] `_dmarc` TXT record has `sp=reject` (subdomain reject) explicitly set.
- [ ] Method A `.htaccess` rewrite rule is active on the domain's web server.
- [ ] Approved Sender address is registered in OCI Console (e.g. `editor@publication.onlypaperpublication.com`).
- [ ] Test email sent to `checkingm13@gmail.com` arrives in **Primary Inbox** with green SPF, DKIM, and DMARC passes.

---

## 🔗 Related Documentation
- [[ENTERPRISE_DELIVERABILITY_BLUEPRINT_VERP_SES_AND_HEADERS]]
- [[OCI_OBJECT_STORAGE_AND_CDN_IMAGE_HOSTING_SOP]]
- [[VISUAL_CAMPAIGN_AND_OCI_ENGINE_SPECIFICATION]]
- [[README]]
