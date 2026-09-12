const db = require('./src/db');

const upsert = db.prepare(`
  INSERT INTO accounts (email, display_name, provider, daily_limit, cooldown_seconds, is_active)
  VALUES (?, ?, 'OCI', 10000, 0, 1)
  ON CONFLICT(email) DO UPDATE SET
    provider = 'OCI',
    display_name = excluded.display_name,
    is_active = 1
`);

upsert.run('newsletter@education.yourpaperedition.com', 'Paper Edition Education Newsletter');

console.log('✅ Registered OCI Accounts in Local DB:');
console.log(db.prepare("SELECT id, email, provider, is_active, daily_limit FROM accounts WHERE provider = 'OCI'").all());
