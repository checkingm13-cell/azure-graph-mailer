/**
 * Mailgun Account Registration Helper
 * Run: node setup-mailgun-accounts.js
 */

const db = require('./src/db');
const config = require('./src/config/env');

const upsert = db.prepare(`
  INSERT INTO accounts (email, display_name, provider, daily_limit, cooldown_seconds, is_active)
  VALUES (?, ?, 'MAILGUN', 10000, 0, 1)
  ON CONFLICT(email) DO UPDATE SET
    provider = 'MAILGUN',
    display_name = excluded.display_name,
    is_active = 1
`);

const domain = config.mailgunDomain || 'your-mailgun-domain.com';

// Add sender addresses under your Mailgun domain
const senders = [
  { email: config.mailgunSenderEmail || `newsletter@${domain}`, name: 'Paper Publication Mailgun' }
];

console.log('Registering Mailgun Sender Accounts in SQLite Database...\n');

for (const s of senders) {
  upsert.run(s.email, s.name);
  console.log(`✅ Registered in Mailer DB: ${s.email} (${s.name}) [MAILGUN]`);
}

console.log('\n--- ALL ACTIVE MAILGUN ACCOUNTS IN LOCAL DB ---');
console.table(db.prepare("SELECT id, email, display_name, provider, is_active, daily_limit FROM accounts WHERE provider = 'MAILGUN'").all());
