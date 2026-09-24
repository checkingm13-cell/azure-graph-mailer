/**
 * Database Schema Initializer & Migration Runner
 */

const fs = require('fs');
const path = require('path');

const schemaSql = `
-- 1. ACCOUNTS POOL: Manages multi-account senders (1 to 40+ accounts)
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'GRAPH_API', -- 'GRAPH_API', 'AZURE_ACS', 'OCI', or 'MAILGUN'
    oci_region TEXT DEFAULT 'ap-mumbai-1',
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

-- 8. DETAILED DELIVERY LOGS: Complete email dispatch tracking
CREATE TABLE IF NOT EXISTS delivery_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    queue_id INTEGER NOT NULL,
    account_id INTEGER,
    recipient_email TEXT NOT NULL,
    recipient_name TEXT DEFAULT '',
    sender_email TEXT NOT NULL,
    sender_provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    template_name TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'sending', 'sent', 'failed'
    attempts INTEGER DEFAULT 0,
    error_message TEXT DEFAULT '',
    error_stage TEXT DEFAULT '', -- 'RESOLVE_TEMPLATE', 'ACCOUNT_SELECTION', 'SMTP_CONNECT', 'TLS_HANDSHAKE', 'DISPATCH'
    provider_message_id TEXT DEFAULT '',
    rendered_html_sent TEXT DEFAULT '', -- Exact raw HTML dispatched over the wire
    dispatch_metadata TEXT DEFAULT '', -- JSON of merge tags, sender domain, headers, timing
    response_payload TEXT DEFAULT '', -- Exact server response or full error stack
    queued_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY(queue_id) REFERENCES queue(id) ON DELETE CASCADE,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_queue_status_id ON queue(status, id);
CREATE INDEX IF NOT EXISTS idx_queue_sent_at ON queue(status, sent_at);
CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(is_active, sent_today, last_sent_at);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_recipient ON delivery_logs(recipient_email);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_campaign ON delivery_logs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_status ON delivery_logs(status);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_created ON delivery_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_queue_id ON delivery_logs(queue_id);
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
    if (!accountCols.includes('oci_region')) {
      db.exec("ALTER TABLE accounts ADD COLUMN oci_region TEXT DEFAULT 'ap-mumbai-1'");
    }
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
    if (!campaignCols.includes('category')) {
      db.exec("ALTER TABLE campaigns ADD COLUMN category TEXT DEFAULT 'TEXT'");
    }

    const templateCols = db.prepare("PRAGMA table_info(templates)").all().map(c => c.name);
    if (!templateCols.includes('category')) {
      db.exec("ALTER TABLE templates ADD COLUMN category TEXT DEFAULT 'TEXT'");
    }
    db.exec("UPDATE templates SET category = 'VISUAL' WHERE (category IS NULL OR category = 'TEXT') AND (body_html LIKE '%<img%' OR body_html LIKE '%<IMG%');");

    const deliveryLogCols = db.prepare("PRAGMA table_info(delivery_logs)").all().map(c => c.name);
    if (!deliveryLogCols.includes('error_stage')) {
      db.exec("ALTER TABLE delivery_logs ADD COLUMN error_stage TEXT DEFAULT ''");
    }
    if (!deliveryLogCols.includes('rendered_html_sent')) {
      db.exec("ALTER TABLE delivery_logs ADD COLUMN rendered_html_sent TEXT DEFAULT ''");
    }
    if (!deliveryLogCols.includes('dispatch_metadata')) {
      db.exec("ALTER TABLE delivery_logs ADD COLUMN dispatch_metadata TEXT DEFAULT ''");
    }
    if (!deliveryLogCols.includes('response_payload')) {
      db.exec("ALTER TABLE delivery_logs ADD COLUMN response_payload TEXT DEFAULT ''");
    }

    db.exec("CREATE INDEX IF NOT EXISTS idx_campaigns_parent ON campaigns(parent_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_queue_schedule ON queue(status, scheduled_at, id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_queue_campaign_id ON queue(campaign_id);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_queue_campaign_status ON queue(campaign_id, status);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_queue_account_sent ON queue(account_id, status, sent_at);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);");
    db.exec("CREATE INDEX IF NOT EXISTS idx_queue_status_email ON queue(status, email);");

    // Seed/Upsert standard journal templates
    seedJournalTemplates(db);
    seedVisualImageTemplates(db);
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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IJSR - Call For Papers</title>
</head>
<body style="margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="display:none !important; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide:all; visibility:hidden;">
  International Journal of Scientific Research (IJSR) - Call For Papers October Issue. Peer Reviewed Journal Accepted by UGC & NMC.
</div>

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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IJAR - Call For Papers</title>
</head>
<body style="margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="display:none !important; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide:all; visibility:hidden;">
  Indian Journal of Applied Research (IJAR) - Call For Papers October Issue. Peer Reviewed Journal Accepted by UGC & NMC.
</div>

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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GJRA - Call For Papers</title>
</head>
<body style="margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="display:none !important; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide:all; visibility:hidden;">
  Global Journal For Research Analysis (GJRA) - Call For Papers October Issue. Peer Reviewed Journal Accepted by UGC & NMC.
</div>

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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Paripex - Call For Papers</title>
</head>
<body style="margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
<div style="display:none !important; font-size:0px; line-height:0px; max-height:0px; max-width:0px; opacity:0; overflow:hidden; mso-hide:all; visibility:hidden;">
  Paripex Indian Journal of Research - Call For Papers October Issue. Peer Reviewed Journal Accepted by UGC & NMC.
</div>

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
      db.prepare('INSERT INTO templates (name, subject, body_html, category) VALUES (?, ?, ?, ?)').run(t.name, t.subject, t.body_html, 'TEXT');
    }
    // Existing user-edited templates are preserved — no overwrite on restart!
  }
}

function seedVisualImageTemplates(db) {
  const visualTemplates = [
    {
      name: 'IJAR - 4-Step Author Publishing Guide [Visual Image Card]',
      subject: 'Indian Journal of Applied Research (IJAR) - Call For Papers October Issue',
      file: 'email-preview.html',
      imgPlaceholder: 'author-publishing-guide-4-steps.jpg',
      cid: 'author_publishing_guide'
    },
    {
      name: 'IJSR - Swiss Typographic Poster [Visual Image Card]',
      subject: 'International Journal of Scientific Research (IJSR) - Call For Papers October Issue',
      file: 'email-preview-ijsr.html',
      imgPlaceholder: 'IJSR-email.jpg',
      cid: 'ijsr_email_banner'
    },
    {
      name: 'PARIPEX - Swiss Typographic Poster [Visual Image Card]',
      subject: 'Paripex - Indian Journal of Research - Call For Papers October Issue',
      file: 'email-preview-paripex.html',
      imgPlaceholder: 'paripex-email.jpg',
      cid: 'paripex_email_banner'
    },
    {
      name: 'GJRA - Swiss Typographic Poster [Visual Image Card]',
      subject: 'Global Journal For Research Analysis (GJRA) - Call For Papers October Issue',
      file: 'email-preview-gjra.html',
      imgPlaceholder: 'gjra-email.jpg',
      cid: 'gjra_email_banner'
    }
  ];

  for (const vt of visualTemplates) {
    try {
      const filePath = path.resolve(__dirname, '../../public', vt.file);
      if (!fs.existsSync(filePath)) continue;
      let html = fs.readFileSync(filePath, 'utf-8');

      const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(vt.name);
      if (!existing) {
        db.prepare('INSERT INTO templates (name, subject, body_html, category) VALUES (?, ?, ?, ?)').run(vt.name, vt.subject, html, 'VISUAL');
      }
      // Existing user-edited templates are preserved — no overwrite on restart!
    } catch (e) {
      console.warn(`[Schema] Warning seeding visual template "${vt.name}":`, e.message);
    }
  }
}

module.exports = { initSchema };
