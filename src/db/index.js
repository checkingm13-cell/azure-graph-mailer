const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');
const { initSchema } = require('./schema');

// Resolve dbPath to absolute
const resolvedDbPath = path.isAbsolute(config.dbPath)
  ? config.dbPath
  : path.resolve(process.cwd(), config.dbPath);

const dbDir = path.dirname(resolvedDbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

console.log(`[DB] Initializing SQLite at: ${resolvedDbPath}`);
const db = new DatabaseSync(resolvedDbPath);

// Enable WAL mode for high concurrency and crash resilience
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

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

// Expose clean checkpoint & close for graceful shutdown
db._syncAndClose = function () {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {}
  db.close();
};

module.exports = db;
