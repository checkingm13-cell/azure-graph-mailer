const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'mailer.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('=== CAMPAIGNS (Recent 20) ===');
const campaigns = db.prepare(`
  SELECT id, name, status, total_count, sent_count, failed_count, scheduled_at, created_at 
  FROM campaigns 
  ORDER BY id DESC 
  LIMIT 20
`).all();
console.table(campaigns);

console.log('\n=== RECENT CAMPAIGNS QUEUE STATS ===');
for (const c of campaigns.slice(0, 8)) {
  console.log(`\n--- Campaign #${c.id}: ${c.name} | Status: ${c.status} | Total: ${c.total_count} | Sent: ${c.sent_count} | Failed: ${c.failed_count} ---`);
  
  try {
    const queueStats = db.prepare(`
      SELECT status, count(*) as count 
      FROM queue 
      WHERE campaign_id = ? 
      GROUP BY status
    `).all(c.id);
    console.log('Queue stats:', queueStats);

    const sampleErrors = db.prepare(`
      SELECT id, email, status, attempts, last_error, account_id, sent_at, created_at 
      FROM queue 
      WHERE campaign_id = ? AND (last_error IS NOT NULL AND last_error != '')
      ORDER BY id DESC 
      LIMIT 3
    `).all(c.id);
    if (sampleErrors.length > 0) {
      console.log('Sample errors:', sampleErrors);
    }

    const firstLastRows = db.prepare(`
      SELECT id, email, status, account_id, attempts, last_error, sent_at, created_at 
      FROM queue 
      WHERE campaign_id = ? 
      ORDER BY id ASC 
      LIMIT 3
    `).all(c.id);
    console.log('First 3 rows in queue:', firstLastRows);
  } catch (e) {
    console.log('Error querying queue:', e.message);
  }
}

console.log('\n=== ACCOUNTS STATUS & LOAD ===');
try {
  const accounts = db.prepare(`
    SELECT id, email, provider, daily_limit, sent_today, cooldown_seconds, cooldown_until, is_active, last_sent_at 
    FROM accounts
    ORDER BY id ASC
  `).all();
  console.table(accounts);
} catch (e) {
  console.log('Accounts query err:', e.message);
}

console.log('\n=== RECENT LOGS (Top 25) ===');
try {
  const logs = db.prepare(`
    SELECT id, campaign_id, account_id, level, message, timestamp 
    FROM logs 
    ORDER BY id DESC 
    LIMIT 25
  `).all();
  console.table(logs);
} catch (e) {
  console.log('Logs query err:', e.message);
}

console.log('\n=== SETTINGS ===');
try {
  const settings = db.prepare(`SELECT * FROM settings`).all();
  console.table(settings);
} catch (e) {
  console.log('Settings err:', e.message);
}
