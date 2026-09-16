/**
 * Test for Features Imported from Extension:
 * 1. Dynamic Domain Link Resolver (senderDomain, relative href rewriting)
 * 2. 1-Click Retry All Failed Queue Action
 * 3. 1-Click Clear Completed Queue Action
 * 4. GET /api/queue endpoint
 */

const assert = require('assert');
const http = require('http');
const express = require('express');

const db = require('../src/db');
const { renderTemplate } = require('../src/services/templateEngine');
const apiRoutes = require('../src/routes/api');

console.log('--- Testing Features Ported from Chrome Extension ---');

// 1. UNIT TEST: Dynamic Domain Link Resolver in templateEngine
const rawTemplate = `
  <p>Dear Dr. {{Name}},</p>
  <p>Submit your article to: <a href="/submit-paper">Submit Online</a></p>
  <p>Learn more at: {{senderDomain}}</p>
  <p>Contact: {{senderEmail}}</p>
`;

const rendered = renderTemplate(rawTemplate, {
  name: 'Albert Einstein',
  email: 'einstein@princeton.edu',
  sender_email: 'editor@theparipexjournal.com'
});

assert.ok(rendered.includes('https://theparipexjournal.com/submit-paper'), 'Relative href should be rewritten to sender domain');
assert.ok(rendered.includes('Learn more at: theparipexjournal.com'), '{{senderDomain}} should be replaced');
assert.ok(rendered.includes('Contact: editor@theparipexjournal.com'), '{{senderEmail}} should be replaced');
console.log('✅ Feature 1: Dynamic Domain Link Resolver passed 100%');

// 2. HTTP INTEGRATION TEST: Retry Failed, Clear Completed, and GET /api/queue
const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

// Seed a dummy campaign and queue items
const testCamp = db.prepare("INSERT INTO campaigns (name, template_id, status) VALUES ('Test Ext Features', 1, 'FAILED')").run();
const campId = testCamp.lastInsertRowid;

const qFailed = db.prepare(`
  INSERT INTO queue (campaign_id, email, name, subject, rendered_html, status, attempts, last_error)
  VALUES (?, 'failed.test@domain.com', 'Failed User', 'Subject', 'Html', 'failed', 3, 'Network Timeout')
`).run(campId);

const qSent = db.prepare(`
  INSERT INTO queue (campaign_id, email, name, subject, rendered_html, status, attempts)
  VALUES (?, 'sent.test@domain.com', 'Sent User', 'Subject', 'Html', 'sent', 1)
`).run(campId);

const server = app.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  console.log(`[Test Server] Listening on port ${port}`);

  async function postJson(urlPath, body = {}) {
    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: urlPath,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
        },
        (res) => {
          let data = '';
          res.on('data', (c) => data += c);
          res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async function getJson(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      }).on('error', reject);
    });
  }

  try {
    // Test GET /api/queue
    const getRes = await getJson('/api/queue?limit=10');
    assert.strictEqual(getRes.status, 200);
    assert.ok(Array.isArray(getRes.data.items), 'Should return queue items array');
    console.log('✅ GET /api/queue returned live items');

    // Test POST /api/queue/retry-failed
    const retryRes = await postJson('/api/queue/retry-failed', { campaignId: campId });
    assert.strictEqual(retryRes.status, 200);
    assert.strictEqual(retryRes.data.ok, true);

    const recheckItem = db.prepare('SELECT status, attempts, last_error FROM queue WHERE id = ?').get(qFailed.lastInsertRowid);
    assert.strictEqual(recheckItem.status, 'queued', 'Failed item should be reset to queued');
    assert.strictEqual(recheckItem.attempts, 0, 'Attempts should be reset to 0');
    assert.strictEqual(recheckItem.last_error, '', 'Last error should be cleared');
    console.log('✅ Feature 2: 1-Click Retry Failed passed 100%');

    // Test POST /api/queue/clear-completed
    const clearRes = await postJson('/api/queue/clear-completed');
    assert.strictEqual(clearRes.status, 200);
    assert.strictEqual(clearRes.data.ok, true);

    const recheckSent = db.prepare('SELECT id FROM queue WHERE id = ?').get(qSent.lastInsertRowid);
    assert.strictEqual(recheckSent, undefined, 'Sent item should have been removed from queue');
    console.log('✅ Feature 3: 1-Click Clear Completed passed 100%');

    // Cleanup
    db.prepare('DELETE FROM queue WHERE campaign_id = ?').run(campId);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(campId);

    server.close(() => {
      console.log('🎉 ALL 3 EXTENSION FEATURES PASSED TESTS SUCCESSFULLY!');
      process.exit(0);
    });
  } catch (err) {
    console.error('Test failed:', err);
    server.close(() => process.exit(1));
  }
});
