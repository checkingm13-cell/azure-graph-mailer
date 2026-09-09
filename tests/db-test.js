/**
 * Database & Queue Pipeline Integrity Test
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Use an isolated test database
process.env.DB_PATH = path.resolve(__dirname, '../data/test_mailer.db');

const db = require('../src/db');
const { renderTemplate } = require('../src/services/templateEngine');

console.log('--- Testing Database WAL & Transaction Integrity ---');

// 1. Clean test DB
db.exec("DELETE FROM queue; DELETE FROM campaigns; DELETE FROM contacts; DELETE FROM templates;");

// 2. Insert Contact
const contactStmt = db.prepare(`
  INSERT INTO contacts (email, name, paper_title, affiliation)
  VALUES (?, ?, ?, ?)
`);
const cRes = contactStmt.run('author.test@university.edu', 'John Test', 'Quantum Neural Networks', 'MIT');
assert.strictEqual(cRes.changes, 1, 'Failed to insert contact');

// 3. Insert Template
const tplStmt = db.prepare(`
  INSERT INTO templates (name, subject, body_html)
  VALUES (?, ?, ?)
`);
const tRes = tplStmt.run('Test CFP', 'Call for Papers: {{Paper Title}}', '<p>Dear Dr. {{Name}}, submit to {{Paper Title}}</p>');
assert.strictEqual(tRes.changes, 1, 'Failed to insert template');

// 4. Test Template Engine
const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(cRes.lastInsertRowid);
const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(tRes.lastInsertRowid);

const renderedSub = renderTemplate(template.subject, contact);
const renderedBody = renderTemplate(template.body_html, contact);

assert.strictEqual(renderedSub, 'Call for Papers: Quantum Neural Networks', 'Template subject failed rendering');
assert.ok(renderedBody.includes('Dear Dr. John Test'), 'Template body name replacement failed');
assert.ok(renderedBody.includes('submit to Quantum Neural Networks'), 'Template body title replacement failed');

// 5. Test Transaction Queue Insertion
const createCampaignTx = db.transaction(() => {
  const camp = db.prepare("INSERT INTO campaigns (name, template_id, total_count) VALUES (?, ?, 1)").run('Test Camp', template.id);
  db.prepare(`
    INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status)
    VALUES (?, ?, ?, ?, ?, ?, 'queued')
  `).run(camp.lastInsertRowid, contact.id, contact.email, contact.name, renderedSub, renderedBody);
  return camp.lastInsertRowid;
});

const campId = createCampaignTx();
assert.ok(campId > 0, 'Transaction failed to return campaign ID');

// 6. Verify Queue Row
const queuedItem = db.prepare("SELECT * FROM queue WHERE campaign_id = ? AND status = 'queued'").get(campId);
assert.strictEqual(queuedItem.email, 'author.test@university.edu', 'Queue item email mismatch');

console.log('✅ ALL DATABASE & TRANSACTION TESTS PASSED CLEANLY!');

// Clean up test DB file
try {
  fs.unlinkSync(process.env.DB_PATH);
} catch (_) {}
