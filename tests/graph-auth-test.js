/**
 * Microsoft Entra ID (Graph API) Authentication Handshake Test
 */

const { ClientSecretCredential } = require('@azure/identity');
const config = require('../src/config/env');

async function testAuth() {
  console.log('--- Testing Microsoft Entra ID OAuth 2.0 Token Handshake ---');
  console.log(`Tenant ID : ${config.azureTenantId}`);
  console.log(`Client ID : ${config.azureClientId}`);

  if (!config.azureTenantId || !config.azureClientId || !config.azureClientSecret) {
    console.error('❌ Missing credentials in .env');
    process.exit(1);
  }

  const credential = new ClientSecretCredential(
    config.azureTenantId,
    config.azureClientId,
    config.azureClientSecret
  );

  try {
    console.log('Requesting OAuth token from https://login.microsoftonline.com ...');
    const tokenResponse = await credential.getToken('https://graph.microsoft.com/.default');
    
    if (tokenResponse && tokenResponse.token) {
      console.log('✅ OAUTH 2.0 TOKEN ACQUIRED SUCCESSFULLY!');
      console.log(`Token Type : Bearer`);
      console.log(`Expires On : ${new Date(tokenResponse.expiresOnTimestamp).toLocaleString()}`);
      console.log(`Token Length: ${tokenResponse.token.length} characters`);
      console.log('🎉 Your Microsoft Entra App Registration & Secret are 100% VALID and functional!');
    } else {
      console.error('❌ Failed: Token was empty');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Authentication failed:', err.message);
    process.exit(1);
  }
}

testAuth();
