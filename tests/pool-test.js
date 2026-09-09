/**
 * Multi-Account Rotation & Cooldown Algorithm Test
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = path.resolve(__dirname, '../data/test_pool.db');

const db = require('../src/db');
const AccountPool = require('../src/services/accountPool');

console.log('--- Testing Multi-Account Rotation & Cooldown Algorithm ---');

// 1. Clean test DB
db.exec("DELETE FROM accounts; DELETE FROM queue; DELETE FROM campaigns; DELETE FROM templates;");

db.prepare("INSERT INTO templates (id, name, subject, body_html) VALUES (1, 't', 's', 'b')").run();
db.prepare("INSERT INTO campaigns (id, name, template_id) VALUES (1, 'Camp', 1)").run();

// 2. Seed 3 sender accounts with specific cooldowns and limits
AccountPool.upsertAccount({
  email: 'sender1@paripex.com',
  displayName: 'Sender One',
  dailyLimit: 10,
  cooldownSeconds: 5
});

AccountPool.upsertAccount({
  email: 'sender2@paripex.com',
  displayName: 'Sender Two',
  dailyLimit: 10,
  cooldownSeconds: 5
});

AccountPool.upsertAccount({
  email: 'sender3@paripex.com',
  displayName: 'Sender Three',
  dailyLimit: 1, // Will exhaust after 1 send!
  cooldownSeconds: 5
});

// 3. Round 1: Fetch first available account
const firstAcc = AccountPool.getAvailableAccount();
assert.ok(firstAcc, 'Should have selected an available account');
console.log(`[Test] Leased Account 1: ${firstAcc.email}`);

// Record send on first account (enters 5s cooldown)
db.prepare("INSERT INTO queue (campaign_id, email, subject, rendered_html, account_id, status, sent_at) VALUES (1, 't1@t.com', 's', 'b', ?, 'sent', datetime('now'))").run(firstAcc.id);
AccountPool.recordSendSuccess(firstAcc.id);

// 4. Round 2: Fetch next available account (first account must be skipped due to cooldown)
const secondAcc = AccountPool.getAvailableAccount();
assert.ok(secondAcc, 'Should have selected a second account');
assert.notStrictEqual(secondAcc.id, firstAcc.id, 'Account 1 should have been in cooldown!');
console.log(`[Test] Leased Account 2: ${secondAcc.email}`);

// Record send on second account
db.prepare("INSERT INTO queue (campaign_id, email, subject, rendered_html, account_id, status, sent_at) VALUES (1, 't2@t.com', 's', 'b', ?, 'sent', datetime('now'))").run(secondAcc.id);
AccountPool.recordSendSuccess(secondAcc.id);

// 5. Round 3: Next must be Account 3
const thirdAcc = AccountPool.getAvailableAccount();
assert.ok(thirdAcc, 'Should have selected a third account');
assert.strictEqual(thirdAcc.email, 'sender3@paripex.com', 'Third account should be sender3');
console.log(`[Test] Leased Account 3: ${thirdAcc.email}`);

// Record send on third account (hits limit: 1/1)
db.prepare("INSERT INTO queue (campaign_id, email, subject, rendered_html, account_id, status, sent_at) VALUES (1, 't3@t.com', 's', 'b', ?, 'sent', datetime('now'))").run(thirdAcc.id);
AccountPool.recordSendSuccess(thirdAcc.id);

// 6. Verify Account 3 quota exhaustion
const acc3Check = db.prepare("SELECT * FROM accounts WHERE email = 'sender3@paripex.com'").get();
assert.strictEqual(acc3Check.sent_today, 1, 'Account 3 should have 1 sent today');
assert.strictEqual(acc3Check.sent_today >= acc3Check.daily_limit, true, 'Account 3 quota should be exhausted');

// 7. Verify Pool Metrics
const metrics = AccountPool.getPoolMetrics();
assert.strictEqual(metrics.total_accounts, 3, 'Total accounts should be 3');
assert.strictEqual(metrics.total_sent_today, 3, 'Total sent today should be 3');

console.log('✅ ALL MULTI-ACCOUNT ROTATION & COOLDOWN TESTS PASSED CLEANLY!');

// Clean up
try {
  fs.unlinkSync(process.env.DB_PATH);
} catch (_) {}
