const db = require('./src/db');

const upsert = db.prepare(`
  INSERT INTO accounts (email, display_name, provider, daily_limit, cooldown_seconds, is_active)
  VALUES (?, ?, 'AZURE_ACS', 500, 60, 1)
  ON CONFLICT(email) DO UPDATE SET
    provider = 'AZURE_ACS',
    display_name = excluded.display_name,
    is_active = 1
`);

upsert.run('DoNotReply@mail.theparipexjournal.com', 'Worldwide Journals - DoNotReply');
upsert.run('Rishank@mail.theparipexjournal.com', 'Worldwide Journals - Rishank');

console.log('✅ Registered ACS Accounts in Local DB:');
console.log(db.prepare('SELECT id, email, provider, is_active, daily_limit FROM accounts').all());
