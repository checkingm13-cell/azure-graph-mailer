const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'mailer.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

console.log('=== SEARCH CAMPAIGN02, CAMPAIGN03, CAMPAIGN04 ===');
const list = db.prepare(`
  SELECT id, name, status, total_count, sent_count, failed_count, scheduled_at, created_at 
  FROM campaigns 
  WHERE name LIKE '%campaign02%' OR name LIKE '%campaign03%' OR name LIKE '%campaign04%'
  ORDER BY id ASC
`).all();
console.table(list);

// Check if there are other master campaigns or batches
console.log('=== ALL DISTINCT CAMPAIGN NAMES LIKE 17-9-26% ===');
const all17 = db.prepare(`
  SELECT id, name, status, total_count, sent_count, failed_count, created_at 
  FROM campaigns 
  WHERE name LIKE '%17-9-26%'
  ORDER BY id ASC
`).all();
console.table(all17);

// Check currently RUNNING or PAUSED campaigns
console.log('=== CURRENT ACTIVE/PAUSED/QUEUED CAMPAIGNS ===');
const active = db.prepare(`
  SELECT id, name, status, total_count, sent_count, failed_count, created_at 
  FROM campaigns 
  WHERE status IN ('RUNNING', 'PAUSED', 'QUEUED')
  ORDER BY id DESC
`).all();
console.table(active);
