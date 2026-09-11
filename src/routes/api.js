/**
 * REST API Routes for Multi-Account Mailer Engine
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
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

const upload = multer({ dest: 'uploads/' });

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

// 2. WORKER CONTROLS
router.post('/worker/pause', (req, res) => {
  queueWorker.pause();
  res.json({ ok: true, message: 'Worker paused' });
});

router.post('/worker/resume', (req, res) => {
  queueWorker.resume();
  res.json({ ok: true, message: 'Worker resumed' });
});

// 3. ACCOUNT POOL MANAGEMENT (1 to 40+ Accounts)
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
  // Check if template exists
  const existing = db.prepare('SELECT id FROM templates WHERE id = ?').get(tplId);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Template not found.' });
  }

  // Check if any campaign is currently using it
  const activeCamp = db.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE template_id = ? AND status IN ('QUEUED', 'RUNNING')").get(tplId);
  if (activeCamp.count > 0) {
    return res.status(400).json({ ok: false, error: 'Cannot delete template while active campaigns are using it.' });
  }

  db.prepare('DELETE FROM templates WHERE id = ?').run(tplId);
  res.json({ ok: true, message: 'Template deleted successfully.' });
});

// 5. CONTACTS & CSV IMPORT
router.get('/contacts', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY id DESC LIMIT ?').all(limit);
  const total = db.prepare('SELECT COUNT(*) AS total FROM contacts').get().total;
  res.json({ ok: true, total, contacts });
});

router.post('/contacts/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No Excel or CSV file uploaded.' });
  }

  const filePath = req.file.path;
  const originalName = (req.file.originalname || '').toLowerCase();

  try {
    let rows = [];

    // Parse Excel (.xlsx, .xls) or CSV
    const workbook = XLSX.readFile(filePath, { raw: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      return res.status(400).json({ ok: false, error: 'The uploaded file does not contain any sheets.' });
    }

    const sheet = workbook.Sheets[firstSheetName];
    rows = XLSX.utils.sheet_to_json(sheet);

    try { fs.unlinkSync(filePath); } catch (_) {}

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
        // Find email column flexibly (Email, email, E-mail, Contact Email, etc.)
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
    try { fs.unlinkSync(filePath); } catch (_) {}
    console.error('File parsing error:', err);
    res.status(500).json({ ok: false, error: 'File parsing error: ' + err.message });
  }
});

// 6. CAMPAIGN CREATION & BATCH QUEUING
router.get('/campaigns', (req, res) => {
  const campaigns = db.prepare(`
    SELECT c.*, t.name AS template_name, a.email AS sender_email, a.provider AS sender_provider
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
    SELECT id, email, name, subject, status, attempts, last_error, sent_at
    FROM queue
    WHERE campaign_id = ?
    ORDER BY id ASC
    LIMIT 100
  `).all(campId);

  res.json({
    ok: true,
    campaign: camp,
    summary,
    sampleItems
  });
});

router.post('/campaigns/create', (req, res) => {
  const { name, templateId, contactIds, sendToAllActive = false } = req.body;

  if (!name || !templateId) {
    return res.status(400).json({ ok: false, error: 'Campaign name and templateId are required.' });
  }

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
  if (!template) {
    return res.status(404).json({ ok: false, error: 'Template not found.' });
  }

  // Fetch target contacts
  let contacts = [];
  if (sendToAllActive) {
    contacts = db.prepare("SELECT * FROM contacts WHERE status = 'ACTIVE'").all();
  } else if (Array.isArray(contactIds) && contactIds.length > 0) {
    const placeholders = contactIds.map(() => '?').join(',');
    contacts = db.prepare(`SELECT * FROM contacts WHERE id IN (${placeholders})`).all(...contactIds);
  } else {
    // Default to last 500 contacts
    contacts = db.prepare("SELECT * FROM contacts WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 500").all();
  }

  if (contacts.length === 0) {
    return res.status(400).json({ ok: false, error: 'No active contacts found for campaign.' });
  }

  const createCampaignTx = db.transaction(() => {
    // 1. Create Campaign
    const campRes = db.prepare(`
      INSERT INTO campaigns (name, template_id, status, total_count)
      VALUES (?, ?, 'QUEUED', ?)
    `).run(name, templateId, contacts.length);

    const campaignId = campRes.lastInsertRowid;

    // 2. Populate Queue with pre-rendered templates
    const queueStmt = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status)
      VALUES (?, ?, ?, ?, ?, ?, 'queued')
    `);

    for (const c of contacts) {
      const renderedSub = renderTemplate(template.subject, c);
      const renderedBody = renderTemplate(template.body_html, c);
      queueStmt.run(campaignId, c.id, c.email, c.name, renderedSub, renderedBody);
    }

    db.prepare(`
      INSERT INTO logs (campaign_id, level, message)
      VALUES (?, 'INFO', ?)
    `).run(campaignId, `Campaign "${name}" created with ${contacts.length} recipients queued for multi-account dispatch.`);

    return campaignId;
  });

  const campaignId = createCampaignTx();
  res.json({ ok: true, campaignId, totalQueued: contacts.length });
});

// PRE-FLIGHT CSV/EXCEL PREVIEW & AUTO-SPLIT CALCULATION
router.post('/campaigns/preview-upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No CSV or spreadsheet file uploaded.' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname || 'campaign_upload.csv';
  const baseCampaignName = originalName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const batchSize = Math.max(1, parseInt(req.body.batchSize || '50', 10));

  try {
    const workbook = XLSX.readFile(filePath, { raw: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      try { fs.unlinkSync(filePath); } catch (_) {}
      return res.status(400).json({ ok: false, error: 'Uploaded file has no data sheets.' });
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    try { fs.unlinkSync(filePath); } catch (_) {}

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const seenEmails = new Set();
    const validContacts = [];
    let invalidCount = 0;
    let duplicateInSheetCount = 0;

    // Prepare statement to check previous campaign contact history
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

      // Check history in database
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

    // Scheduling configuration & projection
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

    // Calculate auto-split batches with timeline projection
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

      const durationSeconds = Math.round(batchContacts.length * (config.globalSendIntervalMs / 1000));
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
    try { fs.unlinkSync(filePath); } catch (_) {}
    console.error('Preview error:', err);
    res.status(500).json({ ok: false, error: 'Error generating preview: ' + err.message });
  }
});

// LAUNCH AUTO-SPLIT BATCHES SEQUENTIALLY OR SCHEDULED
router.post('/campaigns/launch-batches', (req, res) => {
  const {
    baseCampaignName,
    templateId,
    batchSize = 50,
    skipPreviouslyContacted = false,
    scheduleMode = 'immediate',
    scheduledStartTime = '',
    staggerMinutes = 60,
    contacts = [],
    senderAccountId = null
  } = req.body;

  if (!baseCampaignName || !templateId) {
    return res.status(400).json({ ok: false, error: 'baseCampaignName and templateId are required.' });
  }

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
  if (!template) {
    return res.status(404).json({ ok: false, error: 'Template not found.' });
  }

  const parsedSenderAccountId = senderAccountId ? parseInt(senderAccountId, 10) : null;

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ ok: false, error: 'No contacts provided to launch.' });
  }

  // Filter out previously contacted if user checked the box
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
    // 1. Ensure all contacts are persisted into master contacts table (Zero Duplicates)
    const contactUpsert = db.prepare(`
      INSERT INTO contacts (email, name, paper_title, affiliation)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        paper_title = CASE WHEN excluded.paper_title != '' THEN excluded.paper_title ELSE contacts.paper_title END,
        affiliation = CASE WHEN excluded.affiliation != '' THEN excluded.affiliation ELSE contacts.affiliation END
      RETURNING id
    `);

    // Prepare map of email -> contact_id
    const contactIdMap = new Map();
    for (const c of filteredContacts) {
      const row = contactUpsert.get(c.email, c.name || '', c.paper_title || '', c.affiliation || '');
      contactIdMap.set(c.email, row.id);
    }

    // 2. Split into batches
    const totalBatches = Math.ceil(filteredContacts.length / numericBatchSize);
    const createdCampaigns = [];

    const campInsert = db.prepare(`
      INSERT INTO campaigns (name, template_id, status, total_count, scheduled_at, sender_account_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const queueInsert = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
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

      const campRes = campInsert.run(batchName, templateId, initialStatus, batchSlice.length, batchScheduledAt, parsedSenderAccountId);
      const campaignId = campRes.lastInsertRowid;

      for (const c of batchSlice) {
        const contactId = contactIdMap.get(c.email) || null;
        const renderedSubject = renderTemplate(template.subject, c);
        const renderedBody = renderTemplate(template.body_html, c);
        queueInsert.run(campaignId, contactId, c.email, c.name || '', renderedSubject, renderedBody, batchScheduledAt);
      }

      db.prepare(`
        INSERT INTO logs (campaign_id, level, message)
        VALUES (?, 'INFO', ?)
      `).run(campaignId, `Auto-split batch "${batchName}" created with ${batchSlice.length} recipients. Mode: ${scheduleMode}, Scheduled: ${batchScheduledAt}.`);

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

// 6B. CAMPAIGN CONTROLS: PAUSE, RESUME, CANCEL & MONITOR
router.post('/campaigns/:id/pause', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  if (camp.status === 'COMPLETED' || camp.status === 'CANCELLED') {
    return res.status(400).json({ ok: false, error: `Cannot pause a ${camp.status} campaign.` });
  }

  db.prepare("UPDATE campaigns SET status = 'PAUSED' WHERE id = ?").run(campId);
  db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'WARN', ?)").run(campId, `Campaign "${camp.name}" paused by user.`);
  res.json({ ok: true, message: `Campaign "${camp.name}" paused successfully.` });
});

router.post('/campaigns/:id/resume', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  if (camp.status !== 'PAUSED') {
    return res.status(400).json({ ok: false, error: `Campaign is not paused (status: ${camp.status}).` });
  }

  const nextStatus = camp.started_at ? 'RUNNING' : 'QUEUED';
  db.prepare("UPDATE campaigns SET status = ? WHERE id = ?").run(nextStatus, campId);
  db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'INFO', ?)").run(campId, `Campaign "${camp.name}" resumed successfully.`);
  res.json({ ok: true, message: `Campaign "${camp.name}" resumed successfully.` });
});

router.post('/campaigns/:id/cancel', (req, res) => {
  const campId = req.params.id;
  const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!camp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  if (camp.status === 'COMPLETED') {
    return res.status(400).json({ ok: false, error: 'Cannot cancel a completed campaign.' });
  }

  const cancelTx = db.transaction(() => {
    db.prepare("UPDATE campaigns SET status = 'CANCELLED', completed_at = datetime('now') WHERE id = ?").run(campId);
    db.prepare("UPDATE queue SET status = 'failed', last_error = 'Cancelled by user' WHERE campaign_id = ? AND status = 'queued'").run(campId);
    db.prepare("INSERT INTO logs (campaign_id, level, message) VALUES (?, 'WARN', ?)").run(campId, `Campaign "${camp.name}" cancelled by user.`);
  });

  cancelTx();
  res.json({ ok: true, message: `Campaign "${camp.name}" cancelled successfully.` });
});

// 6C. CLONE / RE-RUN CAMPAIGN (Re-use existing campaign audience)
router.post('/campaigns/:id/clone', (req, res) => {
  const campId = req.params.id;
  const { newName, templateId, mode = 'all', senderAccountId = null } = req.body || {};

  const origCamp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campId);
  if (!origCamp) return res.status(404).json({ ok: false, error: 'Campaign not found' });

  const targetTemplateId = templateId || origCamp.template_id;
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(targetTemplateId);
  if (!template) return res.status(404).json({ ok: false, error: 'Template not found' });

  const targetSenderAccountId = senderAccountId !== undefined 
    ? (senderAccountId ? parseInt(senderAccountId, 10) : null)
    : origCamp.sender_account_id;

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
    : `${origCamp.name}_Rerun_${Date.now().toString().slice(-4)}`;

  const nowSql = formatSqliteDateTime(new Date());

  const cloneTx = db.transaction(() => {
    const campRes = db.prepare(`
      INSERT INTO campaigns (name, template_id, status, total_count, scheduled_at, sender_account_id)
      VALUES (?, ?, 'QUEUED', ?, ?, ?)
    `).run(campaignName, targetTemplateId, uniqueItems.length, nowSql, targetSenderAccountId);

    const newCampId = campRes.lastInsertRowid;

    const queueInsert = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status, scheduled_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
    `);

    for (const it of uniqueItems) {
      const contact = db.prepare('SELECT id, paper_title, affiliation FROM contacts WHERE email = ?').get(it.email);
      const cObj = {
        name: it.name || '',
        paper_title: contact?.paper_title || '',
        affiliation: contact?.affiliation || ''
      };
      const renderedSubject = renderTemplate(template.subject, cObj);
      const renderedBody = renderTemplate(template.body_html, cObj);
      queueInsert.run(newCampId, contact?.id || null, it.email, it.name || '', renderedSubject, renderedBody, nowSql);
    }

    db.prepare(`
      INSERT INTO logs (campaign_id, level, message)
      VALUES (?, 'INFO', ?)
    `).run(newCampId, `Campaign "${campaignName}" created via Re-run/Clone of Campaign #${campId} (${uniqueItems.length} recipients).`);

    return { newCampId, campaignName, count: uniqueItems.length };
  });

  const result = cloneTx();
  res.json({
    ok: true,
    message: `Campaign "${result.campaignName}" cloned successfully with ${result.count} recipients queued!`,
    campaignId: result.newCampId,
    name: result.campaignName,
    totalQueued: result.count
  });
});

router.get('/campaigns/active-monitor', (req, res) => {
  const status = queueWorker.getStatus();
  res.json({
    ok: true,
    activeCampaign: status.activeCampaign,
    upcomingCampaigns: status.upcomingCampaigns,
    queue: status.queue,
    workerRunning: status.isRunning,
    workerPaused: status.isPaused
  });
});

// 7. AUDIT LOGS
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

// 8. QUICK TEST EMAIL DISPATCH
router.post('/send-test', async (req, res) => {
  const { toEmail, name = 'Test Recipient', subject = '✅ Test Email from Azure Mailer', bodyHtml, senderAccountId = null } = req.body;
  if (!toEmail || !toEmail.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Valid recipient email address is required.' });
  }

  const account = AccountPool.getAvailableAccount(senderAccountId ? parseInt(senderAccountId, 10) : null);
  if (!account) {
    return res.status(503).json({ ok: false, error: 'Selected sender account is unavailable (in cooldown or daily quota reached).' });
  }

  const content = bodyHtml || `<div style="font-family: sans-serif; padding: 20px; line-height: 1.6; color: #1e293b;">
    <h2 style="color: #0284c7; margin-top: 0;">✅ Test Email Delivery</h2>
    <p>Hello <b>${name}</b>,</p>
    <p>This is a real-time verification email dispatched from your <b>Azure Multi-Account Mailer</b>.</p>
    <table style="border-collapse: collapse; width: 100%; max-width: 480px; margin: 16px 0; background: #f8fafc; border-radius: 6px; overflow: hidden;">
      <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold; width: 140px;">Sender Account:</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${account.email}</td></tr>
      <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Provider:</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${account.provider}</td></tr>
      <tr><td style="padding: 10px; border: 1px solid #e2e8f0; font-weight: bold;">Timestamp:</td><td style="padding: 10px; border: 1px solid #e2e8f0;">${new Date().toISOString()}</td></tr>
    </table>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
    <p style="font-size: 12px; color: #64748b;">Journal Paripex - Automated Production Delivery Engine</p>
  </div>`;

  try {
    const { sendViaGraph } = require('../services/graphMailer');
    const { sendViaACS } = require('../services/acsMailer');

    if (account.provider === 'AZURE_ACS') {
      await sendViaACS({
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
    db.prepare("INSERT INTO logs (account_id, level, message) VALUES (?, 'INFO', ?)").run(
      account.id,
      `Quick test email dispatched to "${toEmail}" via ${account.email}`
    );

    res.json({ ok: true, message: `Test email dispatched to ${toEmail} via ${account.email}.` });
  } catch (err) {
    db.prepare("INSERT INTO logs (account_id, level, message) VALUES (?, 'ERROR', ?)").run(
      account.id,
      `Failed to dispatch test email to "${toEmail}": ${err.message}`
    );
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
