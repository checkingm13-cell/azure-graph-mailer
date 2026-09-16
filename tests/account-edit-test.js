/**
 * Account Edit & Daily Limit Configuration Test
 */

const assert = require('assert');
const http = require('http');
const express = require('express');

const db = require('../src/db');
const AccountPool = require('../src/services/accountPool');
const apiRoutes = require('../src/routes/api');

console.log('--- Testing Account Edit & Daily Limit Update ---');

// 1. Insert or update test account
const testEmail = `test_edit_${Date.now()}@domain.com`;
AccountPool.upsertAccount({
  email: testEmail,
  displayName: 'Original Test Name',
  provider: 'GRAPH_API',
  dailyLimit: 500,
  cooldownSeconds: 60
});

const inserted = db.prepare('SELECT * FROM accounts WHERE email = ?').get(testEmail);
assert.ok(inserted, 'Account should have been inserted');
assert.strictEqual(inserted.daily_limit, 500, 'Expected initial daily limit to be 500');
assert.strictEqual(inserted.display_name, 'Original Test Name');
console.log(`✅ Seeded account ${inserted.id} (${testEmail}) with daily_limit=500`);

// 2. Direct unit test of AccountPool.updateAccountById
const directUpdated = AccountPool.updateAccountById(inserted.id, {
  displayName: 'Direct Updated Name',
  dailyLimit: 5000,
  cooldownSeconds: 20,
  provider: 'OCI'
});

assert.strictEqual(directUpdated.daily_limit, 5000, 'Expected daily_limit to be 5000');
assert.strictEqual(directUpdated.display_name, 'Direct Updated Name');
assert.strictEqual(directUpdated.cooldown_seconds, 20);
assert.strictEqual(directUpdated.provider, 'OCI');
console.log('✅ AccountPool.updateAccountById unit test passed (limit: 5000)');

// 3. HTTP Integration test of PUT /api/accounts/:id
const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

const server = app.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`[Test Server] Listening on port ${port}`);

  const payload = JSON.stringify({
    displayName: 'HTTP Updated Display Name',
    dailyLimit: 25000,
    cooldownSeconds: 0,
    provider: 'AZURE_ACS'
  });

  const req = http.request(
    {
      hostname: '127.0.0.1',
      port,
      path: `/api/accounts/${inserted.id}`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    },
    (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          assert.strictEqual(res.statusCode, 200, `Expected 200 OK, got ${res.statusCode}: ${body}`);
          const json = JSON.parse(body);
          assert.strictEqual(json.ok, true);
          assert.strictEqual(json.account.daily_limit, 25000, 'Expected daily_limit to be 25000');
          assert.strictEqual(json.account.display_name, 'HTTP Updated Display Name');
          assert.strictEqual(json.account.provider, 'AZURE_ACS');
          assert.strictEqual(json.account.cooldown_seconds, 0);
          console.log('✅ PUT /api/accounts/:id HTTP integration test passed (daily_limit: 25000)');

          // Clean up test account
          db.prepare('DELETE FROM accounts WHERE id = ?').run(inserted.id);

          server.close(() => {
            console.log('🎉 ALL ACCOUNT EDIT TESTS COMPLETED SUCCESSFULLY!');
            process.exit(0);
          });
        } catch (err) {
          console.error('Assertion error:', err);
          server.close(() => process.exit(1));
        }
      });
    }
  );

  req.on('error', (err) => {
    console.error('HTTP request failed:', err);
    server.close(() => process.exit(1));
  });

  req.write(payload);
  req.end();
});
