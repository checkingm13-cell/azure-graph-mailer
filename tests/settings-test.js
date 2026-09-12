const db = require('../src/db');
const queueWorker = require('../src/services/queueWorker');
const assert = require('assert');

// 1. Set to 6500ms (safe rate for 10/min OCI limit)
db.prepare(`
  INSERT INTO settings (key, value) VALUES ('send_interval_ms', '6500')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run();

let status = queueWorker.getStatus();
assert.strictEqual(status.sendIntervalMs, 6500, 'Expected sendIntervalMs to be 6500');

// 2. Set to 500ms
db.prepare(`
  INSERT INTO settings (key, value) VALUES ('send_interval_ms', '500')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run();

status = queueWorker.getStatus();
assert.strictEqual(status.sendIntervalMs, 500, 'Expected sendIntervalMs to be 500');

// Set back to 6500ms as safe default for OCI 10/min
db.prepare(`
  INSERT INTO settings (key, value) VALUES ('send_interval_ms', '6500')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run();

console.log('✅ PASS: Dynamic settings read/write verified. Active interval:', queueWorker.getStatus().sendIntervalMs, 'ms');
process.exit(0);
