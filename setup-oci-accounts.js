const db = require('./src/db');

const upsert = db.prepare(`
  INSERT INTO accounts (email, display_name, provider, daily_limit, cooldown_seconds, is_active)
  VALUES (?, ?, 'OCI', 10000, 0, 1)
  ON CONFLICT(email) DO UPDATE SET
    provider = 'OCI',
    display_name = excluded.display_name,
    is_active = 1
`);

const senders = [
  { email: 'research@education.researchandrise.com', name: 'Research & Rise Academic' },
  { email: 'editor@publication.onlypaperpublication.com', name: 'Paper Publication Editorial' },
  { email: 'academic@education.yourseducationmatter.com', name: 'Education Matters Journal' },
  { email: 'editorial@education.yourpaperpublication.com', name: 'Paper Publication Review Board' },
  { email: 'newsletter@education.yourpaperedition.com', name: 'Paper Edition Education Newsletter' }
];

for (const s of senders) {
  upsert.run(s.email, s.name);
  console.log(`✅ Registered in Mailer DB: ${s.email} (${s.name})`);
}

console.log('\n--- ALL ACTIVE OCI ACCOUNTS IN LOCAL DB ---');
console.table(db.prepare("SELECT id, email, display_name, provider, is_active, daily_limit FROM accounts WHERE provider = 'OCI'").all());
