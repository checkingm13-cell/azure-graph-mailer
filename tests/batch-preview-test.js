/**
 * Automated Verification Test for Auto-Split Batches & Pre-Flight Preview
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

async function runTest() {
  console.log('--- Testing Auto-Split Campaign Batching & Pre-Flight Preview ---');

  // 1. Create a mock CSV with 110 rows (105 valid, 2 duplicates, 1 invalid)
  const testCsvPath = path.join(__dirname, 'mock_authors.csv');
  let csvData = 'Author Name,Email,Paper Title,Affiliation\n';
  for (let i = 1; i <= 105; i++) {
    csvData += `Dr. Author ${i},author_${i}@university.edu,Quantum Field ${i},Harvard Univ\n`;
  }
  // Add 2 duplicate emails
  csvData += `Duplicate One,author_1@university.edu,Paper 1,Harvard\n`;
  csvData += `Duplicate Two,author_2@university.edu,Paper 2,Harvard\n`;
  // Add 1 invalid email
  csvData += `Invalid Person,not-an-email,No Paper,MIT\n`;

  fs.writeFileSync(testCsvPath, csvData);

  // 2. Start Express app locally
  const app = require('../src/app');
  const server = app.listen(5099, async () => {
    try {
      console.log('[TestServer] Running on port 5099');

      // 3. Test Preview Upload endpoint
      const FormData = require('multer');
      // Use native fetch (Node 18+) with FormData and Blob
      const fileBuffer = fs.readFileSync(testCsvPath);
      const blob = new Blob([fileBuffer], { type: 'text/csv' });
      const form = new globalThis.FormData();
      form.append('file', blob, 'Cardiology_Call_For_Papers_2026.csv');
      form.append('batchSize', '50');

      const previewRes = await fetch('http://127.0.0.1:5099/api/campaigns/preview-upload', {
        method: 'POST',
        body: form
      });
      const preview = await previewRes.json();

      console.log('[TestPreview] Result:', {
        baseCampaignName: preview.baseCampaignName,
        totalRows: preview.totalRows,
        validCount: preview.validCount,
        duplicateInSheetCount: preview.duplicateInSheetCount,
        invalidCount: preview.invalidCount,
        totalBatches: preview.totalBatches,
        batches: preview.batches.map(b => `${b.name} (${b.count} contacts)`)
      });

      assert.strictEqual(preview.ok, true);
      assert.strictEqual(preview.baseCampaignName, 'Cardiology_Call_For_Papers_2026');
      assert.strictEqual(preview.validCount, 105, 'Should have 105 unique valid contacts');
      assert.strictEqual(preview.duplicateInSheetCount, 2, 'Should detect 2 in-sheet duplicates');
      assert.strictEqual(preview.invalidCount, 1, 'Should detect 1 invalid email');
      assert.strictEqual(preview.totalBatches, 3, '105 contacts / 50 per batch = 3 batches');
      assert.strictEqual(preview.batches[0].count, 50, 'Batch 1 should have 50');
      assert.strictEqual(preview.batches[1].count, 50, 'Batch 2 should have 50');
      assert.strictEqual(preview.batches[2].count, 5, 'Batch 3 should have 5');

      console.log('✅ PREVIEW & AUTO-SPLIT CALCULATION PASSED!');

      // 4. Test Launch Batches endpoint
      const tpl = db.prepare('SELECT id FROM templates LIMIT 1').get();
      assert.ok(tpl, 'At least 1 template must exist');

      const launchRes = await fetch('http://127.0.0.1:5099/api/campaigns/launch-batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseCampaignName: preview.baseCampaignName,
          templateId: tpl.id,
          batchSize: 50,
          skipPreviouslyContacted: false,
          contacts: preview.contacts
        })
      });
      const launch = await launchRes.json();
      console.log('[TestLaunch] Result:', launch.message);

      assert.strictEqual(launch.ok, true);
      assert.strictEqual(launch.totalCampaigns, 3, 'Should create 3 campaigns');
      assert.strictEqual(launch.totalQueued, 105, 'Should queue 105 emails');

      // 5. Verify Database deduplication and queues
      const queueCount = db.prepare(`
        SELECT COUNT(*) as count FROM queue 
        WHERE campaign_id IN (${launch.campaigns.map(c => c.campaignId).join(',')})
      `).get().count;

      assert.strictEqual(queueCount, 105, '105 emails should be in queue');

      console.log('✅ CAMPAIGN LAUNCH & DEDUPLICATION TEST PASSED 100%!');

      // Cleanup
      try { fs.unlinkSync(testCsvPath); } catch (_) {}
      server.close(() => process.exit(0));

    } catch (err) {
      console.error('❌ Test failed:', err);
      try { fs.unlinkSync(testCsvPath); } catch (_) {}
      server.close(() => process.exit(1));
    }
  });
}

runTest();
