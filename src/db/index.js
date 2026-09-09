const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');
const { initSchema } = require('./schema');

// Ensure parent directory for database exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[DB] Initializing Node.js native SQLite database at: ${config.dbPath}`);
const db = new DatabaseSync(config.dbPath);

// Enable WAL mode for high concurrency and crash resilience
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Attach clean transaction wrapper matching better-sqlite3 signature
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN TRANSACTION');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
};

// Initialize tables and indexes
initSchema(db);

console.log('[DB] Database schema and indexes verified successfully.');

module.exports = db;
