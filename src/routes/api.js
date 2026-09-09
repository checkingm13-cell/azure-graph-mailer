/**
 * REST API Routes for Multi-Account Mailer Engine
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
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

// 5. CONTACTS & CSV IMPORT
router.get('/contacts', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY id DESC LIMIT ?').all(limit);
  const total = db.prepare('SELECT COUNT(*) AS total FROM contacts').get().total;
  res.json({ ok: true, total, contacts });
});

router.post('/contacts/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: 'No CSV file uploaded.' });
  }

  const results = [];
  const filePath = req.file.path;

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', () => {
      fs.unlinkSync(filePath); // Clean up upload

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

      const insertMany = db.transaction((rows) => {
        for (const r of rows) {
          // Find email column flexibly (Email, email, E-mail, Contact Email)
          const emailKey = Object.keys(r).find((k) => /^email$/i.test(k.trim())) ||
            Object.keys(r).find((k) => /email/i.test(k));
          const nameKey = Object.keys(r).find((k) => /^name$/i.test(k.trim())) ||
            Object.keys(r).find((k) => /name|author/i.test(k));
          const titleKey = Object.keys(r).find((k) => /title|paper|article/i.test(k));
          const affilKey = Object.keys(r).find((k) => /affil|univ|org/i.test(k));

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

      insertMany(results);
      res.json({ ok: true, imported, skipped, totalParsed: results.length });
    })
    .on('error', (err) => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      res.status(500).json({ ok: false, error: 'CSV parsing error: ' + err.message });
    });
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
