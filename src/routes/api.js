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
const { toISTString, parseIST, IST_SQL_NOW, nowIST, formatISTClock, formatDuration } = require('../utils/time');

function formatSqliteDateTime(d) {
  if (!d) return nowIST();
  const date = parseIST(d);
  return toISTString(date || new Date());
}

const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit to prevent memory exhaustion
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit for poster images
});

const storageService = require('../services/storageService');
const csvParser = require('csv-parser');

// Helper function to extract rows from Excel or CSV using fast streaming for CSV
async function parseSpreadsheetRows(filePath, originalName = '') {
  const ext = path.extname(originalName || filePath).toLowerCase();

  if (ext === '.csv') {
    return new Promise((resolve, reject) => {
      const rows = [];
      fs.createReadStream(filePath)
        .pipe(csvParser({
          mapHeaders: ({ header }) => header.trim().replace(/^["']|["']$/g, '')
        }))
        .on('data', (data) => {
          if (data && Object.keys(data).length > 0) {
            rows.push(data);
          }
        })
        .on('end', () => resolve(rows))
        .on('error', (err) => reject(err));
    });
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

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

// 0. AUTO-DEPLOYMENT WEBHOOK (Auto-pull from GitHub origin/main and restart PM2)
router.all('/webhook/deploy', (req, res) => {
  const secret = req.query.secret || req.headers['x-deploy-secret'] || (req.body && req.body.secret);
  const expectedSecret = process.env.DEPLOY_SECRET || 'balaji_deploy_2026';

  if (secret !== expectedSecret) {
    return res.status(403).json({ ok: false, error: 'Unauthorized: Invalid deployment secret.' });
  }

  res.json({ ok: true, message: '🚀 Deployment initiated. Synchronizing with origin/main and reloading PM2...' });

  const projectRoot = path.resolve(__dirname, '../../');
  const pm2Bin = fs.existsSync('/var/www/vhosts/balajiimpex.store/.npm-global/bin/pm2')
    ? '/var/www/vhosts/balajiimpex.store/.npm-global/bin/pm2'
    : 'pm2';

  const deployCmd = `git fetch origin main && git reset --hard origin/main && ${pm2Bin} restart all`;
  const { exec } = require('child_process');
  exec(deployCmd, { cwd: projectRoot }, (error, stdout, stderr) => {
    if (error) {
      console.error('[AutoDeploy Webhook] Deployment error:', error.message);
    } else {
      console.log('[AutoDeploy Webhook] Deployment successful:', stdout);
    }
  });
});

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

// QUEUE LISTING & MAINTENANCE (Server-Side Pagination, Search & Status Filtering)
router.get('/queue', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(Math.max(1, parseInt(req.query.limit || '25', 10)), 200);
  const offset = (page - 1) * limit;
  const statusFilter = req.query.status || 'all';
  const searchTerm = String(req.query.search || '').trim();
  const dateFilter = String(req.query.date || '').trim();

  const whereConditions = [];
  const params = [];

  if (statusFilter === 'active') {
    whereConditions.push("q.status IN ('queued', 'sending')");
  } else if (statusFilter !== 'all') {
    whereConditions.push('q.status = ?');
    params.push(statusFilter);
  }

  if (searchTerm) {
    whereConditions.push('(q.email LIKE ? OR q.name LIKE ? OR q.subject LIKE ? OR c.name LIKE ?)');
    const searchPattern = `%${searchTerm}%`;
    params.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  if (dateFilter) {
    whereConditions.push('(substr(q.sent_at, 1, 10) = ? OR substr(q.scheduled_at, 1, 10) = ? OR substr(q.created_at, 1, 10) = ?)');
    params.push(dateFilter, dateFilter, dateFilter);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total 
    FROM queue q 
    LEFT JOIN campaigns c ON q.campaign_id = c.id 
    ${whereClause}
  `).get(...params);
  const total = countRow ? countRow.total : 0;

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
    ${whereClause}
    ORDER BY 
      CASE 
        WHEN q.status = 'sending' THEN 1
        WHEN q.status = 'queued' THEN 2
        WHEN q.status = 'failed' THEN 3
        ELSE 4
      END,
      q.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    ok: true,
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1
    }
  });
});

// DETAILED DELIVERY AUDIT LOGS ENDPOINTS (from read-from-this.txt)
router.get('/delivery-logs', (req, res) => {
  const {
    search = '',
    campaignId = '',
    status = '',
    startDate = '',
    endDate = '',
    limit = 100,
    offset = 0
  } = req.query;

  let query = `
    SELECT 
      dl.*,
      c.name AS campaign_name,
      t.name AS template_name
    FROM delivery_logs dl
    LEFT JOIN campaigns c ON dl.campaign_id = c.id
    LEFT JOIN templates t ON c.template_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ` AND (dl.recipient_email LIKE ? OR dl.recipient_name LIKE ? OR dl.sender_email LIKE ?)`;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  if (campaignId) {
    query += ` AND dl.campaign_id = ?`;
    params.push(parseInt(campaignId, 10));
  }

  if (status) {
    query += ` AND dl.status = ?`;
    params.push(status);
  }

  if (startDate) {
    query += ` AND dl.created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    query += ` AND dl.created_at <= ?`;
    params.push(endDate + ' 23:59:59');
  }

  query += ` ORDER BY dl.created_at DESC LIMIT ? OFFSET ?`;
  const numLimit = Math.max(1, parseInt(limit, 10));
  const numOffset = Math.max(0, parseInt(offset, 10));
  params.push(numLimit, numOffset);

  const logs = db.prepare(query).all(...params);

  // Total count for pagination
  let countQuery = `SELECT COUNT(*) AS total FROM delivery_logs dl WHERE 1=1`;
  const countParams = [];

  if (search) {
    countQuery += ` AND (dl.recipient_email LIKE ? OR dl.recipient_name LIKE ? OR dl.sender_email LIKE ?)`;
    const searchPattern = `%${search}%`;
    countParams.push(searchPattern, searchPattern, searchPattern);
  }
  if (campaignId) {
    countQuery += ` AND dl.campaign_id = ?`;
    countParams.push(parseInt(campaignId, 10));
  }
  if (status) {
    countQuery += ` AND dl.status = ?`;
    countParams.push(status);
  }
  if (startDate) {
    countQuery += ` AND dl.created_at >= ?`;
    countParams.push(startDate);
  }
  if (endDate) {
    countQuery += ` AND dl.created_at <= ?`;
    countParams.push(endDate + ' 23:59:59');
  }

  const { total } = db.prepare(countQuery).get(...countParams);

  res.json({
    ok: true,
    logs,
    total,
    limit: numLimit,
    offset: numOffset
  });
});

router.get('/delivery-logs/stats/summary', (req, res) => {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'sent' THEN 1 END) AS sent,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
      COUNT(CASE WHEN status = 'queued' THEN 1 END) AS queued,
      COUNT(CASE WHEN status = 'sending' THEN 1 END) AS sending,
      COUNT(DISTINCT recipient_email) AS unique_recipients,
      COUNT(DISTINCT campaign_id) AS campaigns_count
    FROM delivery_logs
  `).get();

  res.json({ ok: true, stats });
});

router.get('/delivery-logs/:id', (req, res) => {
  const log = db.prepare(`
    SELECT 
      dl.*,
      c.name AS campaign_name,
      t.name AS template_name
    FROM delivery_logs dl
    LEFT JOIN campaigns c ON dl.campaign_id = c.id
    LEFT JOIN templates t ON c.template_id = t.id
    WHERE dl.id = ?
  `).get(req.params.id);

  if (!log) {
    return res.status(404).json({ ok: false, error: 'Log not found' });
  }

  res.json({ ok: true, log });
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

// Maintenance Unblocker: Instantly reconciles stuck 49/50 batches and advances queue chains
router.post('/maintenance/unblock-stuck-batches', async (req, res) => {
  try {
    const batchChainManager = require('../services/batchChainManager');
    await batchChainManager.monitorBatchCompletion();
    res.json({ ok: true, message: 'Batch completion reconciliation completed successfully.' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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
  const { email, displayName, provider, dailyLimit, cooldownSeconds, ociRegion, oci_region } = req.body;
  if (!email) {
    return res.status(400).json({ ok: false, error: 'Email address is required.' });
  }

  AccountPool.upsertAccount({
    email,
    displayName: displayName || email.split('@')[0],
    provider: provider || 'GRAPH_API',
    dailyLimit: parseInt(dailyLimit || '500', 10),
    cooldownSeconds: parseInt(cooldownSeconds || '60', 10),
    ociRegion: ociRegion || oci_region || 'ap-mumbai-1'
  });

  res.json({ ok: true, message: `Account "${email}" added to pool.` });
});

router.put('/accounts/:id', (req, res) => {
  const { email, displayName, provider, dailyLimit, cooldownSeconds, isActive, ociRegion, oci_region } = req.body;
  const updated = AccountPool.updateAccountById(req.params.id, {
    email,
    displayName,
    provider,
    dailyLimit: dailyLimit !== undefined ? parseInt(dailyLimit, 10) : undefined,
    cooldownSeconds: cooldownSeconds !== undefined ? parseInt(cooldownSeconds, 10) : undefined,
    isActive,
    ociRegion: ociRegion || oci_region
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
  const { id, name, subject, bodyHtml, category } = req.body;
  if (!name || !subject || !bodyHtml) {
    return res.status(400).json({ ok: false, error: 'Name, subject, and bodyHtml are required.' });
  }

  const assignedCategory = category 
    ? category.toUpperCase() 
    : (/<img\b/i.test(bodyHtml) ? 'VISUAL' : 'TEXT');

  if (id) {
    db.prepare(`
      UPDATE templates 
      SET name = ?, subject = ?, body_html = ?, category = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, subject, bodyHtml, assignedCategory, id);
    if (typeof queueWorker.invalidateTemplateCache === 'function') {
      queueWorker.invalidateTemplateCache(id);
    }
    return res.json({ ok: true, message: 'Template updated.' });
  }

  const result = db.prepare(`
    INSERT INTO templates (name, subject, body_html, category)
    VALUES (?, ?, ?, ?)
  `).run(name, subject, bodyHtml, assignedCategory);

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
  if (typeof queueWorker.invalidateTemplateCache === 'function') {
    queueWorker.invalidateTemplateCache(tplId);
  }
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
      a.provider AS sender_provider
    FROM campaigns c
    LEFT JOIN templates t ON c.template_id = t.id
    LEFT JOIN accounts a ON c.sender_account_id = a.id
    ORDER BY c.id DESC
  `).all();

  // Query active pool health & slippage factors
  let totalAccounts = 1;
  let healthyAccounts = 1;
  let cooldownAccounts = 0;
  try {
    const accStats = db.prepare(`
      SELECT 
        COUNT(*) AS total,
        COUNT(CASE WHEN is_active = 1 AND sent_today < daily_limit AND (cooldown_until IS NULL OR strftime('%s', 'now', '+330 minutes') >= strftime('%s', cooldown_until)) THEN 1 END) AS healthy,
        COUNT(CASE WHEN cooldown_until IS NOT NULL AND strftime('%s', 'now', '+330 minutes') < strftime('%s', cooldown_until) THEN 1 END) AS on_cooldown
      FROM accounts
    `).get();
    if (accStats && accStats.total > 0) {
      totalAccounts = accStats.total;
      healthyAccounts = Math.max(1, accStats.healthy);
      cooldownAccounts = accStats.on_cooldown || 0;
    }
  } catch (_) {}

  // Global default pacing
  let defaultPacingMs = config.globalSendIntervalMs || 2500;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'send_interval_ms'").get();
    if (row && row.value) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed) && parsed > 0) defaultPacingMs = parsed;
    }
  } catch (_) {}

  // Dynamic Slippage Multiplier:
  // Base 1.20 (+20% safety margin for latency, TLS, retry backoffs) + 0.15 extra if senders are on cooldown
  const slippageMultiplier = 1.20 + (cooldownAccounts > 0 ? Math.min(0.30, cooldownAccounts * 0.10) : 0);
  const slippagePct = Math.round((slippageMultiplier - 1) * 100);

  // Count total concurrent active master campaigns sharing the sender pool
  const concurrentActiveCount = Math.max(1, campaigns.filter(c => c.status === 'RUNNING' && !c.is_batch).length);

  const enriched = campaigns.map((c) => {
    const processed = (c.sent_count || 0) + (c.failed_count || 0);
    const remaining = Math.max(0, (c.total_count || 0) - processed);
    const progressPct = c.total_count > 0 ? Math.min(100, Math.round((processed / c.total_count) * 100)) : 0;
    const dispatchedAt = c.started_at || null;

    // Use campaign-specific interval setting if configured, else default
    const effectiveIntervalMs = c.custom_interval_ms && c.custom_interval_ms > 0 ? c.custom_interval_ms : defaultPacingMs;
    const intervalSec = effectiveIntervalMs / 1000;

    // For parallel multi-account pool: available throughput is shared evenly across concurrent active campaigns
    const poolConcurrency = Math.max(1, Math.min(healthyAccounts, 8));
    const effectiveAccountsForThisCampaign = Math.max(0.5, poolConcurrency / concurrentActiveCount);
    const effectiveSpeedSecPerEmail = intervalSec / effectiveAccountsForThisCampaign;

    let etaSeconds = 0;
    let estimatedCompletionIST = null;
    let completionDurationText = null;

    if (c.status === 'RUNNING' || c.status === 'SCHEDULED' || c.status === 'QUEUED') {
      // Apply Realistic Slippage
      etaSeconds = Math.round(remaining * effectiveSpeedSecPerEmail * slippageMultiplier);

      if (c.status === 'RUNNING') {
        const targetDate = new Date(Date.now() + (etaSeconds * 1000));
        estimatedCompletionIST = remaining > 0 ? formatISTClock(targetDate) : 'Now';
        completionDurationText = formatDuration(etaSeconds);
      } else if (c.scheduled_at) {
        const parsedStart = parseIST(c.scheduled_at);
        const startMs = parsedStart && !isNaN(parsedStart.getTime()) ? parsedStart.getTime() : Date.now();
        const targetDate = new Date(startMs + (etaSeconds * 1000));
        estimatedCompletionIST = formatISTClock(targetDate);
        completionDurationText = formatDuration(etaSeconds);
      } else {
        const targetDate = new Date(Date.now() + (etaSeconds * 1000));
        estimatedCompletionIST = formatISTClock(targetDate);
        completionDurationText = formatDuration(etaSeconds);
      }
    }

    return {
      ...c,
      remaining,
      progressPct,
      dispatchedAt,
      etaSeconds,
      estimatedCompletionIST,
      completionDurationText,
      effectiveIntervalMs,
      slippagePct,
      healthyAccounts,
      cooldownAccounts
    };
  });

  res.json({ ok: true, campaigns: enriched });
});

router.get('/campaigns/:id/preview', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare(`
    SELECT c.*, t.name AS template_name, a.email AS sender_email, a.provider AS sender_provider, a.oci_region AS sender_oci_region
    FROM campaigns c
    LEFT JOIN templates t ON c.template_id = t.id
    LEFT JOIN accounts a ON c.sender_account_id = a.id
    WHERE c.id = ?
  `).get(campId);

  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  // If parent campaign, query across all child batch IDs; otherwise just self
  const childIds = db.prepare('SELECT id FROM campaigns WHERE parent_id = ?').all(campId).map(r => r.id);
  const targetIds = childIds.length > 0 ? childIds : [parseInt(campId)];
  const ph = targetIds.map(() => '?').join(',');

  let summary = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'sent' THEN 1 END) AS sent,
      COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
      COUNT(CASE WHEN status = 'queued' THEN 1 END) AS queued,
      COUNT(CASE WHEN status = 'sending' THEN 1 END) AS sending
    FROM queue
    WHERE campaign_id IN (${ph})
  `).get(...targetIds);

  // If queue records were cleared via "Clear Completed", fall back to permanent campaign metrics
  if (!summary || summary.total === 0) {
    const campAgg = db.prepare(`
      SELECT 
        SUM(total_count) as total,
        SUM(sent_count) as sent,
        SUM(failed_count) as failed
      FROM campaigns
      WHERE id IN (${ph})
    `).get(...targetIds);

    summary = {
      total: campAgg?.total || camp.total_count || 0,
      sent: campAgg?.sent || camp.sent_count || 0,
      failed: campAgg?.failed || camp.failed_count || 0,
      queued: 0,
      sending: 0
    };
  }

  let sampleItems = db.prepare(`
    SELECT 
      q.id, q.email, q.name, q.subject, q.rendered_html, q.status, q.attempts, q.last_error, q.sent_at,
      a.email AS assigned_sender_email, a.provider AS assigned_provider, a.oci_region AS assigned_oci_region,
      t.name AS template_name
    FROM queue q
    LEFT JOIN accounts a ON q.account_id = a.id
    LEFT JOIN campaigns c ON q.campaign_id = c.id
    LEFT JOIN templates t ON COALESCE(q.template_id, c.template_id) = t.id
    WHERE q.campaign_id IN (${ph})
    ORDER BY q.id ASC
    LIMIT 100
  `).all(...targetIds);

  // If queue items are cleared, load recent dispatches from delivery_logs or contacts
  if (sampleItems.length === 0 && summary.sent > 0) {
    sampleItems = db.prepare(`
      SELECT 
        dl.id, dl.recipient_email AS email, dl.recipient_name AS name, dl.subject,
        COALESCE(dl.rendered_html_sent, '') AS rendered_html,
        dl.status, dl.attempts, dl.error_message AS last_error, dl.completed_at AS sent_at,
        dl.error_stage, dl.provider_message_id, dl.dispatch_metadata, dl.response_payload,
        dl.sender_email AS assigned_sender_email, dl.sender_provider AS assigned_provider,
        a.oci_region AS assigned_oci_region,
        dl.template_name
      FROM delivery_logs dl
      LEFT JOIN accounts a ON dl.account_id = a.id
      WHERE dl.campaign_id IN (${ph})
      ORDER BY dl.id ASC
      LIMIT 100
    `).all(...targetIds);
  }

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
    // Safe non-blocking cleanup so Windows file lock never crashes the process
    fs.unlink(filePath, () => {});

    if (!rows || rows.length === 0) {
      return res.status(400).json({ ok: false, error: 'Uploaded file has no data rows.' });
    }

    const seenEmails = new Set();
    const validContacts = [];
    let invalidCount = 0;
    let duplicateInSheetCount = 0;

    // ponytail: extract CSV emails first, then query only those from queue.
    // Old approach loaded ALL sent rows into RAM (OOM at crore scale).
    const csvEmails = [];
    for (const r of rows) {
      const ek = Object.keys(r).find((k) => /^email$/i.test(k.trim())) ||
        Object.keys(r).find((k) => /email|e-mail|mail/i.test(k));
      const email = ek ? String(r[ek] || '').trim().toLowerCase() : '';
      if (email && email.includes('@')) csvEmails.push(email);
    }

    const sentHistoryMap = new Map();
    if (csvEmails.length > 0) {
      // Batch lookup in chunks of 500 to avoid SQLite variable limit
      for (let i = 0; i < csvEmails.length; i += 500) {
        const chunk = csvEmails.slice(i, i + 500);
        const ph = chunk.map(() => '?').join(',');
        const sentRows = db.prepare(`
          SELECT q.email, c.name AS campaign_name, q.sent_at
          FROM queue q
          JOIN campaigns c ON q.campaign_id = c.id
          WHERE q.status = 'sent' AND q.email IN (${ph})
          ORDER BY q.id DESC
        `).all(...chunk);
        for (const sh of sentRows) {
          if (!sentHistoryMap.has(sh.email)) {
            sentHistoryMap.set(sh.email, { campaignName: sh.campaign_name, sentAt: sh.sent_at });
          }
        }
      }
    }

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

      // High-speed string validation (< 0.001ms per row, replaces slow regex)
      if (!rawEmail || !rawEmail.includes('@') || !rawEmail.includes('.')) {
        invalidCount++;
        continue;
      }

      if (seenEmails.has(rawEmail)) {
        duplicateInSheetCount++;
        continue;
      }

      seenEmails.add(rawEmail);
      const history = sentHistoryMap.get(rawEmail);

      validContacts.push({
        email: rawEmail,
        name: name,
        paper_title: paperTitle,
        affiliation: affiliation,
        previouslyContacted: history || null
      });
    }

    const previouslyContactedCount = validContacts.filter(c => c.previouslyContacted !== null).length;

    const scheduleMode = req.body.scheduleMode || 'immediate';
    const scheduledStartTime = req.body.scheduledStartTime || '';
    const staggerMinutes = Math.max(1, parseInt(req.body.staggerMinutes || '60', 10));

    let baseMs = Date.now();
    if ((scheduleMode === 'scheduled' || scheduleMode === 'staggered') && scheduledStartTime) {
      const parsedDate = parseIST(scheduledStartTime);
      const parsed = parsedDate ? parsedDate.getTime() : NaN;
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
        scheduledAt: toISTString(new Date(startMs)),
        projectedStart: toISTString(new Date(startMs)),
        projectedEnd: toISTString(new Date(endMs)),
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
      samplePreview: validContacts.slice(0, 50)
    });

  } catch (err) {
    fs.unlink(filePath, () => {});
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
    const parsedDate = parseIST(scheduledStartTime);
    const parsed = parsedDate ? parsedDate.getTime() : NaN;
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

    const mode = parsedSenderAccountId ? 'CONTROLLED' : (req.body.mode || 'SMART').toUpperCase();
    const fallbackAllowed = req.body.fallbackAllowed !== undefined ? (req.body.fallbackAllowed ? 1 : 0) : (parsedSenderAccountId ? 0 : 1);
    const sendingSpeed = (req.body.sendingSpeed || 'BALANCED').toUpperCase();
    const customIntervalMs = parseInt(req.body.customIntervalMs || '2500', 10);
    const campaignCategory = (req.body.category || '').toUpperCase() === 'VISUAL'
      || activeTemplates.some(t => t.category === 'VISUAL' || (t.body_html && /<img\b/i.test(t.body_html)))
      ? 'VISUAL'
      : 'TEXT';

    const campInsert = db.prepare(`
      INSERT INTO campaigns (
        name, template_id, status, total_count, scheduled_at,
        sender_account_id, pinned_account_id, mode, fallback_allowed, sending_speed, custom_interval_ms,
        parent_id, is_batch, category
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Insert Parent Master Campaign if multi-batch, or single master
    let parentCampaignId = null;
    const parentScheduledAt = formatSqliteDateTime(new Date(baseMs));
    const parentStatus = baseMs > (Date.now() + 5000) ? 'SCHEDULED' : 'QUEUED';

    const parentCampRes = campInsert.run(
      baseCampaignName,
      activeTemplates[0].id,
      parentStatus,
      filteredContacts.length,
      parentScheduledAt,
      parsedSenderAccountId,
      parsedSenderAccountId,
      mode,
      fallbackAllowed,
      sendingSpeed,
      customIntervalMs,
      null,
      0, // is_batch = 0 (Master Parent)
      campaignCategory
    );
    parentCampaignId = parentCampRes.lastInsertRowid;

    const queueInsert = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status, scheduled_at, template_id)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `);

    for (let i = 0; i < totalBatches; i++) {
      const start = i * numericBatchSize;
      const end = start + numericBatchSize;
      const rawSlice = filteredContacts.slice(start, end);
      if (!rawSlice || rawSlice.length === 0) continue; // Prevent zero-contact batches (e.g. Batch_02 with 0 items)
      
      // Inject test recipients at the start of every batch only if includeTestRecipients is true (default: true)
      const shouldInjectTest = req.body.includeTestRecipients !== false;
      const sample = rawSlice[0] || {};
      const testRecipients = shouldInjectTest ? [
        { email: 'sharifmemon64@gmail.com', name: 'Sharif Memon' },
        { email: 'memonkhansa688@gmail.com', name: 'Khansa Memon' },
        { email: 'hamza.memon8821@gmail.com', name: 'Hamza Memon' },
        { email: 'krunalijar@gmail.com', name: 'Krunal Ijar' },
        { email: 'checkingm13@gmail.com', name: 'Checking M13' }
      ].map(t => ({
        ...t,
        paper_title: sample.paper_title || 'Research Article',
        affiliation: sample.affiliation || 'Department of Research'
      })) : [];

      // Ensure test contacts exist in contactIdMap
      for (const t of testRecipients) {
        if (!contactIdMap.has(t.email)) {
          const row = contactUpsert.get(t.email, t.name, t.paper_title, t.affiliation);
          contactIdMap.set(t.email, row.id);
        }
      }

      const batchSlice = [...testRecipients, ...rawSlice];
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
        customIntervalMs,
        parentCampaignId,
        1, // is_batch = 1 (Child Sub-Batch)
        campaignCategory
      );
      const campaignId = campRes.lastInsertRowid;

      for (let cIdx = 0; cIdx < batchSlice.length; cIdx++) {
        const c = batchSlice[cIdx];
        const contactId = contactIdMap.get(c.email) || null;

        // Choose template: PER_EMAIL rotates round-robin per recipient; PER_BATCH rotates per batch
        const assignedTemplate = templateRotationStrategy === 'PER_EMAIL'
          ? activeTemplates[(i * numericBatchSize + cIdx) % activeTemplates.length]
          : batchPrimaryTemplate;

        const renderedSubject = renderTemplate(assignedTemplate.subject, { ...c, _index: cIdx }, true);
        const renderedBody = renderTemplate(assignedTemplate.body_html, { ...c, _index: cIdx }, false);
        queueInsert.run(campaignId, contactId, c.email, c.name || '', renderedSubject, renderedBody, batchScheduledAt, assignedTemplate.id);
      }

      db.prepare(`
        INSERT INTO logs (campaign_id, level, message)
        VALUES (?, 'INFO', ?)
      `).run(campaignId, `Auto-split batch "${batchName}" created with ${batchSlice.length} recipients (Template rotation: ${activeTemplates.length} templates, mode: ${templateRotationStrategy}).`);

      createdCampaigns.push({
        campaignId,
        parentId: parentCampaignId,
        name: batchName,
        status: initialStatus,
        scheduledAt: batchScheduledAt,
        count: batchSlice.length
      });
    }

    return { parentCampaignId, baseCampaignName, createdCampaigns };
  });

  const launchResult = launchTx();
  res.json({
    ok: true,
    message: `Successfully created Master Campaign "${launchResult.baseCampaignName}" across ${launchResult.createdCampaigns.length} batch(es) for ${filteredContacts.length} recipients!`,
    parentCampaignId: launchResult.parentCampaignId,
    totalCampaigns: launchResult.createdCampaigns.length,
    totalQueued: filteredContacts.length,
    scheduleMode,
    campaigns: launchResult.createdCampaigns
  });
});

// BULK ACTIONS FOR CAMPAIGNS (Pause, Resume, Cancel All)
router.post('/campaigns/bulk-action', (req, res) => {
  const { campaignIds, action } = req.body; // action: 'PAUSED', 'RESUMED', or 'CANCELLED'
  if (!Array.isArray(campaignIds) || campaignIds.length === 0) {
    return res.status(400).json({ ok: false, error: 'Invalid or empty campaign IDs array' });
  }

  const validActions = ['PAUSED', 'RESUMED', 'CANCELLED'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ ok: false, error: 'Action must be PAUSED, RESUMED, or CANCELLED' });
  }

  const placeholders = campaignIds.map(() => '?').join(',');

  try {
    const bulkTx = db.transaction(() => {
      if (action === 'CANCELLED') {
        db.prepare(`
          UPDATE queue 
          SET status = 'failed', last_error = 'Cancelled via bulk action' 
          WHERE campaign_id IN (${placeholders}) AND status IN ('queued', 'sending')
        `).run(...campaignIds);

        db.prepare(`
          UPDATE campaigns 
          SET status = 'CANCELLED', completed_at = datetime('now', '+330 minutes') 
          WHERE id IN (${placeholders})
        `).run(...campaignIds);
      } else if (action === 'PAUSED') {
        db.prepare(`
          UPDATE campaigns 
          SET status = 'PAUSED' 
          WHERE id IN (${placeholders}) AND status NOT IN ('COMPLETED', 'CANCELLED')
        `).run(...campaignIds);
      } else if (action === 'RESUMED') {
        db.prepare(`
          UPDATE campaigns 
          SET status = CASE WHEN started_at IS NOT NULL THEN 'RUNNING' ELSE 'QUEUED' END 
          WHERE id IN (${placeholders}) AND status = 'PAUSED'
        `).run(...campaignIds);
      }
    });

    bulkTx();
    res.json({ ok: true, message: `Successfully applied ${action} across ${campaignIds.length} campaign(s).` });
  } catch (err) {
    console.error('Bulk action error:', err);
    res.status(500).json({ ok: false, error: 'Failed to execute bulk action: ' + err.message });
  }
});

// INSTANT TRIGGER: SEND NOW (Move scheduled/queued campaign to immediate dispatch)
router.post('/campaigns/:id/send-now', (req, res) => {
  const campId = parseInt(req.params.id, 10);
  const camp = db.prepare('SELECT id, name, status, parent_id FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  try {
    // 1. Find all target campaigns (self, children by parent_id, or children by name pattern)
    const targetIds = [camp.id];
    const children = db.prepare('SELECT id FROM campaigns WHERE parent_id = ?').all(camp.id);
    for (const ch of children) {
      if (!targetIds.includes(ch.id)) targetIds.push(ch.id);
    }
    const prefixChildren = db.prepare('SELECT id FROM campaigns WHERE name LIKE ?').all(`${camp.name}_Batch_%`);
    for (const ch of prefixChildren) {
      if (!targetIds.includes(ch.id)) targetIds.push(ch.id);
    }

    const placeholders = targetIds.map(() => '?').join(',');

    const triggerTx = db.transaction(() => {
      // Re-queue any unsent items with immediate priority (NULL scheduled_at)
      db.prepare(`
        UPDATE queue 
        SET status = 'queued',
            scheduled_at = NULL,
            account_id = NULL
        WHERE campaign_id IN (${placeholders}) 
          AND (status IN ('queued', 'sending') OR (status = 'failed' AND attempts < 3))
      `).run(...targetIds);

      // Mark target campaigns RUNNING immediately
      db.prepare(`
        UPDATE campaigns 
        SET status = 'RUNNING',
            started_at = COALESCE(started_at, datetime('now', '+330 minutes')),
            scheduled_at = NULL
        WHERE id IN (${placeholders}) AND status NOT IN ('COMPLETED')
      `).run(...targetIds);

      try {
        db.prepare(`
          INSERT INTO logs (campaign_id, level, message)
          VALUES (?, 'INFO', ?)
        `).run(camp.id, `⚡ Send Now: Instant parallel dispatch initiated for ${targetIds.length} campaign batch(es).`);
      } catch (_) {}
    });

    triggerTx();

    // 2. Trigger instant parallel dispatch in worker
    queueWorker.triggerInstantSend(targetIds);

    const pendingCount = db.prepare(`
      SELECT COUNT(*) as total FROM queue WHERE campaign_id IN (${placeholders}) AND status = 'queued'
    `).get(...targetIds).total;

    res.json({
      ok: true,
      message: `⚡ Instant parallel dispatch started! ${pendingCount} email(s) across ${targetIds.length} batch(es) sending right now!`,
      targetCampaignIds: targetIds,
      pendingCount
    });
  } catch (err) {
    console.error('[SendNow API] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// RESCHEDULE CAMPAIGN (Only allowed in pre-dispatch SCHEDULED or QUEUED phase)
router.post('/campaigns/:id/reschedule', (req, res) => {
  const campId = parseInt(req.params.id, 10);
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  // Strictly allow rescheduling ONLY for 'SCHEDULED' and 'QUEUED' campaigns
  if (!['SCHEDULED', 'QUEUED'].includes(camp.status)) {
    return res.status(400).json({
      ok: false,
      error: `Cannot reschedule campaign with status '${camp.status}'. Only SCHEDULED or QUEUED campaigns can be rescheduled.`
    });
  }

  const { scheduledTime } = req.body;
  if (!scheduledTime) {
    return res.status(400).json({ ok: false, error: 'Please provide a valid scheduledTime.' });
  }

  const parsedDate = parseIST(scheduledTime);
  const newScheduledMs = parsedDate ? parsedDate.getTime() : NaN;
  if (isNaN(newScheduledMs)) {
    return res.status(400).json({ ok: false, error: 'Invalid scheduled date/time provided.' });
  }

  // Must be in the future (at least 5 seconds ahead)
  if (newScheduledMs <= Date.now() + 5000) {
    return res.status(400).json({ ok: false, error: 'Scheduled time must be in the future (Indian Standard Time).' });
  }

  const newSqliteTime = formatSqliteDateTime(new Date(newScheduledMs));

  try {
    const rescheduleTx = db.transaction(() => {
      // 1. Check if this is a master campaign with child batches
      const children = db.prepare(`
        SELECT * FROM campaigns 
        WHERE (parent_id = ? OR name LIKE ?) 
          AND id != ? 
          AND status IN ('SCHEDULED', 'QUEUED')
        ORDER BY scheduled_at ASC, id ASC
      `).all(camp.id, `${camp.name}_Batch_%`, camp.id);

      if (children.length > 0) {
        // Master Campaign: Shift all pending child batches proportionally from the new start time
        const originalBaseDate = parseIST(camp.scheduled_at);
        const originalBaseMs = originalBaseDate ? originalBaseDate.getTime() : Date.now();
        const diffMs = newScheduledMs - originalBaseMs;

        // Update master campaign
        db.prepare(`
          UPDATE campaigns
          SET scheduled_at = ?,
              status = 'SCHEDULED'
          WHERE id = ?
        `).run(newSqliteTime, camp.id);

        // Shift each pending child batch
        for (const child of children) {
          let childNewMs = newScheduledMs;
          if (child.scheduled_at) {
            const childOldDate = parseIST(child.scheduled_at);
            const childOldMs = childOldDate ? childOldDate.getTime() : originalBaseMs;
            childNewMs = childOldMs + diffMs;
          }
          if (childNewMs < newScheduledMs) childNewMs = newScheduledMs;
          const childSqlTime = formatSqliteDateTime(new Date(childNewMs));

          db.prepare(`
            UPDATE campaigns
            SET scheduled_at = ?,
                status = 'SCHEDULED'
            WHERE id = ?
          `).run(childSqlTime, child.id);

          db.prepare(`
            UPDATE queue
            SET scheduled_at = ?
            WHERE campaign_id = ? AND status = 'queued'
          `).run(childSqlTime, child.id);
        }

        // Also update any direct queue items on the parent
        db.prepare(`
          UPDATE queue
          SET scheduled_at = ?
          WHERE campaign_id = ? AND status = 'queued'
        `).run(newSqliteTime, camp.id);

        db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'INFO', ?)")
          .run(camp.id, `⏰ Rescheduled: Master campaign and ${children.length} batch(es) shifted to start at ${toISTString(new Date(newScheduledMs))} IST.`);

      } else {
        // Single campaign or individual batch
        db.prepare(`
          UPDATE campaigns
          SET scheduled_at = ?,
              status = 'SCHEDULED'
          WHERE id = ?
        `).run(newSqliteTime, camp.id);

        db.prepare(`
          UPDATE queue
          SET scheduled_at = ?
          WHERE campaign_id = ? AND status = 'queued'
        `).run(newSqliteTime, camp.id);

        db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'INFO', ?)")
          .run(camp.id, `⏰ Rescheduled: Campaign "${camp.name}" rescheduled to ${toISTString(new Date(newScheduledMs))} IST.`);
      }
    });

    rescheduleTx();

    res.json({
      ok: true,
      message: `Campaign "${camp.name}" successfully rescheduled to ${toISTString(new Date(newScheduledMs))} IST!`,
      scheduledAt: newSqliteTime,
      scheduledAtIST: toISTString(new Date(newScheduledMs))
    });
  } catch (err) {
    console.error('[Reschedule API] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. CAMPAIGN CONTROLS: PAUSE, RESUME, CANCEL, CLONE
router.post('/campaigns/:id/pause', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  if (camp.status !== 'RUNNING' && camp.status !== 'QUEUED') {
    return res.status(400).json({ ok: false, error: `Cannot pause campaign with status ${camp.status}` });
  }

  db.prepare("UPDATE campaigns SET status = 'PAUSED' WHERE id = ? OR parent_id = ?").run(campId, campId);
  db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'INFO', ?)").run(campId, `Campaign "${camp.name}" paused.`);
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
  db.prepare("UPDATE campaigns SET status = ? WHERE id = ? OR parent_id = ?").run(nextStatus, campId, campId);
  db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'INFO', ?)").run(campId, `Campaign "${camp.name}" resumed.`);
  res.json({ ok: true, message: `Campaign "${camp.name}" resumed.` });
});

router.post('/campaigns/:id/cancel', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  const cancelTx = db.transaction(() => {
    db.prepare("UPDATE campaigns SET status = 'CANCELLED', completed_at = datetime('now', '+330 minutes') WHERE id = ? OR parent_id = ?").run(campId, campId);
    db.prepare("UPDATE queue SET status = 'failed', last_error = 'Cancelled by user' WHERE (campaign_id = ? OR campaign_id IN (SELECT id FROM campaigns WHERE parent_id = ?)) AND status IN ('queued', 'sending')").run(campId, campId);
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
      const renderedSubject = renderTemplate(assignedTemplate.subject, { ...cObj, email: it.email, _index: cIdx }, true);
      const renderedBody = renderTemplate(assignedTemplate.body_html, { ...cObj, email: it.email, _index: cIdx }, false);
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

  const rawContent = bodyHtml || `<div style="font-family: sans-serif; padding: 20px;">
    <h2>✅ Test Email Delivery</h2>
    <p>Hello <b>${name}</b>,</p>
    <p>Dispatched via <b>${account.email}</b> (${account.provider})</p>
  </div>`;

  const content = renderTemplate(rawContent, {
    sender_email: account.email,
    email: toEmail.trim(),
    name
  }, false);

  const finalSubject = renderTemplate(subject, {
    sender_email: account.email,
    email: toEmail.trim(),
    name
  }, true);

  try {
    const { sendViaGraph } = require('../services/graphMailer');
    const { sendViaACS } = require('../services/acsMailer');
    const { sendViaOCI } = require('../services/ociMailer');
    const { sendViaMailgun } = require('../services/mailgunMailer');

    const dispatchAction = async () => {
      if (account.provider === 'AZURE_ACS') {
        return await sendViaACS({
          fromEmail: account.email,
          toEmail: toEmail.trim(),
          subject: finalSubject,
          htmlBody: content
        });
      } else if (account.provider === 'OCI') {
        return await sendViaOCI({
          fromEmail: account.email,
          toEmail: toEmail.trim(),
          subject: finalSubject,
          htmlBody: content,
          region: account.oci_region || 'auto'
        });
      } else if (account.provider === 'MAILGUN') {
        return await sendViaMailgun({
          fromEmail: account.email,
          toEmail: toEmail.trim(),
          subject: finalSubject,
          htmlBody: content
        });
      } else {
        return await sendViaGraph({
          fromEmail: account.email,
          toEmail: toEmail.trim(),
          subject: finalSubject,
          htmlBody: content
        });
      }
    };

    // Fast 7-second hard limit for test dispatch
    await Promise.race([
      dispatchAction(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Test dispatch timed out after 7s via ${account.email} (${account.provider}). Check credentials or provider connection.`)), 7000)
      )
    ]);

    AccountPool.recordSendSuccess(account.id);

    // Record success in logs table
    try {
      db.prepare(`
        INSERT INTO logs (account_id, level, message)
        VALUES (?, 'INFO', ?)
      `).run(account.id, `✅ Quick Test Email delivered to "${toEmail.trim()}" via ${account.email} (${account.provider})`);
    } catch (_) {}

    res.json({ ok: true, message: `Test email dispatched to ${toEmail} via ${account.email} (${account.provider}).` });
  } catch (err) {
    const errorDetail = err.message || 'Unknown provider error';
    console.error(`[QuickTest] ❌ Failed to send to "${toEmail}" via ${account.email}:`, errorDetail);

    // Record detailed failure in DB logs table so it is visible in Audit Logs tab
    try {
      db.prepare(`
        INSERT INTO logs (account_id, level, message)
        VALUES (?, 'ERROR', ?)
      `).run(account.id, `❌ Quick Test to "${toEmail.trim()}" FAILED via ${account.email} (${account.provider}): ${errorDetail}`);
    } catch (_) {}

    res.status(500).json({
      ok: false,
      error: errorDetail,
      provider: account.provider,
      senderEmail: account.email
    });
  }
});

// ==========================================
// 🖼️ OCI Object Storage Image / Poster Upload
// ==========================================
router.post('/upload-image', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No image file provided in "image" field.' });
    }

    const mime = (req.file.mimetype || '').toLowerCase();
    if (!mime.startsWith('image/')) {
      return res.status(400).json({ ok: false, error: `Invalid file type (${mime}). Only images are allowed.` });
    }

    const uploadResult = await storageService.uploadToOCI(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    res.json({
      ok: true,
      url: uploadResult.url,
      key: uploadResult.key,
      filename: req.file.originalname,
      size: req.file.size
    });
  } catch (err) {
    console.error('[UploadImage] Error uploading to OCI Object Storage:', err);
    res.status(500).json({
      ok: false,
      error: err.message || 'Failed to upload image to OCI Object Storage'
    });
  }
});

module.exports = router;