/**
 * Server Smoke Test: Starts Express app, tests /api/status, and shuts down
 */

const assert = require('assert');
const http = require('http');

const app = require('../src/app');

setTimeout(() => {
  console.log('--- Testing HTTP Server & /api/status Endpoint ---');

  http.get('http://127.0.0.1:5000/api/status', (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log('[SmokeTest] Status Response:', JSON.stringify(json, null, 2));
        assert.strictEqual(json.ok, true, 'Response ok should be true');
        assert.strictEqual(json.worker.isRunning, true, 'Worker should be running');
        assert.ok(json.pool, 'Pool metrics should exist');
        console.log('✅ SERVER SMOKE TEST PASSED 100%!');
        process.exit(0);
      } catch (err) {
        console.error('❌ Smoke test assertion failed:', err);
        process.exit(1);
      }
    });
  }).on('error', (err) => {
    console.error('❌ HTTP request failed:', err);
    process.exit(1);
  });
}, 1500);
