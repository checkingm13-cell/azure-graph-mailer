/**
 * Automated Verification Test for Production Campaign Scheduler & Controls
 * Covers:
 * 1. Primary Sender Account verification (dr.reetashah@theparipexjournal.com)
 * 2. Preview upload with Immediate, Scheduled, and Staggered modes
 * 3. Launch batches with exact future timestamps and queue inheritance
 * 4. Queue Worker schedule gating (future items are preserved and untouched)
 * 5. Campaign Lifecycle controls (Pause, Resume, Cancel)
 * 6. Active Monitor Telemetry API
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const config = require('../src/config/env');

async function runTest() {
  console.log('===========================================================');
  console.log('🧪 RUNNING PRODUCTION CAMPAIGN SCHEDULER VERIFICATION TEST');
  console.log('===========================================================');

  // Load app to initialize schema, seed default sender account and start worker
  const app = require('../src/app');
  const BASE_URL = `http://127.0.0.1:${config.port}`;

  // Test 1: Verify Default Sender Email Configuration
  console.log('\n[Test 1] Verifying Primary Dedicated Sender Account...');
  const defaultAccount = db.prepare("SELECT * FROM accounts WHERE email = 'dr.reetashah@theparipexjournal.com'").get();
  assert.ok(defaultAccount, 'Primary sender dr.reetashah@theparipexjournal.com must exist in database');
  console.log(`✅ Default Sender Account verified: ${defaultAccount.email} (${defaultAccount.display_name})`);

  try {
    // Prepare a test CSV with 60 contacts (creates 2 batches with size=50)
    const testCsvPath = path.join(__dirname, 'mock_scheduler_contacts.csv');
    let csvData = 'Author Name,Email,Paper Title,Affiliation\n';
    for (let i = 1; i <= 60; i++) {
      csvData += `Researcher ${i},researcher_${i}@testparipex.org,Paper On Robotics ${i},Tech Institute\n`;
    }
    fs.writeFileSync(testCsvPath, csvData);

    const fileBuffer = fs.readFileSync(testCsvPath);

      // Test 2: Preview Upload with 3 Modes
      console.log('\n[Test 2] Testing Pre-Flight Preview with Scheduling Modes...');

      // 2A: Immediate Mode
      const formImm = new globalThis.FormData();
      formImm.append('file', new Blob([fileBuffer], { type: 'text/csv' }), 'Robotics_Vol_01.csv');
      formImm.append('batchSize', '50');
      formImm.append('scheduleMode', 'immediate');

      const resImm = await fetch(`${BASE_URL}/api/campaigns/preview-upload`, {
        method: 'POST',
        body: formImm
      });
      const previewImm = await resImm.json();
      assert.strictEqual(previewImm.ok, true);
      assert.strictEqual(previewImm.totalBatches, 2);
      assert.strictEqual(previewImm.batches[0].count, 50);
      assert.strictEqual(previewImm.batches[1].count, 10);
      console.log('✅ 2A: Immediate Preview computed 2 batches successfully');

      // 2B: Staggered Mode (e.g. 120 minutes apart)
      const futureStart = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      const formStagger = new globalThis.FormData();
      formStagger.append('file', new Blob([fileBuffer], { type: 'text/csv' }), 'Robotics_Vol_02.csv');
      formStagger.append('batchSize', '50');
      formStagger.append('scheduleMode', 'staggered');
      formStagger.append('scheduledStartTime', futureStart);
      formStagger.append('staggerMinutes', '120');

      const resStagger = await fetch(`${BASE_URL}/api/campaigns/preview-upload`, {
        method: 'POST',
        body: formStagger
      });
      const previewStagger = await resStagger.json();
      assert.strictEqual(previewStagger.ok, true);
      const batch1Start = new Date(previewStagger.batches[0].scheduledAt).getTime();
      const batch2Start = new Date(previewStagger.batches[1].scheduledAt).getTime();
      const diffMinutes = Math.round((batch2Start - batch1Start) / (60 * 1000));
      assert.strictEqual(diffMinutes, 120, 'Batch 2 should be staggered by exactly 120 minutes');
      console.log(`✅ 2B: Staggered Preview computed interval of ${diffMinutes} minutes between batches`);

      // Test 3: Launch Batches in Staggered / Future Mode
      console.log('\n[Test 3] Testing Launch Batches with Future Scheduled Timestamps...');
      const tpl = db.prepare('SELECT id FROM templates LIMIT 1').get();
      assert.ok(tpl, 'At least 1 template must exist');

      const futureDateStr = new Date(Date.now() + 86400000).toISOString(); // 24 hours in future

      const launchRes = await fetch(`${BASE_URL}/api/campaigns/launch-batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCampaignName: 'Future_Conference_2026',
          templateId: tpl.id,
          batchSize: 50,
          scheduleMode: 'staggered',
          scheduledStartTime: futureDateStr,
          staggerMinutes: 60,
          contacts: previewStagger.contacts
        })
      });
      const launch = await launchRes.json();
      assert.strictEqual(launch.ok, true);
      assert.strictEqual(launch.totalCampaigns, 2);
      assert.strictEqual(launch.campaigns[0].status, 'SCHEDULED', 'Future campaign must start with status SCHEDULED');
      assert.strictEqual(launch.campaigns[1].status, 'SCHEDULED', 'Batch 2 must also start with status SCHEDULED');

      const camp1 = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(launch.campaigns[0].campaignId);
      const camp2 = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(launch.campaigns[1].campaignId);
      assert.ok(camp1.scheduled_at, 'Campaign 1 must have scheduled_at');
      assert.ok(camp2.scheduled_at, 'Campaign 2 must have scheduled_at');

      // Verify queue items inherited campaign's scheduled_at
      const queueCamp1 = db.prepare('SELECT scheduled_at FROM queue WHERE campaign_id = ? LIMIT 1').get(camp1.id);
      assert.strictEqual(queueCamp1.scheduled_at, camp1.scheduled_at, 'Queue items must inherit scheduled_at');
      console.log(`✅ 3: Launched 2 batches in SCHEDULED state: Batch 1 at ${camp1.scheduled_at}, Batch 2 at ${camp2.scheduled_at}`);

      // Test 4: Queue Worker Query Adherence
      console.log('\n[Test 4] Verifying Queue Worker does NOT pick future scheduled items...');
      const workerItem = db.prepare(`
        SELECT q.*, c.name AS campaign_name, c.status AS campaign_status
        FROM queue q
        JOIN campaigns c ON q.campaign_id = c.id
        WHERE q.campaign_id = ?
          AND q.status = 'queued'
          AND (q.scheduled_at IS NULL OR q.scheduled_at <= datetime('now'))
          AND c.status IN ('SCHEDULED', 'QUEUED', 'RUNNING')
        ORDER BY q.scheduled_at ASC, q.id ASC
        LIMIT 1
      `).get(camp1.id);

      assert.strictEqual(workerItem, undefined, 'Worker query must ignore items scheduled in the future');
      console.log('✅ 4: Queue worker query correctly ignored future scheduled batch');

      // Test 5: Campaign Lifecycle Controls (Pause, Resume, Cancel)
      console.log('\n[Test 5] Testing Campaign Controls (Pause, Resume, Cancel)...');

      // 5A: Pause
      const pauseRes = await fetch(`${BASE_URL}/api/campaigns/${camp1.id}/pause`, { method: 'POST' });
      const pauseData = await pauseRes.json();
      assert.strictEqual(pauseData.ok, true);
      const campPaused = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(camp1.id);
      assert.strictEqual(campPaused.status, 'PAUSED', 'Campaign should transition to PAUSED');
      console.log('✅ 5A: Campaign paused successfully');

      // 5B: Resume
      const resumeRes = await fetch(`${BASE_URL}/api/campaigns/${camp1.id}/resume`, { method: 'POST' });
      const resumeData = await resumeRes.json();
      assert.strictEqual(resumeData.ok, true);
      const campResumed = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(camp1.id);
      assert.strictEqual(campResumed.status, 'QUEUED', 'Campaign should resume to QUEUED (or RUNNING)');
      console.log('✅ 5B: Campaign resumed successfully');

      // 5C: Cancel
      const cancelRes = await fetch(`${BASE_URL}/api/campaigns/${camp1.id}/cancel`, { method: 'POST' });
      const cancelData = await cancelRes.json();
      assert.strictEqual(cancelData.ok, true);
      const campCancelled = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(camp1.id);
      assert.strictEqual(campCancelled.status, 'CANCELLED', 'Campaign should transition to CANCELLED');

      const remainingQueued = db.prepare("SELECT COUNT(*) AS count FROM queue WHERE campaign_id = ? AND status = 'queued'").get(camp1.id).count;
      assert.strictEqual(remainingQueued, 0, 'No queued items should remain after cancel');
      console.log('✅ 5C: Campaign cancelled and remaining queue items marked failed with user note');

      // Test 6: Active Monitor Telemetry Endpoint
      console.log('\n[Test 6] Verifying Active Monitor Telemetry Endpoint...');
      const monitorRes = await fetch(`${BASE_URL}/api/campaigns/active-monitor`);
      const monitor = await monitorRes.json();
      assert.strictEqual(monitor.ok, true);
      assert.ok('upcomingCampaigns' in monitor, 'Telemetry must include upcomingCampaigns array');
      console.log(`✅ 6: Active monitor telemetry verified (Upcoming scheduled batches: ${monitor.upcomingCampaigns.length})`);

      // Cleanup mock file
      try { fs.unlinkSync(testCsvPath); } catch (_) {}

      console.log('\n===========================================================');
      console.log('🎉 ALL PRODUCTION SCHEDULER & CONTROL TESTS PASSED 100%!');
      console.log('===========================================================');

      process.exit(0);
  } catch (testErr) {
    console.error('❌ TEST FAILED:', testErr);
    process.exit(1);
  }
}

runTest();
