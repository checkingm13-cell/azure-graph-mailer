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

// Favicon handler (avoids 404 in console when browser requests favicon)
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Optional Zero-Trust API Key Authentication Middleware
const adminApiKey = process.env.ADMIN_API_KEY || '';
app.use('/api', (req, res, next) => {
  if (!adminApiKey) return next(); // Open access if no ADMIN_API_KEY set
  // Public read-only telemetry endpoints for monitoring
  if (req.path === '/status' || req.path === '/health' || req.path === '/heartbeat') return next();

  const clientKey = req.headers['x-api-key'] || (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : '');
  if (clientKey === adminApiKey) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized: Valid Admin API Key required.' });
});

const batchChainRoutes = require('./routes/batchChain');

// Mount API routes
app.use('/api', apiRoutes);
app.use('/api/batch-chain', batchChainRoutes);

// Static frontend dashboard
app.use(express.static(path.resolve(__dirname, '../public')));

// Lightweight Health & Heartbeat Endpoint (For Uptime Monitors & Azure Health Checks)
app.get(['/health', '/heartbeat', '/ping'], (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    worker: queueWorker.isRunning && !queueWorker.isPaused ? 'active' : 'idle'
  });
});

// Fallback to index.html for root or SPA navigation
app.get('/', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

function seedDefaultAccount() {
  // Never overwrite user-configured cooldowns or daily limits on startup

  if (config.defaultSenderEmail) {
    const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(config.defaultSenderEmail);
    if (!existing) {
      console.log(`[Bootstrap] Seeding dedicated primary sender account: ${config.defaultSenderEmail}`);
      AccountPool.upsertAccount({
        email: config.defaultSenderEmail,
        displayName: 'Dr. Reeta Shah (Chief Editor, Journal Paripex)',
        provider: config.defaultProvider,
        dailyLimit: config.defaultAccountDailyLimit,
        cooldownSeconds: 0
      });
    }
  }

  if (config.acsConnectionString) {
    const acsSenders = [
      { email: config.acsSenderEmail || 'DoNotReply@mail.theparipexjournal.com', name: 'Worldwide Journals (DoNotReply)' },
      { email: 'Rishank@mail.theparipexjournal.com', name: 'Worldwide Journals (Rishank)' }
    ];
    for (const sender of acsSenders) {
      const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(sender.email);
      if (!existing) {
        console.log(`[Bootstrap] Seeding Azure Communication Services account: ${sender.email}`);
        AccountPool.upsertAccount({
          email: sender.email,
          displayName: sender.name,
          provider: 'AZURE_ACS',
          dailyLimit: config.defaultAccountDailyLimit,
          cooldownSeconds: 0
        });
      }
    }
  }

  // 3. Seed Production OCI Email Delivery accounts (5 Verified Domains)
  const ociSenders = [
    { email: 'research@education.researchandrise.com', name: 'Research & Rise Academic' },
    { email: 'editor@publication.onlypaperpublication.com', name: 'Paper Publication Editorial' },
    { email: 'academic@education.yourseducationmatter.com', name: 'Education Matters Journal' },
    { email: 'editorial@education.yourpaperpublication.com', name: 'Paper Publication Review Board' },
    { email: 'newsletter@education.yourpaperedition.com', name: 'Paper Edition Education Newsletter' }
  ];

  for (const sender of ociSenders) {
    const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(sender.email);
    if (!existing) {
      console.log(`[Bootstrap] Seeding Verified OCI account: ${sender.email}`);
      AccountPool.upsertAccount({
        email: sender.email,
        displayName: sender.name,
        provider: 'OCI',
        dailyLimit: 10000,
        cooldownSeconds: 0
      });
    }
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
