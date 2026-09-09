const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../data/mailer.db'),
  defaultProvider: process.env.DEFAULT_PROVIDER || 'GRAPH_API',

  // Microsoft Entra ID (Graph API)
  azureTenantId: process.env.AZURE_TENANT_ID || '',
  azureClientId: process.env.AZURE_CLIENT_ID || '',
  azureClientSecret: process.env.AZURE_CLIENT_SECRET || '',
  defaultSenderEmail: process.env.DEFAULT_SENDER_EMAIL || '',

  // Rate Limiting & Cooldowns
  globalSendIntervalMs: parseInt(process.env.GLOBAL_SEND_INTERVAL_MS || '2500', 10),
  defaultAccountDailyLimit: parseInt(process.env.DEFAULT_ACCOUNT_DAILY_LIMIT || '500', 10),
  accountCooldownSeconds: parseInt(process.env.ACCOUNT_COOLDOWN_SECONDS || '60', 10),

  // Azure Communication Services (Optional)
  acsConnectionString: process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '',
  acsSenderEmail: process.env.ACS_SENDER_EMAIL || ''
};

module.exports = Object.freeze(config);
