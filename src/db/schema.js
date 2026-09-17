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
    if (!accountCols.includes('quota_reset_at')) {
      db.exec("ALTER TABLE accounts ADD COLUMN quota_reset_at TEXT");
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
    if (!queueCols.includes('template_id')) {
      db.exec("ALTER TABLE queue ADD COLUMN template_id INTEGER REFERENCES templates(id)");
    }

    if (!campaignCols.includes('parent_id')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN parent_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE");
    }
    if (!campaignCols.includes('is_batch')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN is_batch INTEGER DEFAULT 0");
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_campaigns_parent ON campaigns(parent_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_queue_schedule ON queue(status, scheduled_at, id);");

    // Seed/Upsert standard journal templates
    seedJournalTemplates(db);
  } catch (err) {
    console.warn('[Schema] Migration notice:', err.message);
  }
}

function seedJournalTemplates(db) {
  const templates = [
    {
      name: 'International Journal of Scientific Research (IJSR) - October Issue',
      subject: 'International Journal of Scientific Research (IJSR) - Call For Papers October Issue',
      body_html: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
</head>
<body>

<span style="font-size:22px;">
<span style="font-family:Verdana,Geneva,sans-serif;">

Dear [FNAME]<br>
<br>

<span style="line-height:115%">
International Journal of Scientific Research
</span><br>
<br>

<span style="line-height:115%">
Peer Reviewed Journal Accepted by UGC &amp; NMC
</span><br>
<br>

<span style="line-height:115%">
Journal ISSN 2277-8179
</span><br>
<br>

<span style="line-height:115%">
PubMed Index Journal
</span><br>
<br>

<span style="line-height:115%">
Are you working on a research study or have a completed manuscript ready for publication?
</span><br>
<br>

<span style="line-height:115%">
IJSR welcomes original academic and scientific research that can add meaningful value to the research community.
</span><br>
<br>

<span style="line-height:115%">
You may submit your manuscript for consideration in the upcoming October issue.
</span><br>
<br>

<span style="line-height:115%">
<a href="/international-journal-of-scientific-research-(IJSR)/page/p/upload-your-article"
style="color:#0563c1; text-decoration:underline;">
<b>Send Your Research for the October Issue</b>
</a>
</span><br>
<br>

<span style="line-height:115%">
We look forward to receiving your scholarly contribution.
</span><br>
<br>

<span style="line-height:115%">
<a href="/international-journal-of-scientific-research-(IJSR)/page/p/OptOut"
style="color:#0563c1; text-decoration:underline;">
To Opt Out
</a>
</span>

</span>
</span>

</body>
</html>`
    },
    {
      name: 'Indian Journal of Applied Research (IJAR) - October Issue',
      subject: 'Indian Journal of Applied Research (IJAR) - Call For Papers October Issue',
      body_html: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
</head>
<body>

<span style="font-size:22px;">
<span style="font-family:Verdana,Geneva,sans-serif;">

Dear [FNAME]<br>
<br>

<span style="line-height:115%">
Indian Journal of Applied Research
</span><br>
<br>

<span style="line-height:115%">
Peer Reviewed Journal Accepted by UGC &amp; NMC
</span><br>
<br>

<span style="line-height:115%">
Journal ISSN 2249-555X
</span><br>
<br>

<span style="line-height:115%">
PubMed Index Journal
</span><br>
<br>

<span style="line-height:115%">
We are inviting researchers, authors, and academicians to share their latest research work with our journal.
</span><br>
<br>

<span style="line-height:115%">
Original studies, applied research, and valuable academic findings are encouraged for submission.
</span><br>
<br>

<span style="line-height:115%">
If you have an article ready, you can submit it for review for our October issue.
</span><br>
<br>

<span style="line-height:115%">
<a href="/indian-journal-of-applied-research-(IJAR)/page/u/upload-your-article"
style="color:#0563c1; text-decoration:underline;">
<b>Submit Your Article for the October Issue</b>
</a>
</span><br>
<br>

<span style="line-height:115%">
Give your research an opportunity to reach an academic audience.
</span><br>
<br>

<span style="line-height:115%">
<a href="/indian-journal-of-applied-research-(IJAR)/page/u/OptOut"
style="color:#0563c1; text-decoration:underline;">
To Opt Out
</a>
</span>

</span>
</span>

</body>
</html>`
    },
    {
      name: 'Global Journal For Research Analysis (GJRA) - October Issue',
      subject: 'Global Journal For Research Analysis (GJRA) - Call For Papers October Issue',
      body_html: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
</head>
<body>

<span style="font-size:22px;">
<span style="font-family:Verdana,Geneva,sans-serif;">

Dear [FNAME]<br>
<br>

<span style="line-height:115%">
Global Journal For Research Analysis
</span><br>
<br>

<span style="line-height:115%">
Peer Reviewed Journal Accepted by UGC &amp; NMC
</span><br>
<br>

<span style="line-height:115%">
Journal ISSN 2277-8160
</span><br>
<br>

<span style="line-height:115%">
PubMed Index Journal
</span><br>
<br>

<span style="line-height:115%">
Your research and academic work can help contribute to the growing body of knowledge in your field.
</span><br>
<br>

<span style="line-height:115%">
GJRA invites original manuscripts presenting useful research, new findings, and relevant academic insights.
</span><br>
<br>

<span style="line-height:115%">
If you have a completed paper, consider submitting it for the upcoming October publication.
</span><br>
<br>

<span style="line-height:115%">
<a href="/global-journal-for-research-analysis-GJRA/page/p/upload-your-article"
style="color:#0563c1; text-decoration:underline;">
<b>Share Your Research for the October Issue</b>
</a>
</span><br>
<br>

<span style="line-height:115%">
We welcome your research contribution and academic perspective.
</span><br>
<br>

<span style="line-height:115%">
<a href="/global-journal-for-research-analysis-GJRA/page/p/OptOut"
style="color:#0563c1; text-decoration:underline;">
To Opt Out
</a>
</span>

</span>
</span>

</body>
</html>`
    },
    {
      name: 'Paripex Indian Journal of Research - October Issue',
      subject: 'Paripex Indian Journal of Research - Call For Papers October Issue',
      body_html: `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
</head>
<body>

<span style="font-size:22px;">
<span style="font-family:Verdana,Geneva,sans-serif;">

Dear [FNAME]<br>
<br>

<span style="line-height:115%">
Paripex Indian Journal of Research
</span><br>
<br>

<span style="line-height:115%">
Peer Reviewed Journal Accepted by UGC &amp; NMC
</span><br>
<br>

<span style="line-height:115%">
Journal ISSN 2250-1991
</span><br>
<br>

<span style="line-height:115%">
PubMed Index Journal
</span><br>
<br>

<span style="line-height:115%">
Have you recently completed a research project or prepared a manuscript for publication?
</span><br>
<br>

<span style="line-height:115%">
Paripex welcomes original research and academic contributions from researchers and professionals across different fields.
</span><br>
<br>

<span style="line-height:115%">
You can submit your completed manuscript for consideration in the October issue.
</span><br>
<br>

<span style="line-height:115%">
<a href="/paripex/page/p/upload-your-article"
style="color:#0563c1; text-decoration:underline;">
<b>Submit Your Manuscript for the October Issue</b>
</a>
</span><br>
<br>

<span style="line-height:115%">
We appreciate your interest and look forward to your valuable contribution.
</span><br>
<br>

<span style="line-height:115%">
<a href="/paripex/page/p/OptOut"
style="color:#0563c1; text-decoration:underline;">
To Opt Out
</a>
</span>

</span>
</span>

</body>
</html>`
    }
  ];

  for (const t of templates) {
    const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(t.name);
    if (!existing) {
      db.prepare('INSERT INTO templates (name, subject, body_html) VALUES (?, ?, ?)').run(t.name, t.subject, t.body_html);
    } else {
      db.prepare('UPDATE templates SET subject = ?, body_html = ? WHERE id = ?').run(t.subject, t.body_html, existing.id);
    }
  }
}

module.exports = { initSchema };
