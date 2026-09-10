/**
 * REST API Routes for Multi-Account Mailer Engine
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const db = require('../db');
const AccountPool = require('../services/accountPool');
const queueWorker = require('../services/queueWorker');
const { renderTemplate } = require('../services/templateEngine');

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
    SELECT c.*, t.name AS template_name
    FROM campaigns c
    LEFT JOIN templates t ON c.template_id = t.id
    ORDER BY c.id DESC
  `).all();
  res.json({ ok: true, campaigns });
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

    // Calculate auto-split batches
    const batches = [];
    const totalBatches = Math.ceil(validContacts.length / batchSize) || 1;
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = start + batchSize;
      const batchContacts = validContacts.slice(start, end);
      const batchNumStr = String(i + 1).padStart(2, '0');
      batches.push({
        batchNumber: i + 1,
        name: `${baseCampaignName}_Batch_${batchNumStr}`,
        count: batchContacts.length
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

// LAUNCH AUTO-SPLIT BATCHES SEQUENTIALLY
router.post('/campaigns/launch-batches', (req, res) => {
  const {
    baseCampaignName,
    templateId,
    batchSize = 50,
    skipPreviouslyContacted = false,
    contacts = []
  } = req.body;

  if (!baseCampaignName || !templateId) {
    return res.status(400).json({ ok: false, error: 'baseCampaignName and templateId are required.' });
  }

  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
  if (!template) {
    return res.status(404).json({ ok: false, error: 'Template not found.' });
  }

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
      INSERT INTO campaigns (name, template_id, status, total_count)
      VALUES (?, ?, 'QUEUED', ?)
    `);

    const queueInsert = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status)
      VALUES (?, ?, ?, ?, ?, ?, 'queued')
    `);

    for (let i = 0; i < totalBatches; i++) {
      const start = i * numericBatchSize;
      const end = start + numericBatchSize;
      const batchSlice = filteredContacts.slice(start, end);
      const batchNumStr = String(i + 1).padStart(2, '0');
      const batchName = `${baseCampaignName}_Batch_${batchNumStr}`;

      const campRes = campInsert.run(batchName, templateId, batchSlice.length);
      const campaignId = campRes.lastInsertRowid;

      for (const c of batchSlice) {
        const contactId = contactIdMap.get(c.email) || null;
        const renderedSubject = renderTemplate(template.subject, c);
        const renderedBody = renderTemplate(template.body_html, c);
        queueInsert.run(campaignId, contactId, c.email, c.name || '', renderedSubject, renderedBody);
      }

      db.prepare(`
        INSERT INTO logs (campaign_id, level, message)
        VALUES (?, 'INFO', ?)
      `).run(campaignId, `Auto-split batch "${batchName}" created with ${batchSlice.length} recipients.`);

      createdCampaigns.push({
        campaignId,
        name: batchName,
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
    campaigns: createdCampaigns
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

module.exports = router;
