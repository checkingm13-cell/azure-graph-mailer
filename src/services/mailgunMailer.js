/**
 * Mailgun REST API Email Dispatcher
 * High-speed HTTP/2 API pipe using official mailgun.js & form-data
 */

const FormData = require('form-data');
const Mailgun = require('mailgun.js');
const config = require('../config/env');

let mgClient = null;

function getMailgunClient() {
  if (mgClient) return mgClient;

  if (!config.mailgunApiKey || !config.mailgunDomain) {
    throw new Error('Mailgun credentials (MAILGUN_API_KEY, MAILGUN_DOMAIN) are not configured in .env.');
  }

  const mailgun = new Mailgun(FormData);
  mgClient = mailgun.client({
    username: 'api',
    key: config.mailgunApiKey,
    url: config.mailgunHost || 'https://api.mailgun.net'
  });

  return mgClient;
}

async function sendViaMailgun({ fromEmail, toEmail, subject, htmlBody }) {
  const client = getMailgunClient();
  const domain = config.mailgunDomain;
  const sender = fromEmail || config.mailgunSenderEmail || `newsletter@${domain}`;

  const messageData = {
    from: sender.includes('<') ? sender : `"Paper Edition" <${sender.trim()}>`,
    to: [toEmail.trim()],
    subject: subject,
    html: htmlBody,
    'h:X-Mailer': 'Azure-Graph-Mailer-Mailgun-Engine',
    'h:List-Unsubscribe': `<mailto:unsubscribe@${domain}>`,
    'o:tracking': 'yes',
    'o:tracking-clicks': 'htmlonly',
    'o:tracking-opens': 'yes'
  };

  const response = await client.messages.create(domain, messageData);

  return {
    success: true,
    provider: 'MAILGUN',
    messageId: response.id,
    response: response.message || 'Queued. Thank you.'
  };
}

module.exports = { sendViaMailgun, getMailgunClient };
