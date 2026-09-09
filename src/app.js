/**
 * Main Express Application Server & Process Lifecycle
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config/env');
const db = require('./db');
const AccountPool = require('./services/accountPool');
const queueWorker = require('./services/queueWorker');
const apiRoutes = require('./routes/api');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static frontend dashboard
app.use(express.static(path.resolve(__dirname, '../public')));

// Mount API routes
app.use('/api', apiRoutes);

// Seed default sender account if pool is empty
function seedDefaultAccount() {
  const count = db.prepare('SELECT COUNT(*) AS total FROM accounts').get().total;
  if (count === 0 && config.defaultSenderEmail) {
    console.log(`[Bootstrap] Seeding initial default sender account: ${config.defaultSenderEmail}`);
    AccountPool.upsertAccount({
      email: config.defaultSenderEmail,
      displayName: 'Default Journal Sender',
      provider: config.defaultProvider,
      dailyLimit: config.defaultAccountDailyLimit,
      cooldownSeconds: config.accountCooldownSeconds
    });
  }
}

// Seed default template if templates empty
function seedDefaultTemplate() {
  const count = db.prepare('SELECT COUNT(*) AS total FROM templates').get().total;
  if (count === 0) {
    console.log('[Bootstrap] Seeding default Call For Papers template...');
    db.prepare(`
      INSERT INTO templates (name, subject, body_html)
      VALUES (?, ?, ?)
    `).run(
      'Default Call For Papers (CFP)',
      'Invitation for Paper Submission: {{Paper Title}} - Journal ParipEx',
      `<p>Dear Dr. {{Name}},</p>
<p>We cordially invite you to submit your latest research regarding <b>{{Paper Title}}</b> to our upcoming journal volume.</p>
<p><b>Key Features:</b></p>
<ul>
  <li>Rapid peer-review within 14 days</li>
  <li>Indexed in major academic citation indices</li>
  <li>Open Access global dissemination</li>
</ul>
<p>Please submit your manuscript online or reply directly to this email.</p>
<p>Best regards,<br/>
Editorial Office<br/>
Journal ParipEx</p>`
    );
  }
}

seedDefaultAccount();
seedDefaultTemplate();

// Start the continuous 24/7 background worker
queueWorker.start();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log('===========================================================');
  console.log(`🚀 Azure Multi-Account Mailer Engine running on port ${config.port}`);
  console.log(`🌐 Dashboard UI: http://localhost:${config.port}`);
  console.log(`📡 Environment : ${config.nodeEnv}`);
  console.log(`📁 Database    : ${config.dbPath}`);
  console.log('===========================================================');
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  queueWorker.isRunning = false;
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  queueWorker.isRunning = false;
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

module.exports = app;
