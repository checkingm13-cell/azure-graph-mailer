/**
 * Database Schema Initializer & Migration Runner
 */

const schemaSql = `
-- 1. ACCOUNTS POOL: Manages multi-account senders (1 to 40+ accounts)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'GRAPH_API', -- 'GRAPH_API', 'AZURE_ACS', or 'OCI'
    daily_limit INTEGER NOT NULL DEFAULT 500,
    sent_today INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT,
    cooldown_seconds INTEGER NOT NULL DEFAULT 0,
    cooldown_until TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 2. CONTACTS: Master deduplicated recipient list
CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT DEFAULT '',
    paper_title TEXT DEFAULT '',
    affiliation TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'UNSUBSCRIBED', 'BOUNCED'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 3. TEMPLATES: Dynamic email templates with merge tags
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 4. CAMPAIGNS: Grouping of target audience & template
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    template_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'QUEUED', -- 'DRAFT', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED'
    total_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    scheduled_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE
);

-- 5. QUEUE: Active pipeline worker table
CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    contact_id INTEGER,
    account_id INTEGER,
    email TEXT NOT NULL,
    name TEXT DEFAULT '',
    subject TEXT NOT NULL,
    rendered_html TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'sending', 'sent', 'failed'
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT DEFAULT '',
    sent_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- 6. LOGS: Complete audit trail
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    account_id INTEGER,
    level TEXT NOT NULL DEFAULT 'INFO', -- 'INFO', 'WARN', 'ERROR'
    message TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 7. SETTINGS: Dynamic runtime key-value configuration
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_queue_status_id ON queue(status, id);
CREATE INDEX IF NOT EXISTS idx_queue_sent_at ON queue(status, sent_at);
CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active, sent_today, last_sent_at);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
`;

function initSchema(db) {
  db.exec(schemaSql);

  // Safe additive migrations for scheduling
  try {
    const campaignCols = db.prepare("PRAGMA table_info(campaigns)").all().map(c => c.name);
    if (!campaignCols.includes('sender_account_id')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN sender_account_id INTEGER REFERENCES accounts(id)");
    }
    if (!campaignCols.includes('scheduled_at')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN scheduled_at TEXT");
    }
    if (!campaignCols.includes('started_at')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN started_at TEXT");
    }
    if (!campaignCols.includes('completed_at')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN completed_at TEXT");
    }

    const queueCols = db.prepare("PRAGMA table_info(queue)").all().map(c => c.name);
    if (!queueCols.includes('scheduled_at')) {
      db.exec("ALTER TABLE queue ADD COLUMN scheduled_at TEXT");
    }

    const accountCols = db.prepare("PRAGMA table_info(accounts)").all().map(c => c.name);
    if (!accountCols.includes('cooldown_until')) {
      db.exec("ALTER TABLE accounts ADD COLUMN cooldown_until TEXT");
    }
    if (!accountCols.includes('status')) {
      db.exec("ALTER TABLE accounts ADD COLUMN status TEXT DEFAULT 'ACTIVE'");
    }
    if (!accountCols.includes('health_score')) {
      db.exec("ALTER TABLE accounts ADD COLUMN health_score INTEGER DEFAULT 100");
    }
    if (!accountCols.includes('sending_speed')) {
      db.exec("ALTER TABLE accounts ADD COLUMN sending_speed TEXT DEFAULT 'BALANCED'");
    }
    if (!accountCols.includes('custom_interval_ms')) {
      db.exec("ALTER TABLE accounts ADD COLUMN custom_interval_ms INTEGER DEFAULT 2500");
    }
    if (!accountCols.includes('failure_count')) {
      db.exec("ALTER TABLE accounts ADD COLUMN failure_count INTEGER DEFAULT 0");
    }
    if (!accountCols.includes('bounce_count')) {
      db.exec("ALTER TABLE accounts ADD COLUMN bounce_count INTEGER DEFAULT 0");
    }
    if (!accountCols.includes('complaint_count')) {
      db.exec("ALTER TABLE accounts ADD COLUMN complaint_count INTEGER DEFAULT 0");
    }

    if (!campaignCols.includes('mode')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN mode TEXT DEFAULT 'SMART'");
    }
    if (!campaignCols.includes('pinned_account_id')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN pinned_account_id INTEGER REFERENCES accounts(id)");
    }
    if (!campaignCols.includes('fallback_allowed')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN fallback_allowed INTEGER DEFAULT 1");
    }
    if (!campaignCols.includes('sending_speed')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN sending_speed TEXT DEFAULT 'BALANCED'");
    }
    if (!campaignCols.includes('custom_interval_ms')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN custom_interval_ms INTEGER DEFAULT 2500");
    }

    if (!queueCols.includes('provider_message_id')) {
      db.exec("ALTER TABLE queue ADD COLUMN provider_message_id TEXT");
    }
    if (!queueCols.includes('accepted_at')) {
      db.exec("ALTER TABLE queue ADD COLUMN accepted_at TEXT");
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_queue_schedule ON queue(status, scheduled_at, id);");
  } catch (err) {
    console.warn('[Schema] Migration notice:', err.message);
  }
}

module.exports = { initSchema };
