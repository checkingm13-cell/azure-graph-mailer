/**
 * Microsoft Entra ID Token Provider & Graph Client Initializer
 */

const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const config = require('../config/env');

let graphClientInstance = null;

function getGraphClient() {
  if (graphClientInstance) {
    return graphClientInstance;
  }

  if (!config.azureTenantId || !config.azureClientId || !config.azureClientSecret) {
    throw new Error('Missing Microsoft Entra ID credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, or AZURE_CLIENT_SECRET).');
  }

  const credential = new ClientSecretCredential(
    config.azureTenantId,
    config.azureClientId,
    config.azureClientSecret
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default']
  });

  graphClientInstance = Client.initWithMiddleware({
    authProvider
  });

  return graphClientInstance;
}

module.exports = { getGraphClient };
