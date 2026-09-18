const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'mailer.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('=== CAMPAIGNS MATCHING "17-9-26-campaign" ===');
const matched = db.prepare(`
  SELECT id, name, status, total_count, sent_count, failed_count, scheduled_at, created_at 
  FROM campaigns 
  WHERE name LIKE '%17-9-26-campaign%' OR name LIKE '%campaign02%' OR name LIKE '%campaign03%' OR name LIKE '%campaign04%'
  ORDER BY id DESC
`).all();
console.table(matched);

for (const c of matched) {
  console.log(`\n========================================`);
  console.log(`Campaign ID: ${c.id}, Name: ${c.name}, Status: ${c.status}`);
  const qStats = db.prepare(`
    SELECT status, count(*) as count 
    FROM queue 
    WHERE campaign_id = ? 
    GROUP BY status
  `).all(c.id);
  console.log('Queue status counts:', qStats);

  const sampleRows = db.prepare(`
    SELECT id, email, status, account_id, attempts, last_error, sent_at, created_at 
    FROM queue 
    WHERE campaign_id = ? 
    LIMIT 3
  `).all(c.id);
  console.log('Sample queue rows:', sampleRows);

  const logs = db.prepare(`
    SELECT level, message, timestamp 
    FROM logs 
    WHERE campaign_id = ? 
    ORDER BY id DESC 
    LIMIT 5
  `).all(c.id);
  console.log('Recent logs for campaign:', logs);
}
