/**
 * Azure Communication Services (ACS) Email Dispatcher
 * Pure Pay-As-You-Go ($0.00025/mail) alternative without Microsoft 365 licenses
 */

const { EmailClient } = require('@azure/communication-email');
const config = require('../config/env');

let acsClient = null;

function getAcsClient() {
  if (acsClient) return acsClient;
  let connStr = (config.acsConnectionString || '').trim();
  if (!connStr) {
    throw new Error('Azure Communication Services Connection String is not configured in environment.');
  }
  // Auto-fix if 'endpoint=' prefix was omitted
  if (!connStr.toLowerCase().startsWith('endpoint=')) {
    connStr = `endpoint=${connStr}`;
  }
  acsClient = new EmailClient(connStr);
  return acsClient;
}

async function sendViaACS({ fromEmail, toEmail, subject, htmlBody }) {
  const client = getAcsClient();
  const senderAddress = fromEmail || config.acsSenderEmail;

  if (!senderAddress) {
    throw new Error('No sender address configured for Azure Communication Services.');
  }

  const message = {
    senderAddress: senderAddress.trim(),
    content: {
      subject: subject,
      html: htmlBody
    },
    recipients: {
      to: [{ address: toEmail.trim() }]
    }
  };

  // Strict 6s timeout on the initial beginSend HTTP handshake
  const poller = await Promise.race([
    client.beginSend(message),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Azure ACS connection timed out after 6000ms')), 6000))
  ]);

  let response = null;
  try {
    response = await Promise.race([
      poller.pollUntilDone(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ACS_POLL_TIMEOUT')), 4000))
    ]);
  } catch (err) {
    if (err.message === 'ACS_POLL_TIMEOUT') {
      const opId = poller.getOperationState()?.operationId || `acs_${Date.now()}`;
      return {
        success: true,
        provider: 'AZURE_ACS',
        messageId: opId,
        status: 'Accepted'
      };
    }
    throw err;
  }

  return {
    success: true,
    provider: 'AZURE_ACS',
    messageId: response.id || `acs_${Date.now()}`,
    status: response.status || 'Accepted'
  };
}

module.exports = { sendViaACS };
