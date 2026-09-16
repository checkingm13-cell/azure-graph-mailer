/**
 * REST API Routes for Multi-Account Mailer Engine
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const config = require('../config/env');
const db = require('../db');
const AccountPool = require('../services/accountPool');
const queueWorker = require('../services/queueWorker');
const { renderTemplate } = require('../services/templateEngine');

function formatSqliteDateTime(d) {
  const date = d ? new Date(d) : new Date();
  if (isNaN(date.getTime())) return new Date().toISOString().replace('T', ' ').slice(0, 19);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit to prevent memory exhaustion
});

// Helper function to extract rows from Excel or CSV using ExcelJS
async function parseSpreadsheetRows(filePath, originalName = '') {
  const workbook = new ExcelJS.Workbook();
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext === '.csv') {
    await workbook.csv.readFile(filePath);
  } else {
    await workbook.xlsx.readFile(filePath);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return [];
  }

  const rows = [];
  const headers = [];

  const headerRow = worksheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value || '').trim();
  });

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Skip headers

    const rowObj = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const headerName = headers[colNumber];
      if (headerName) {
        let cellVal = cell.value;
        if (cellVal && typeof cellVal === 'object') {
          cellVal = cellVal.result || cellVal.text || cellVal.hyperlink || '';
        }
        rowObj[headerName] = cellVal;
      }
    });

    if (Object.keys(rowObj).length > 0) {
      rows.push(rowObj);
    }
  });

  return rows;
}

// 1. TELEMETRY & STATUS
router.get('/status', (req, res) => {
  const workerStatus = queueWorker.getStatus();
  const poolMetrics = AccountPool.getPoolMetrics();
  res.json({
    ok: true,
    worker: workerStatus,
    pool: poolMetrics,
    timestamp: new Date().toISOString()
  });
});

// Operational Diagnostic Engine: "Why is my campaign waiting?"
router.get('/campaigns/:id/status-reason', (req, res) => {
  const result = AccountPool.getCampaignWaitReason(req.params.id);
  res.json({ ok: true, ...result });
});

// 2. WORKER CONTROLS
router.post('/worker/pause', (req, res) => {
  queueWorker.pause();
  res.json({ ok: true, message: 'Worker paused' });
});

router.post('/worker/resume', (req, res) => {
  queueWorker.resume();
  res.json({ ok: true, message: 'Worker resumed' });
});

// QUEUE LISTING & MAINTENANCE
router.get('/queue', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const items = db.prepare(`
    SELECT 
      q.id, q.email, q.name, q.subject, q.status, q.attempts, q.scheduled_at, q.sent_at, q.last_error,
      a.email AS assigned_sender_email, a.provider AS assigned_provider,
      c.name AS campaign_name,
      t.name AS template_name
    FROM queue q
    LEFT JOIN accounts a ON q.account_id = a.id
    LEFT JOIN campaigns c ON q.campaign_id = c.id
    LEFT JOIN templates t ON COALESCE(q.template_id, c.template_id) = t.id
    ORDER BY 
      CASE 
        WHEN q.status = 'sending' THEN 1
        WHEN q.status = 'queued' THEN 2
        WHEN q.status = 'failed' THEN 3
        ELSE 4
      END,
      q.id DESC
    LIMIT ?
  `).all(limit);

  res.json({ ok: true, items });
});

router.post('/queue/retry-failed', (req, res) => {
  const { campaignId } = req.body || {};
  let result;
  if (campaignId) {
    result = db.prepare(`
      UPDATE queue 
      SET status = 'queued', 
          attempts = 0, 
          last_error = '' 
      WHERE campaign_id = ? AND status = 'failed'
    `).run(campaignId);

    db.prepare(`
      UPDATE campaigns 
      SET status = 'RUNNING' 
      WHERE id = ? AND status = 'FAILED'
    `).run(campaignId);
  } else {
    result = db.prepare(`
      UPDATE queue 
      SET status = 'queued', 
          attempts = 0, 
          last_error = '' 
      WHERE status = 'failed'
    `).run();

    db.prepare(`
      UPDATE campaigns 
      SET status = 'RUNNING' 
      WHERE status = 'FAILED'
    `).run();
  }

  res.json({
    ok: true,
    message: `Re-queued ${result.changes} failed message(s) back into live dispatch pipeline.`,
    count: result.changes
  });
});

router.post('/queue/clear-completed', (req, res) => {
  const result = db.prepare(`
    DELETE FROM queue 
    WHERE status = 'sent'
  `).run();

  res.json({
    ok: true,
    message: `Cleaned up ${result.changes} sent email(s) from queue pipeline.`,
    count: result.changes
  });
});

// RUNTIME DYNAMIC SETTINGS
router.get('/settings', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'send_interval_ms'").get();
  res.json({
    ok: true,
    sendIntervalMs: row ? parseInt(row.value, 10) : config.globalSendIntervalMs
  });
});

router.post('/settings', (req, res) => {
  const { sendIntervalMs } = req.body;
  const val = parseInt(sendIntervalMs, 10);
  if (isNaN(val) || val < 10) {
    return res.status(400).json({ ok: false, error: 'Valid delay (ms >= 10) is required.' });
  }
  db.prepare(`
    INSERT INTO settings (key, value) VALUES ('send_interval_ms', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(val));
  res.json({ ok: true, sendIntervalMs: val, message: `Pacing delay updated to ${val}ms.` });
});

// Detailed engine telemetry and connection status
router.get('/settings/engine', (req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'send_interval_ms'").get();
  const poolMetrics = AccountPool.getPoolMetrics();
  res.json({
    ok: true,
    engine: {
      sendIntervalMs: row ? parseInt(row.value, 10) : config.globalSendIntervalMs,
      defaultProvider: config.defaultProvider,
      defaultAccountDailyLimit: config.defaultAccountDailyLimit,
      isWorkerRunning: queueWorker.isRunning,
      isWorkerPaused: queueWorker.isPaused
    },
    poolMetrics
  });
});

// 1-Click Bulk update limits across all accounts or filtered by provider
router.post('/settings/bulk-limits', (req, res) => {
  const { dailyLimit, cooldownSeconds, provider } = req.body;
  if (dailyLimit === undefined || dailyLimit === null || isNaN(dailyLimit)) {
    return res.status(400).json({ ok: false, error: 'dailyLimit is required and must be a number.' });
  }

  const limitVal = parseInt(dailyLimit, 10);
  if (limitVal < 1) {
    return res.status(400).json({ ok: false, error: 'dailyLimit must be at least 1.' });
  }

  const updatedCount = AccountPool.bulkUpdateLimits({
    dailyLimit: limitVal,
    cooldownSeconds: cooldownSeconds !== undefined ? parseInt(cooldownSeconds, 10) : undefined,
    provider: provider || 'ALL'
  });

  res.json({
    ok: true,
    message: `Updated limits for ${updatedCount} account(s) to ${limitVal}/day.`,
    updatedCount
  });
});

// 3. ACCOUNT POOL MANAGEMENT
router.get('/accounts', (req, res) => {
  const accounts = AccountPool.getAllAccounts();
  res.json({ ok: true, accounts });
});

router.post('/accounts', (req, res) => {
  const { email, displayName, provider, dailyLimit, cooldownSeconds } = req.body;
  if (!email) {
    return res.status(400).json({ ok: false, error: 'Email address is required.' });
  }

  AccountPool.upsertAccount({
    email,
    displayName: displayName || email.split('@')[0],
    provider: provider || 'GRAPH_API',
    dailyLimit: parseInt(dailyLimit || '500', 10),
    cooldownSeconds: parseInt(cooldownSeconds || '60', 10)
  });

  res.json({ ok: true, message: `Account "${email}" added to pool.` });
});

router.put('/accounts/:id', (req, res) => {
  const { email, displayName, provider, dailyLimit, cooldownSeconds, isActive } = req.body;
  const updated = AccountPool.updateAccountById(req.params.id, {
    email,
    displayName,
    provider,
    dailyLimit: dailyLimit !== undefined ? parseInt(dailyLimit, 10) : undefined,
    cooldownSeconds: cooldownSeconds !== undefined ? parseInt(cooldownSeconds, 10) : undefined,
    isActive
  });

  if (!updated) {
    return res.status(404).json({ ok: false, error: 'Account not found.' });
  }

  res.json({ ok: true, message: `Account "${updated.email}" updated successfully.`, account: updated });
});

router.delete('/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: 'Account removed from pool.' });
});

router.patch('/accounts/:id/toggle', (req, res) => {
  const account = db.prepare('SELECT is_active FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });
  const newStatus = account.is_active === 1 ? 0 : 1;
  db.prepare('UPDATE accounts SET is_active = ? WHERE id = ?').run(newStatus, req.params.id);
  res.json({ ok: true, is_active: newStatus });
});

// Reset single account quota (sent_today = 0, clear cooldown, set quota_reset_at)
router.post('/accounts/:id/reset', (req, res) => {
  const accountId = parseInt(req.params.id, 10);
  if (isNaN(accountId)) return res.status(400).json({ ok: false, error: 'Invalid account ID' });

  const account = db.prepare('SELECT id, email FROM accounts WHERE id = ?').get(accountId);
  if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

  db.prepare(`
    UPDATE accounts 
    SET sent_today = 0, 
        last_sent_at = NULL, 
        cooldown_until = NULL, 
        quota_reset_at = datetime('now', '+1 second'),
        status = 'ACTIVE' 
    WHERE id = ?
  `).run(accountId);

  // refreshRollingQuotas respects quota_reset_at, preserving 100% audit integrity of real sent_at timestamps
  AccountPool.refreshRollingQuotas(true);

  res.json({ ok: true, message: `Reset sent count to 0 for ${account.email}.` });
});

// Reset all accounts quotas in pool
router.post('/accounts/reset-all', (req, res) => {
  const info = db.prepare(`
    UPDATE accounts 
    SET sent_today = 0, 
        last_sent_at = NULL, 
        cooldown_until = NULL, 
        quota_reset_at = datetime('now', '+1 second'),
        status = 'ACTIVE'
  `).run();

  // refreshRollingQuotas respects quota_reset_at, preserving real audit history
  AccountPool.refreshRollingQuotas(true);

  res.json({ ok: true, message: `Reset sent counters to 0 for all ${info.changes} account(s).` });
});

// 4. TEMPLATES MANAGEMENT
router.get('/templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM templates ORDER BY id DESC').all();
  res.json({ ok: true, templates });
});

router.post('/templates', (req, res) => {
  const { id, name, subject, bodyHtml } = req.body;
  if (!name || !subject || !bodyHtml) {
    return res.status(400).json({ ok: false, error: 'Name, subject, and bodyHtml are required.' });
  }

  if (id) {
    db.prepare(`
      UPDATE templates 
      SET name = ?, subject = ?, body_html = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, subject, bodyHtml, id);
    return res.json({ ok: true, message: 'Template updated.' });
  }

  const result = db.prepare(`
    INSERT INTO templates (name, subject, body_html)
    VALUES (?, ?, ?)
  `).run(name, subject, bodyHtml);

  res.json({ ok: true, templateId: result.lastInsertRowid });
});

router.delete('/templates/:id', (req, res) => {
  const tplId = req.params.id;
  const existing = db.prepare('SELECT id FROM templates WHERE id = ?').get(tplId);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Template not found.' });
  }

  const activeCamp = db.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE template_id = ? AND status IN ('QUEUED', 'RUNNING')").get(tplId);
  if (activeCamp.count > 0) {
    return res.status(400).json({ ok: false, error: 'Cannot delete template while active campaigns are using it.' });
  }

  db.prepare('DELETE FROM templates WHERE id = ?').run(tplId);
  res.json({ ok: true, message: 'Template deleted successfully.' });
});

// 5. CONTACTS & CSV / EXCEL IMPORT
router.get('/contacts', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY id DESC LIMIT ?').all(limit);
  const total = db.prepare('SELECT COUNT(*) AS total FROM contacts').get().total;
  res.json({ ok: true, total, contacts });
});

router.post('/contacts/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No Excel or CSV file uploaded.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname || '';

  try {
    const rows = await parseSpreadsheetRows(filePath, originalName);
    try { fs.unlinkSync(filePath); } catch (_) { }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'The uploaded spreadsheet contains no data rows.' });
    }

    let imported = 0;
    let skipped = 0;

    const insertStmt = db.prepare(`
      INSERT INTO contacts (email, name, paper_title, affiliation)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        paper_title = CASE WHEN excluded.paper_title != '' THEN excluded.paper_title ELSE contacts.paper_title END,
        affiliation = CASE WHEN excluded.affiliation != '' THEN excluded.affiliation ELSE contacts.affiliation END
    `);

    const insertMany = db.transaction((records) => {
      for (const r of records) {
        const emailKey = Object.keys(r).find((k) => /^email$/i.test(k.trim())) ||
          Object.keys(r).find((k) => /email|e-mail|mail/i.test(k));
        const nameKey = Object.keys(r).find((k) => /^name$/i.test(k.trim())) ||
          Object.keys(r).find((k) => /name|author|contact/i.test(k));
        const titleKey = Object.keys(r).find((k) => /title|paper|article|manuscript/i.test(k));
        const affilKey = Object.keys(r).find((k) => /affil|univ|org|institute/i.test(k));

        const email = emailKey ? String(r[emailKey] || '').trim().toLowerCase() : '';
        const name = nameKey ? String(r[nameKey] || '').trim() : '';
        const paperTitle = titleKey ? String(r[titleKey] || '').trim() : '';
        const affiliation = affilKey ? String(r[affilKey] || '').trim() : '';

        if (email && email.includes('@') && email.includes('.')) {
          insertStmt.run(email, name, paperTitle, affiliation);
          imported++;
        } else {
          skipped++;
        }
      }
    });

    insertMany(rows);
    res.json({ ok: true, imported, skipped, totalParsed: rows.length });
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (_) { }
    console.error('File parsing error:', err);
    res.status(500).json({ ok: false, error: 'File parsing error: ' + err.message });
  }
});

// 6. CAMPAIGNS & AUTO-SPLIT BATCHES
router.get('/campaigns', (req, res) => {
  const campaigns = db.prepare(`
    SELECT 
      c.*, 
      t.name AS template_name, 
      a.email AS sender_email, 
      a.provider AS sender_provider,
      (SELECT COUNT(DISTINCT COALESCE(q.template_id, c.template_id)) FROM queue q WHERE q.campaign_id = c.id) AS template_variants_count,
      (SELECT COUNT(DISTINCT q.account_id) FROM queue q WHERE q.campaign_id = c.id AND q.account_id IS NOT NULL) AS active_senders_count
    FROM campaigns c
    LEFT JOIN templates t ON c.template_id = t.id
    LEFT JOIN accounts a ON c.sender_account_id = a.id
    ORDER BY c.id DESC
  `).all();
  res.json({ ok: true, campaigns });
});

router.get('/campaigns/:id/preview', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare(`
    SELECT c.*, t.name AS template_name, a.email AS sender_email, a.provider AS sender_provider
    FROM campaigns c
    LEFT JOIN templates t ON c.template_id = t.id
    LEFT JOIN accounts a ON c.sender_account_id = a.id
    WHERE c.id = ?
  `).get(campId);

  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  const summary = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'sent' THEN 1 END) AS sent,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
      COUNT(CASE WHEN status = 'queued' THEN 1 END) AS queued,
      COUNT(CASE WHEN status = 'sending' THEN 1 END) AS sending
    FROM queue
    WHERE campaign_id = ?
  `).get(campId);

  const sampleItems = db.prepare(`
    SELECT 
      q.id, q.email, q.name, q.subject, q.status, q.attempts, q.last_error, q.sent_at,
      a.email AS assigned_sender_email, a.provider AS assigned_provider,
      t.name AS template_name
    FROM queue q
    LEFT JOIN accounts a ON q.account_id = a.id
    LEFT JOIN campaigns c ON q.campaign_id = c.id
    LEFT JOIN templates t ON COALESCE(q.template_id, c.template_id) = t.id
    WHERE q.campaign_id = ?
    ORDER BY q.id ASC
    LIMIT 100
  `).all(campId);

  res.json({
    ok: true,
    campaign: camp,
    summary,
    sampleItems
  });
});

// PRE-FLIGHT CSV/EXCEL PREVIEW & AUTO-SPLIT CALCULATION
router.post('/campaigns/preview-upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No CSV or spreadsheet file uploaded.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname || 'campaign_upload.csv';
  const baseCampaignName = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const batchSize = Math.max(1, parseInt(req.body.batchSize || '50', 10));

  try {
    const rows = await parseSpreadsheetRows(filePath, originalName);
    try { fs.unlinkSync(filePath); } catch (_) { }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'Uploaded file has no data rows.' });
    }

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const seenEmails = new Set();
    const validContacts = [];
    let invalidCount = 0;
    let duplicateInSheetCount = 0;

    const historyStmt = db.prepare(`
      SELECT c.name AS campaign_name, q.sent_at, q.status
      FROM queue q
      JOIN campaigns c ON q.campaign_id = c.id
      WHERE q.email = ? AND q.status = 'sent'
      ORDER BY q.id DESC
      LIMIT 1
    `);

    for (const r of rows) {
      const emailKey = Object.keys(r).find((k) => /^email$/i.test(k.trim())) ||
        Object.keys(r).find((k) => /email|e-mail|mail/i.test(k));
      const nameKey = Object.keys(r).find((k) => /^name$/i.test(k.trim())) ||
        Object.keys(r).find((k) => /name|author|contact/i.test(k));
      const titleKey = Object.keys(r).find((k) => /title|paper|article|manuscript/i.test(k));
      const affilKey = Object.keys(r).find((k) => /affil|univ|org|institute/i.test(k));

      const rawEmail = emailKey ? String(r[emailKey] || '').trim().toLowerCase() : '';
      const name = nameKey ? String(r[nameKey] || '').trim() : '';
      const paperTitle = titleKey ? String(r[titleKey] || '').trim() : '';
      const affiliation = affilKey ? String(r[affilKey] || '').trim() : '';

      if (!rawEmail || !emailRegex.test(rawEmail)) {
        invalidCount++;
        continue;
      }

      if (seenEmails.has(rawEmail)) {
        duplicateInSheetCount++;
        continue;
      }

      seenEmails.add(rawEmail);
      const history = historyStmt.get(rawEmail);

      validContacts.push({
        email: rawEmail,
        name: name,
        paper_title: paperTitle,
        affiliation: affiliation,
        previouslyContacted: history ? {
          campaignName: history.campaign_name,
          sentAt: history.sent_at
        } : null
      });
    }

    const previouslyContactedCount = validContacts.filter(c => c.previouslyContacted !== null).length;

    const scheduleMode = req.body.scheduleMode || 'immediate';
    const scheduledStartTime = req.body.scheduledStartTime || '';
    const staggerMinutes = Math.max(1, parseInt(req.body.staggerMinutes || '60', 10));

    let baseMs = Date.now();
    if ((scheduleMode === 'scheduled' || scheduleMode === 'staggered') && scheduledStartTime) {
      const parsed = new Date(scheduledStartTime).getTime();
      if (!isNaN(parsed) && parsed > Date.now()) {
        baseMs = parsed;
      }
    }

    const batches = [];
    const totalBatches = Math.ceil(validContacts.length / batchSize) || 1;
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = start + batchSize;
      const batchContacts = validContacts.slice(start, end);
      const batchNumStr = String(i + 1).padStart(2, '0');

      let startMs = baseMs;
      if (scheduleMode === 'staggered') {
        startMs = baseMs + i * (staggerMinutes * 60 * 1000);
      } else if (scheduleMode === 'scheduled') {
        startMs = baseMs + i * 2000;
      } else {
        startMs = Date.now() + i * 2000;
      }

      const durationSeconds = Math.round(batchContacts.length * ((config.globalSendIntervalMs || 2500) / 1000));
      const endMs = startMs + (durationSeconds * 1000);

      batches.push({
        batchNumber: i + 1,
        name: `${baseCampaignName}_Batch_${batchNumStr}`,
        count: batchContacts.length,
        scheduledAt: new Date(startMs).toISOString(),
        projectedStart: new Date(startMs).toISOString(),
        projectedEnd: new Date(endMs).toISOString(),
        estimatedDuration: durationSeconds < 60 ? `${durationSeconds}s` : `${Math.ceil(durationSeconds / 60)} min`
      });
    }

    res.json({
      ok: true,
      fileName: originalName,
      baseCampaignName,
      totalRows: rows.length,
      validCount: validContacts.length,
      invalidCount,
      duplicateInSheetCount,
      previouslyContactedCount,
      batchSize,
      scheduleMode,
      scheduledStartTime,
      staggerMinutes,
      totalBatches,
      batches,
      contacts: validContacts,
      samplePreview: validContacts.slice(0, 5)
    });

  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (_) { }
    console.error('Preview error:', err);
    res.status(500).json({ ok: false, error: 'Error generating preview: ' + err.message });
  }
});

// LAUNCH BATCHES
router.post('/campaigns/launch-batches', (req, res) => {
  const {
    baseCampaignName,
    templateId,
    templateIds = [],
    templateRotationStrategy = 'PER_EMAIL',
    batchSize = 50,
    skipPreviouslyContacted = false,
    scheduleMode = 'immediate',
    scheduledStartTime = '',
    staggerMinutes = 60,
    contacts = [],
    senderAccountId = null
  } = req.body;

  // Resolve active templates (supports single template or multi-template rotation)
  let activeTemplates = [];
  if (Array.isArray(templateIds) && templateIds.length > 0) {
    for (const tid of templateIds) {
      const parsedTid = parseInt(tid, 10);
      if (!isNaN(parsedTid)) {
        const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(parsedTid);
        if (t) activeTemplates.push(t);
      }
    }
  }
  
  if (activeTemplates.length === 0 && templateId) {
    const parsedTid = parseInt(templateId, 10);
    if (!isNaN(parsedTid)) {
      const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(parsedTid);
      if (t) activeTemplates.push(t);
    }
  }

  // Graceful fallback: If specified template ID(s) no longer exist (e.g. reseeded DB), pick available templates from DB
  if (activeTemplates.length === 0) {
    const fallbackTemplates = db.prepare('SELECT * FROM templates ORDER BY id ASC LIMIT 5').all();
    if (fallbackTemplates && fallbackTemplates.length > 0) {
      console.warn(`[Launch Batches] Warning: Requested template(s) (${JSON.stringify(templateIds || templateId)}) not found. Auto-recovering with ${fallbackTemplates.length} default template(s).`);
      activeTemplates = fallbackTemplates;
    }
  }

  if (!baseCampaignName || !baseCampaignName.trim()) {
    return res.status(400).json({ ok: false, error: 'Campaign Name is required.' });
  }

  if (activeTemplates.length === 0) {
    return res.status(400).json({ ok: false, error: 'No email templates found in database. Please create a template before launching.' });
  }

  const parsedSenderAccountId = senderAccountId ? parseInt(senderAccountId, 10) : null;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ ok: false, error: 'No contacts provided to launch.' });
  }

  let filteredContacts = contacts;
  if (skipPreviouslyContacted) {
    filteredContacts = contacts.filter(c => !c.previouslyContacted);
  }

  if (filteredContacts.length === 0) {
    return res.status(400).json({ ok: false, error: 'All contacts were skipped due to previous contact history.' });
  }

  const numericBatchSize = Math.max(1, parseInt(batchSize, 10));
  const numericStagger = Math.max(1, parseInt(staggerMinutes || '60', 10));

  let baseMs = Date.now();
  if ((scheduleMode === 'scheduled' || scheduleMode === 'staggered') && scheduledStartTime) {
    const parsed = new Date(scheduledStartTime).getTime();
    if (!isNaN(parsed) && parsed > Date.now()) {
      baseMs = parsed;
    }
  }

  const launchTx = db.transaction(() => {
    const contactUpsert = db.prepare(`
      INSERT INTO contacts (email, name, paper_title, affiliation)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        paper_title = CASE WHEN excluded.paper_title != '' THEN excluded.paper_title ELSE contacts.paper_title END,
        affiliation = CASE WHEN excluded.affiliation != '' THEN excluded.affiliation ELSE contacts.affiliation END
      RETURNING id
    `);

    const contactIdMap = new Map();
    for (const c of filteredContacts) {
      const row = contactUpsert.get(c.email, c.name || '', c.paper_title || '', c.affiliation || '');
      contactIdMap.set(c.email, row.id);
    }

    const totalBatches = Math.ceil(filteredContacts.length / numericBatchSize);
    const createdCampaigns = [];

    const mode = (req.body.mode || 'SMART').toUpperCase();
    const fallbackAllowed = req.body.fallbackAllowed !== undefined ? (req.body.fallbackAllowed ? 1 : 0) : 1;
    const sendingSpeed = (req.body.sendingSpeed || 'BALANCED').toUpperCase();
    const customIntervalMs = parseInt(req.body.customIntervalMs || '2500', 10);

    const campInsert = db.prepare(`
      INSERT INTO campaigns (
        name, template_id, status, total_count, scheduled_at,
        sender_account_id, pinned_account_id, mode, fallback_allowed, sending_speed, custom_interval_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const queueInsert = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status, scheduled_at, template_id)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `);

    for (let i = 0; i < totalBatches; i++) {
      const start = i * numericBatchSize;
      const end = start + numericBatchSize;
      const batchSlice = filteredContacts.slice(start, end);
      const batchNumStr = String(i + 1).padStart(2, '0');
      const batchName = `${baseCampaignName}_Batch_${batchNumStr}`;

      let startMs = baseMs;
      if (scheduleMode === 'staggered') {
        startMs = baseMs + i * (numericStagger * 60 * 1000);
      } else if (scheduleMode === 'scheduled') {
        startMs = baseMs + i * 2000;
      } else {
        startMs = Date.now() + i * 2000;
      }

      const batchScheduledAt = formatSqliteDateTime(new Date(startMs));
      const isFuture = startMs > (Date.now() + 5000);
      const initialStatus = isFuture ? 'SCHEDULED' : 'QUEUED';

      // If PER_BATCH rotation, pick template based on batch index; otherwise pick primary template
      const batchPrimaryTemplate = templateRotationStrategy === 'PER_BATCH'
        ? activeTemplates[i % activeTemplates.length]
        : activeTemplates[0];

      const campRes = campInsert.run(
        batchName,
        batchPrimaryTemplate.id,
        initialStatus,
        batchSlice.length,
        batchScheduledAt,
        parsedSenderAccountId,
        parsedSenderAccountId,
        mode,
        fallbackAllowed,
        sendingSpeed,
        customIntervalMs
      );
      const campaignId = campRes.lastInsertRowid;

      for (let cIdx = 0; cIdx < batchSlice.length; cIdx++) {
        const c = batchSlice[cIdx];
        const contactId = contactIdMap.get(c.email) || null;

        // Choose template: PER_EMAIL rotates round-robin per recipient; PER_BATCH rotates per batch
        const assignedTemplate = templateRotationStrategy === 'PER_EMAIL'
          ? activeTemplates[(i * numericBatchSize + cIdx) % activeTemplates.length]
          : batchPrimaryTemplate;

        const renderedSubject = renderTemplate(assignedTemplate.subject, c);
        const renderedBody = renderTemplate(assignedTemplate.body_html, c);
        queueInsert.run(campaignId, contactId, c.email, c.name || '', renderedSubject, renderedBody, batchScheduledAt, assignedTemplate.id);
      }

      db.prepare(`
        INSERT INTO logs (campaign_id, level, message)
        VALUES (?, 'INFO', ?)
      `).run(campaignId, `Auto-split batch "${batchName}" created with ${batchSlice.length} recipients (Template rotation: ${activeTemplates.length} templates, mode: ${templateRotationStrategy}).`);

      createdCampaigns.push({
        campaignId,
        name: batchName,
        status: initialStatus,
        scheduledAt: batchScheduledAt,
        count: batchSlice.length
      });
    }

    return createdCampaigns;
  });

  const createdCampaigns = launchTx();
  res.json({
    ok: true,
    message: `Successfully created ${createdCampaigns.length} campaigns across ${filteredContacts.length} recipients!`,
    totalCampaigns: createdCampaigns.length,
    totalQueued: filteredContacts.length,
    scheduleMode,
    campaigns: createdCampaigns
  });
});

// PAUSE, RESUME, CANCEL, RE-RUN & AUDIT LOGS
router.post('/campaigns/:id/pause', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  if (camp.status === 'COMPLETED' || camp.status === 'CANCELLED') {
    return res.status(400).json({ ok: false, error: `Cannot pause a ${camp.status} campaign.` });
  }

  db.prepare("UPDATE campaigns SET status = 'PAUSED' WHERE id = ?").run(campId);
  db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'WARN', ?)").run(campId, `Campaign "${camp.name}" paused.`);
  res.json({ ok: true, message: `Campaign "${camp.name}" paused.` });
});

router.post('/campaigns/:id/resume', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  if (camp.status !== 'PAUSED') {
    return res.status(400).json({ ok: false, error: `Campaign is not paused.` });
  }

  const nextStatus = camp.started_at ? 'RUNNING' : 'QUEUED';
  db.prepare("UPDATE campaigns SET status = ? WHERE id = ?").run(nextStatus, campId);
  db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'INFO', ?)").run(campId, `Campaign "${camp.name}" resumed.`);
  res.json({ ok: true, message: `Campaign "${camp.name}" resumed.` });
});

router.post('/campaigns/:id/cancel', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  const cancelTx = db.transaction(() => {
    db.prepare("UPDATE campaigns SET status = 'CANCELLED', completed_at = datetime('now') WHERE id = ?").run(campId);
    db.prepare("UPDATE queue SET status = 'failed', last_error = 'Cancelled by user' WHERE campaign_id = ? AND status = 'queued'").run(campId);
    db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'WARN', ?)").run(campId, `Campaign "${camp.name}" cancelled.`);
  });

  cancelTx();
  res.json({ ok: true, message: `Campaign "${camp.name}" cancelled.` });
});

// CLONE / RE-RUN CAMPAIGN (Re-run failed or all contacts)
router.post('/campaigns/:id/clone', (req, res) => {
  const campId = req.params.id;
  const { 
    newName, 
    templateId,
    templateIds = [],
    templateRotationStrategy = 'PER_EMAIL',
    mode = 'all', 
    sendingStrategy = 'SMART',
    senderAccountId = null,
    fallbackAllowed = true,
    sendingSpeed = 'BALANCED',
    customIntervalMs = 2500
  } = req.body || {};

  const origCamp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!origCamp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  // Resolve active templates (single or rotated)
  let activeTemplates = [];
  if (Array.isArray(templateIds) && templateIds.length > 0) {
    for (const tid of templateIds) {
      const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(parseInt(tid, 10));
      if (t) activeTemplates.push(t);
    }
  } else {
    const targetTplId = templateId || origCamp.template_id;
    const t = db.prepare('SELECT * FROM templates WHERE id = ?').get(targetTplId);
    if (t) activeTemplates.push(t);
  }

  if (activeTemplates.length === 0) {
    return res.status(400).json({ ok: false, error: 'At least one valid email template must be selected.' });
  }

  let query = 'SELECT email, name FROM queue WHERE campaign_id = ?';
  if (mode === 'failed_only') {
    query += " AND status = 'failed'";
  }
  const items = db.prepare(query).all(campId);
  if (!items || items.length === 0) {
    return res.status(400).json({ ok: false, error: `No contacts found to re-run (${mode === 'failed_only' ? 'no failed emails' : 'empty queue'}).` });
  }

  // Deduplicate
  const uniqueItems = [];
  const seen = new Set();
  for (const it of items) {
    if (!seen.has(it.email.toLowerCase())) {
      seen.add(it.email.toLowerCase());
      uniqueItems.push(it);
    }
  }

  const campaignName = (newName && newName.trim()) 
    ? newName.trim() 
    : `${origCamp.name}_Rerun_${mode === 'failed_only' ? 'Failed' : 'All'}_${Date.now().toString().slice(-4)}`;

  const nowSql = formatSqliteDateTime(new Date());
  const parsedSenderAccountId = (sendingStrategy === 'CONTROLLED' && senderAccountId) ? parseInt(senderAccountId, 10) : null;
  const isFallbackAllowed = fallbackAllowed ? 1 : 0;
  const numericIntervalMs = Math.max(100, parseInt(customIntervalMs, 10) || 2500);

  const cloneTx = db.transaction(() => {
    const campRes = db.prepare(`
      INSERT INTO campaigns (
        name, template_id, status, total_count, scheduled_at, 
        sender_account_id, pinned_account_id, mode, fallback_allowed, sending_speed, custom_interval_ms
      )
      VALUES (?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaignName,
      activeTemplates[0].id,
      uniqueItems.length,
      nowSql,
      parsedSenderAccountId,
      parsedSenderAccountId,
      sendingStrategy,
      isFallbackAllowed,
      sendingSpeed,
      numericIntervalMs
    );

    const newCampId = campRes.lastInsertRowid;

    const queueInsert = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status, scheduled_at, template_id)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `);

    for (let cIdx = 0; cIdx < uniqueItems.length; cIdx++) {
      const it = uniqueItems[cIdx];
      const contact = db.prepare('SELECT id, paper_title, affiliation FROM contacts WHERE email = ?').get(it.email);
      const cObj = {
        name: it.name || '',
        paper_title: contact?.paper_title || '',
        affiliation: contact?.affiliation || ''
      };

      const assignedTemplate = activeTemplates[cIdx % activeTemplates.length];
      const renderedSubject = renderTemplate(assignedTemplate.subject, cObj);
      const renderedBody = renderTemplate(assignedTemplate.body_html, cObj);
      queueInsert.run(newCampId, contact?.id || null, it.email, it.name || '', renderedSubject, renderedBody, nowSql, assignedTemplate.id);
    }

    db.prepare(`
      INSERT INTO logs (campaign_id, level, message)
      VALUES (?, 'INFO', ?)
    `).run(newCampId, `Campaign "${campaignName}" created via Re-run of Campaign #${campId} (${uniqueItems.length} recipients, Templates: ${activeTemplates.length}, Mode: ${sendingStrategy}).`);

    return { newCampId, campaignName, count: uniqueItems.length };
  });

  const result = cloneTx();
  res.json({
    ok: true,
    message: `Campaign "${result.campaignName}" queued successfully with ${result.count} recipients!`,
    campaignId: result.newCampId,
    name: result.campaignName,
    totalQueued: result.count
  });
});

router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit || '150', 10);
  const logs = db.prepare(`
    SELECT l.*, a.email AS sender_email, c.name AS campaign_name
    FROM logs l
    LEFT JOIN accounts a ON l.account_id = a.id
    LEFT JOIN campaigns c ON l.campaign_id = c.id
    ORDER BY l.id DESC
    LIMIT ?
  `).all(limit);
  res.json({ ok: true, logs });
});

// QUICK TEST EMAIL
router.post('/send-test', async (req, res) => {
  const { toEmail, name = 'Test Recipient', subject = '✅ Test Email from Azure Mailer', bodyHtml, senderAccountId = null } = req.body;
  if (!toEmail || !toEmail.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Valid recipient email address is required.' });
  }

  const account = AccountPool.getAvailableAccount(senderAccountId ? parseInt(senderAccountId, 10) : null);
  if (!account) {
    return res.status(503).json({ ok: false, error: 'Selected sender account is unavailable.' });
  }

  const content = bodyHtml || `<div style="font-family: sans-serif; padding: 20px;">
    <h2>✅ Test Email Delivery</h2>
    <p>Hello <b>${name}</b>,</p>
    <p>Dispatched via <b>${account.email}</b> (${account.provider})</p>
  </div>`;

  try {
    const { sendViaGraph } = require('../services/graphMailer');
    const { sendViaACS } = require('../services/acsMailer');
    const { sendViaOCI } = require('../services/ociMailer');

    if (account.provider === 'AZURE_ACS') {
      await sendViaACS({
        fromEmail: account.email,
        toEmail: toEmail.trim(),
        subject,
        htmlBody: content
      });
    } else if (account.provider === 'OCI') {
      await sendViaOCI({
        fromEmail: account.email,
        toEmail: toEmail.trim(),
        subject,
        htmlBody: content
      });
    } else {
      await sendViaGraph({
        fromEmail: account.email,
        toEmail: toEmail.trim(),
        subject,
        htmlBody: content
      });
    }

    AccountPool.recordSendSuccess(account.id);
    res.json({ ok: true, message: `Test email dispatched to ${toEmail} via ${account.email}.` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;