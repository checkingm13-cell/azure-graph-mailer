/**
 * End-to-End Campaign Dispatcher Script
 * Parses a CSV file and posts directly to the Mailer backend (local or production Azure)
 */
const fs = require('fs');
const path = require('path');

async function main() {
  const targetUrl = process.env.API_BASE_URL || process.argv[2] || 'https://paripex-mailer-app.azurewebsites.net';
  const csvPath = process.env.CSV_PATH || process.argv[3] || 'test - new.csv';
  const senderType = (process.env.SENDER_TYPE || process.argv[4] || 'AZURE_ACS').toUpperCase(); // AZURE_ACS, GRAPH_API, or POOL
  const batchSize = parseInt(process.env.BATCH_SIZE || process.argv[5] || '50', 10);

  const cleanBaseUrl = targetUrl.replace(/\/+$/, '');

  console.log('=================================================================');
  console.log('🚀 AZURE MULTI-ACCOUNT MAILER - END-TO-END DISPATCHER');
  console.log('=================================================================');
  console.log(`🌐 Target Endpoint:   ${cleanBaseUrl}`);
  console.log(`📑 CSV Contact Sheet: ${csvPath}`);
  console.log(`⚙️ Sender Strategy:   ${senderType}`);
  console.log(`📦 Batch Size:         ${batchSize} emails/batch`);
  console.log('-----------------------------------------------------------------');

  // 1. Verify health / connectivity
  console.log('[Step 1/5] 📡 Checking server connectivity...');
  let serverStatus;
  try {
    const res = await fetch(`${cleanBaseUrl}/api/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    serverStatus = await res.json();
    console.log(`✅ Connected! Worker Status: ${serverStatus.worker.isRunning ? (serverStatus.worker.isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED'}`);
    console.log(`   Active Accounts: ${serverStatus.pool.active_accounts}/${serverStatus.pool.total_accounts}`);
  } catch (err) {
    console.error(`❌ Connection failed to ${cleanBaseUrl}:`, err.message);
    console.log('\n💡 Tip: If testing locally, pass: http://localhost:5000 as first argument.');
    process.exit(1);
  }

  // 2. Fetch Accounts to match sender preference
  console.log('[Step 2/5] 👥 Resolving sender account...');
  let senderAccountId = null;
  try {
    const accRes = await fetch(`${cleanBaseUrl}/api/accounts`);
    const accData = await accRes.json();
    if (accData.ok && accData.accounts.length > 0) {
      let matched;
      if (senderType === 'AZURE_ACS') {
        matched = accData.accounts.find(a => a.provider === 'AZURE_ACS' && a.is_active);
      } else if (senderType === 'GRAPH_API') {
        matched = accData.accounts.find(a => a.provider === 'GRAPH_API' && a.is_active);
      }

      if (matched) {
        senderAccountId = matched.id;
        console.log(`✅ Selected Account: [${matched.provider}] ${matched.email} (ID: ${matched.id})`);
      } else {
        console.log(`ℹ️ No specific ${senderType} account locked. Using full pool rotation.`);
      }
    }
  } catch (e) {
    console.log('⚠️ Could not fetch accounts list, defaulting to auto-pool rotation.');
  }

  // 3. Fetch Templates
  console.log('[Step 3/5] ✉️ Resolving email template...');
  let templateId = 1;
  try {
    const tplRes = await fetch(`${cleanBaseUrl}/api/templates`);
    const tplData = await tplRes.json();
    if (tplData.ok && tplData.templates && tplData.templates.length > 0) {
      templateId = tplData.templates[0].id;
      console.log(`✅ Using Template: "${tplData.templates[0].name}" (ID: ${templateId})`);
    }
  } catch (e) {}

  // 4. Parse CSV File
  console.log(`[Step 4/5] 📑 Reading CSV: ${csvPath}...`);
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File not found: ${csvPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) {
    console.error('❌ CSV is empty or has only header row.');
    process.exit(1);
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const emailIdx = headers.findIndex(h => h.includes('email') || h.includes('mail'));
  const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('author'));
  const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('paper'));

  const contacts = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const email = emailIdx !== -1 ? cols[emailIdx] : cols[1];
    const name = nameIdx !== -1 ? cols[nameIdx] : cols[0];
    const paperTitle = titleIdx !== -1 ? cols[titleIdx] : '';

    if (email && email.includes('@')) {
      contacts.push({
        name: name || '',
        email: email.toLowerCase(),
        paper_title: paperTitle || 'Recent Advancements in Research',
        affiliation: ''
      });
    }
  }

  console.log(`✅ Loaded ${contacts.length} valid contacts from sheet.`);

  // 5. Post Campaign Request
  const baseName = path.basename(csvPath, path.extname(csvPath)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const campaignName = `${baseName}_${senderType}_${Date.now().toString().slice(-4)}`;

  console.log(`[Step 5/5] 🚀 Launching campaign batches to ${cleanBaseUrl}/api/campaigns/launch-batches...`);

  const payload = {
    baseCampaignName: campaignName,
    templateId,
    batchSize,
    skipPreviouslyContacted: false,
    scheduleMode: 'immediate',
    contacts,
    senderAccountId
  };

  try {
    const postRes = await fetch(`${cleanBaseUrl}/api/campaigns/launch-batches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await postRes.json();
    if (result.ok) {
      console.log('\n=================================================================');
      console.log('🎉 CAMPAIGN DISPATCHED SUCCESSFULLY!');
      console.log('=================================================================');
      console.log(`📦 Batches Created:   ${result.totalCampaigns}`);
      console.log(`✉️ Total Emails:      ${result.totalQueued}`);
      console.log(`⚡ Dispatch Mode:      ${result.scheduleMode.toUpperCase()}`);
      console.log('\nActive Batches:');
      result.campaigns.forEach(c => {
        console.log(`  - [ID: #${c.campaignId}] ${c.name} (${c.count} contacts) [${c.status}]`);
      });
      console.log('-----------------------------------------------------------------');
      console.log(`👉 Open Dashboard to track in real-time: ${cleanBaseUrl}`);
      console.log('=================================================================\n');
    } else {
      console.error('❌ Failed to launch campaign:', result.error || result.message);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error sending request:', err.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
