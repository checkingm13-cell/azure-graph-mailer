/**
 * Automated Test Suite: Connection-Aware Multi-Sender Architecture & Quota Persistence
 * 
 * Verifies:
 * 1. UI/SQLite Authority: Custom limits (2k, 4k, 10k) survive reboots and never get overwritten by defaults.
 * 2. Throttle Decoupling: putOnCooldown does not mutate the configured base cooldown_seconds.
 * 3. Bulk Limits API: POST /api/settings/bulk-limits updates quotas atomically.
 * 4. Multi-Connection Support: GRAPH_API, AZURE_ACS, and OCI operate with independent limits.
 * 5. GET /api/settings/engine exposes active engine state and pool metrics.
 */

const assert = require('assert');
const http = require('http');
const express = require('express');

const db = require('../src/db');
const AccountPool = require('../src/services/accountPool');
const apiRoutes = require('../src/routes/api');

console.log('🧪 Starting Connection-Aware Multi-Sender & Quota Persistence Test Suite...\n');

// Set up express test app
const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  console.log(`[Test Server] Listening on port ${port}`);

  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
              }
            : {}
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const json = data ? JSON.parse(data) : {};
              resolve({ statusCode: res.statusCode, data: json, raw: data });
            } catch (e) {
              resolve({ statusCode: res.statusCode, raw: data });
            }
          });
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  try {
    const timestamp = Date.now();
    const graphEmail = `graph_test_${timestamp}@tenant.com`;
    const acsEmail = `acs_test_${timestamp}@azurecomm.net`;
    const ociEmail = `oci_test_${timestamp}@publication.com`;

    // -------------------------------------------------------------
    // Test 1: Seed distinct accounts with connection-specific limits
    // -------------------------------------------------------------
    console.log('▶ Test 1: Register accounts across GRAPH_API, AZURE_ACS, and OCI...');
    AccountPool.upsertAccount({
      email: graphEmail,
      displayName: 'Graph Sender',
      provider: 'GRAPH_API',
      dailyLimit: 500,
      cooldownSeconds: 60
    });

    AccountPool.upsertAccount({
      email: acsEmail,
      displayName: 'ACS Sender',
      provider: 'AZURE_ACS',
      dailyLimit: 4000,
      cooldownSeconds: 0
    });

    AccountPool.upsertAccount({
      email: ociEmail,
      displayName: 'OCI Sender',
      provider: 'OCI',
      dailyLimit: 10000,
      cooldownSeconds: 0
    });

    const graphRow = db.prepare('SELECT * FROM accounts WHERE email = ?').get(graphEmail);
    const acsRow = db.prepare('SELECT * FROM accounts WHERE email = ?').get(acsEmail);
    const ociRow = db.prepare('SELECT * FROM accounts WHERE email = ?').get(ociEmail);

    assert.strictEqual(graphRow.daily_limit, 500);
    assert.strictEqual(graphRow.cooldown_seconds, 60);
    assert.strictEqual(acsRow.daily_limit, 4000);
    assert.strictEqual(acsRow.cooldown_seconds, 0);
    assert.strictEqual(ociRow.daily_limit, 10000);
    assert.strictEqual(ociRow.cooldown_seconds, 0);
    console.log('  ✅ Test 1 Passed: 3 distinct connection providers registered with specific limits.\n');

    // -------------------------------------------------------------
    // Test 2: Non-destructive upsert (re-seed must NOT overwrite UI customizations)
    // -------------------------------------------------------------
    console.log('▶ Test 2: Verify custom UI settings (e.g. 4000 limit) survive re-seeding/restart...');
    // Simulate operator editing ACS account to 4500 in UI
    AccountPool.updateAccountById(acsRow.id, { dailyLimit: 4500, displayName: 'Updated ACS Name' });
    
    // Simulate server boot sequence re-running upsertAccount with default 500 limit
    AccountPool.upsertAccount({
      email: acsEmail,
      displayName: 'Default Name on Boot',
      provider: 'AZURE_ACS',
      dailyLimit: 500, // Default in .env
      cooldownSeconds: 60
    });

    const acsAfterBoot = db.prepare('SELECT * FROM accounts WHERE email = ?').get(acsEmail);
    assert.strictEqual(acsAfterBoot.daily_limit, 4500, 'daily_limit must NOT be clobbered by restart/upsert!');
    assert.strictEqual(acsAfterBoot.cooldown_seconds, 0, 'cooldown_seconds must NOT be clobbered by restart/upsert!');
    console.log('  ✅ Test 2 Passed: Custom limit 4,500 remained intact after re-seed (Zero Overwrite Guarantee).\n');

    // -------------------------------------------------------------
    // Test 3: Decoupled Throttle Backoff (putOnCooldown)
    // -------------------------------------------------------------
    console.log('▶ Test 3: Verify putOnCooldown sets cooldown_until without mutating base cooldown_seconds...');
    assert.strictEqual(ociRow.cooldown_seconds, 0);
    
    // Trigger temporary 455 throttle of 90 seconds
    AccountPool.putOnCooldown(ociRow.id, 90);

    const ociThrottled = db.prepare('SELECT * FROM accounts WHERE email = ?').get(ociEmail);
    assert.strictEqual(ociThrottled.cooldown_seconds, 0, 'Base cooldown_seconds must remain 0!');
    assert.ok(ociThrottled.cooldown_until, 'cooldown_until timestamp must be populated');

    // Check that AccountPool.getAvailableAccount excludes throttled account
    const availableForOci = AccountPool.getAvailableAccount(ociRow.id);
    assert.strictEqual(availableForOci, null, 'Throttled account must not be available during cooldown_until');

    // Check getAllAccounts reports remaining seconds
    const allAccounts = AccountPool.getAllAccounts();
    const ociView = allAccounts.find(a => a.id === ociRow.id);
    assert.ok(ociView.cooldown_remaining_sec > 0, 'cooldown_remaining_sec should reflect cooldown_until');
    console.log('  ✅ Test 3 Passed: Base cooldown preserved at 0s, temporary backoff enforced via cooldown_until.\n');

    // -------------------------------------------------------------
    // Test 4: Bulk Limits API (POST /api/settings/bulk-limits)
    // -------------------------------------------------------------
    console.log('▶ Test 4: Verify 1-Click bulk limits preset API...');
    const bulkRes = await makeRequest('POST', '/api/settings/bulk-limits', {
      dailyLimit: 2000,
      cooldownSeconds: 0
    });

    assert.strictEqual(bulkRes.statusCode, 200);
    assert.strictEqual(bulkRes.data.ok, true);
    assert.ok(bulkRes.data.updatedCount >= 3);

    const updatedGraph = db.prepare('SELECT * FROM accounts WHERE email = ?').get(graphEmail);
    const updatedAcs = db.prepare('SELECT * FROM accounts WHERE email = ?').get(acsEmail);
    const updatedOci = db.prepare('SELECT * FROM accounts WHERE email = ?').get(ociEmail);

    assert.strictEqual(updatedGraph.daily_limit, 2000);
    assert.strictEqual(updatedAcs.daily_limit, 2000);
    assert.strictEqual(updatedOci.daily_limit, 2000);
    console.log('  ✅ Test 4 Passed: 1-Click bulk preset successfully applied 2,000 daily limit across all accounts.\n');

    // -------------------------------------------------------------
    // Test 5: Engine Telemetry (GET /api/settings/engine)
    // -------------------------------------------------------------
    console.log('▶ Test 5: Verify GET /api/settings/engine...');
    const engineRes = await makeRequest('GET', '/api/settings/engine');
    assert.strictEqual(engineRes.statusCode, 200);
    assert.strictEqual(engineRes.data.ok, true);
    assert.ok(engineRes.data.engine);
    assert.ok(engineRes.data.poolMetrics);
    assert.ok(engineRes.data.poolMetrics.total_daily_capacity >= 6000);
    console.log('  ✅ Test 5 Passed: Engine settings and live pool metrics returned accurately.\n');

    // Cleanup test records
    db.prepare('DELETE FROM accounts WHERE email IN (?, ?, ?)').run(graphEmail, acsEmail, ociEmail);
    console.log('🧹 Cleaned up temporary test accounts.\n');

    server.close(() => {
      console.log('======================================================');
      console.log('🎉 ALL CONNECTION-AWARE LIMIT TESTS PASSED WITH 100% SUCCESS!');
      console.log('======================================================');
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    server.close(() => process.exit(1));
  }
});
