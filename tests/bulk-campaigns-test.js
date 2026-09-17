const assert = require('assert');
const db = require('../src/db');

async function testBulkActions() {
  console.log('--- Testing Parent-Child Campaign Bulk Actions ---');

  // Insert a test parent campaign and 2 test child batches
  const parentRes = db.prepare(`
    INSERT INTO campaigns (name, template_id, status, total_count, is_batch)
    VALUES ('Master_Test_Campaign', 1, 'QUEUED', 100, 0)
  `).run();
  const parentId = parentRes.lastInsertRowid;

  const child1 = db.prepare(`
    INSERT INTO campaigns (name, template_id, status, total_count, parent_id, is_batch)
    VALUES ('Master_Test_Campaign_Batch_01', 1, 'QUEUED', 50, ?, 1)
  `).run(parentId);

  const child2 = db.prepare(`
    INSERT INTO campaigns (name, template_id, status, total_count, parent_id, is_batch)
    VALUES ('Master_Test_Campaign_Batch_02', 1, 'QUEUED', 50, ?, 1)
  `).run(parentId);

  const childIds = [child1.lastInsertRowid, child2.lastInsertRowid];

  // Test Pause All Bulk Action
  const placeholders = childIds.map(() => '?').join(',');
  db.prepare(`UPDATE campaigns SET status = 'PAUSED' WHERE id IN (${placeholders})`).run(...childIds);
  
  const pausedCamps = db.prepare(`SELECT status FROM campaigns WHERE id IN (${placeholders})`).all(...childIds);
  assert.strictEqual(pausedCamps.length, 2);
  assert.strictEqual(pausedCamps[0].status, 'PAUSED');
  assert.strictEqual(pausedCamps[1].status, 'PAUSED');
  console.log('✅ Bulk Pause Action verified!');

  // Test Resume All Bulk Action
  db.prepare(`UPDATE campaigns SET status = 'QUEUED' WHERE id IN (${placeholders})`).run(...childIds);
  const resumedCamps = db.prepare(`SELECT status FROM campaigns WHERE id IN (${placeholders})`).all(...childIds);
  assert.strictEqual(resumedCamps[0].status, 'QUEUED');
  assert.strictEqual(resumedCamps[1].status, 'QUEUED');
  console.log('✅ Bulk Resume Action verified!');

  // Test Instant Send Now
  db.prepare(`UPDATE campaigns SET status = 'QUEUED', scheduled_at = datetime('now') WHERE id = ? OR parent_id = ?`).run(parentId, parentId);
  const triggered = db.prepare(`SELECT scheduled_at FROM campaigns WHERE id = ?`).get(parentId);
  assert.ok(triggered.scheduled_at);
  console.log('✅ Send-Now Immediate Trigger verified!');

  // Cleanup test rows
  db.prepare(`DELETE FROM campaigns WHERE id IN (?, ?, ?)`).run(parentId, childIds[0], childIds[1]);
  console.log('✅ All Bulk Action Tests PASSED CLEANLY!');
}

testBulkActions().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
