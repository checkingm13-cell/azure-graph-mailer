# Technical Specification: Production Campaign Scheduling & Real-Time Monitor

**Target System:** `azure-graph-mailer`  
**Author:** Antigravity Engineering (GSD & Ponytail Modes)  
**Status:** DRAFT (Approved via /grill-me)  
**Date:** 2026-09-10  

---

## 1. Goal & Requirements Overview

Transform `azure-graph-mailer` into a bulletproof production-ready engine with:
1. **Dedicated Primary Sender:** Configured for `dr.reetashah@theparipexjournal.com` (Chief Editor).
2. **Three Flexible Scheduling Modes:**
   - **Immediate Launch:** Starts processing immediately 24/7 across the pool.
   - **Specific Date/Time:** Holds the campaign until the specified timestamp (e.g. `2026-09-11 09:00 AM`).
   - **Staggered Batches:** Applies an automatic interval delay between consecutive batches (e.g. 1 batch every 2 hours or 1 batch per day).
3. **Pre-Flight Projected Schedule Timeline:** In the CSV upload preview, show the exact projected start time and ETA for every batch before confirming.
4. **Live Frontend Campaign Monitor:**
   - **"Now Running" Card:** Live visual progress bar (`sent / total`), active sender account, and dynamic ETA counter.
   - **"Scheduled Queue Timeline":** Cards showing upcoming batches, their contact counts, and scheduled launch dates.
   - **Batch Action Controls:** 1-Click Pause, Resume, and Cancel buttons for any campaign.

---

## 2. Database Schema Modifications

### Table: `campaigns`
Add columns if not existing:
- `scheduled_for DATETIME DEFAULT CURRENT_TIMESTAMP`: Time when the campaign is eligible to run.
- `started_at DATETIME`: Time when the first email was sent.
- `completed_at DATETIME`: Time when all emails finished.
- `status TEXT DEFAULT 'QUEUED'`: `SCHEDULED`, `QUEUED`, `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED`.

### Table: `queue`
Add column:
- `scheduled_for DATETIME DEFAULT CURRENT_TIMESTAMP`: Matches campaign schedule or staggered item schedule.

---

## 3. Queue Worker Scheduler Engine (`src/services/queueWorker.js`)

Modify queue fetching logic to enforce schedules:
```sql
SELECT q.*, c.name AS campaign_name, c.status AS campaign_status
FROM queue q
JOIN campaigns c ON q.campaign_id = c.id
WHERE q.status = 'queued'
  AND (q.scheduled_for IS NULL OR q.scheduled_for <= datetime('now'))
  AND c.status IN ('QUEUED', 'RUNNING')
ORDER BY q.scheduled_for ASC, q.id ASC
LIMIT 1
```

Lifecycle hooks:
- When first email of a campaign is picked: `UPDATE campaigns SET status = 'RUNNING', started_at = datetime('now') WHERE id = ? AND status = 'QUEUED'`
- When last email is sent: `UPDATE campaigns SET status = 'COMPLETED', completed_at = datetime('now') WHERE id = ?`
- If campaign is `PAUSED` or `CANCELLED`, worker immediately ignores its items.

---

## 4. API Endpoints

1. `POST /api/campaigns/preview-upload`:
   - Enhanced to accept `scheduleMode`, `scheduledStartTime`, `staggerMinutes`.
   - Computes `projectedSchedule`:
     - Batch 01: Starts at `T0`, completes at `T0 + count * 2.5s`
     - Batch 02: Starts at `T1`, completes at `T1 + count * 2.5s`
2. `POST /api/campaigns/launch-batches`:
   - Enforces `scheduled_for` calculation on campaigns and queue items.
3. `POST /api/campaigns/:id/pause`: Pauses specific campaign.
4. `POST /api/campaigns/:id/resume`: Resumes paused campaign.
5. `POST /api/campaigns/:id/cancel`: Cancels campaign and marks remaining queued items as `cancelled`.
6. `GET /api/campaigns/active-monitor`: Returns currently running campaign telemetry + upcoming scheduled campaigns.

---

## 5. Frontend UI Enhancements (`public/index.html` & `public/js/app.js`)

1. **Pre-Flight Preview Box:**
   - Add Schedule Mode Selector: `Immediate` | `Specific Date & Time` | `Staggered Batches`.
   - Datetime picker input: `scheduledStartTime`.
   - Stagger interval input: `staggerMinutes` / `staggerHours` (default 60 mins).
   - Dynamic Timeline Table: Shows projected launch times.
2. **"Now Running" Hero Monitor:**
   - Displayed prominently at top of Campaigns tab and Dashboard Overview.
   - Shows active batch name, progress bar with percentage, sender email (`dr.reetashah@theparipexjournal.com`), and ETA timer.
   - Action buttons: `Pause Campaign` / `Cancel Campaign`.
3. **"Scheduled Timeline" Feed:**
   - Chronological list of future batches waiting for their start time.
4. **Sender Account Seed:**
   - Set `.env` and default seed account to `dr.reetashah@theparipexjournal.com`.

---

## 6. Verification Plan

1. Run automated test `tests/scheduler-test.js`:
   - Test 1: Immediate queue dispatching.
   - Test 2: Future scheduled campaign remains untouched until its timestamp.
   - Test 3: Staggered batch timestamps are properly calculated.
   - Test 4: Pause, Resume, and Cancel status transitions.
2. Verify frontend at `http://localhost:5000`.
3. Commit and push to GitHub.
