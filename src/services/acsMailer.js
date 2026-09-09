/**
 * Azure Communication Services (ACS) Email Dispatcher
 * Pure Pay-As-You-Go ($0.00025/mail) alternative without Microsoft 365 licenses
 */

const { EmailClient } = require('@azure/communication-email');
const config = require('../config/env');

let acsClient = null;

function getAcsClient() {
  if (acsClient) return acsClient;
  if (!config.acsConnectionString) {
    throw new Error('Azure Communication Services Connection String is not configured in .env.');
  }
  acsClient = new EmailClient(config.acsConnectionString);
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

  const poller = await client.beginSend(message);
  const response = await poller.pollUntilDone();

  return {
    success: true,
    provider: 'AZURE_ACS',
    messageId: response.id,
    status: response.status
  };
}

module.exports = { sendViaACS };
