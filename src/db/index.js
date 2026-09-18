const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');
const { initSchema } = require('./schema');

// On Azure App Service Linux, /home is a FUSE network mount (tuxfusedrive).
// SQLite WAL mode requires POSIX shared-memory locks that FUSE doesn't support,
// causing SQLITE_IOERR_SHMMAP → "database disk image is malformed".
// Fix: work on /tmp (local ext4), sync back to /home for persistence.

// ponytail: detect Azure by env var, not by dbPath prefix — bulletproof
const isAzure = process.platform === 'linux' && !!process.env.WEBSITE_INSTANCE_ID;

// Resolve dbPath to absolute (handles relative DB_PATH like 'data/mailer.db')
const resolvedDbPath = path.isAbsolute(config.dbPath)
  ? config.dbPath
  : path.resolve('/home/site/wwwroot', config.dbPath);

const persistPath = isAzure ? resolvedDbPath : config.dbPath;
const workPath = isAzure ? '/tmp/mailer.db' : config.dbPath;

// Ensure parent dirs exist
for (const p of [persistPath, workPath]) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Boot: copy persistent → working copy (if available and working copy missing/stale)
if (isAzure && fs.existsSync(persistPath) && !fs.existsSync(workPath)) {
  console.log(`[DB] Azure — copying ${persistPath} → ${workPath}`);
  fs.copyFileSync(persistPath, workPath);
  fs.chmodSync(workPath, 0o666); // FUSE copies inherit readonly perms
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(persistPath + ext)) {
      fs.copyFileSync(persistPath + ext, workPath + ext);
      fs.chmodSync(workPath + ext, 0o666);
    }
  }
} else if (isAzure) {
  console.log(`[DB] Azure — fresh DB at ${workPath}`);
}

console.log(`[DB] Initializing SQLite at: ${workPath} (azure=${isAzure})`);
const db = new DatabaseSync(workPath);

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

// Periodic sync: checkpoint WAL then copy working → persistent
// ponytail: 60s interval is good enough; on container restart data loss is ≤60s of queue state
function syncToPersist() {
  if (!isAzure) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(workPath, persistPath);
    console.log(`[DB] Synced ${workPath} → ${persistPath}`);
  } catch (err) {
    console.error('[DB] Sync to persistent storage failed:', err.message);
  }
}

let syncTimer = null;
if (isAzure) {
  syncTimer = setInterval(syncToPersist, 60_000);
  syncTimer.unref(); // don't block process exit
  console.log('[DB] Azure persistence sync enabled (every 60s)');
}

// Expose sync for graceful shutdown
db._syncAndClose = function () {
  if (syncTimer) clearInterval(syncTimer);
  syncToPersist();
  db.close();
};

module.exports = db;
