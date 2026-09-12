/**
 * Oracle Cloud Infrastructure (OCI) Email Delivery Dispatcher
 * High-throughput SMTP pipe (~$0.10 / 1k emails) via Nodemailer pooled transporter
 */

const nodemailer = require('nodemailer');
const config = require('../config/env');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!config.ociSmtpUser || !config.ociSmtpPass) {
    throw new Error('OCI SMTP credentials (OCI_SMTP_USER, OCI_SMTP_PASS) are not configured in .env.');
  }

  transporter = nodemailer.createTransport({
    host: config.ociSmtpHost,
    port: config.ociSmtpPort,
    secure: false, // Port 587 uses STARTTLS
    auth: {
      user: config.ociSmtpUser,
      pass: config.ociSmtpPass
    },
    pool: true,
    maxConnections: 10,
    maxMessages: 200,
    rateDelta: 1000,
    rateLimit: 50
  });

  return transporter;
}

async function sendViaOCI({ fromEmail, toEmail, subject, htmlBody }) {
  const mailer = getTransporter();
  const sender = fromEmail || config.ociSenderEmail || 'newsletter@education.yourpaperedition.com';

  const mailOptions = {
    from: sender.includes('<') ? sender : `"Paper Edition" <${sender.trim()}>`,
    to: toEmail.trim(),
    subject: subject,
    html: htmlBody,
    headers: {
      'X-Mailer': 'Azure-Graph-Mailer-OCI-Engine',
      'List-Unsubscribe': '<mailto:unsubscribe@education.yourpaperedition.com>, <https://education.yourpaperedition.com/unsubscribe>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  };

  const info = await mailer.sendMail(mailOptions);

  return {
    success: true,
    provider: 'OCI',
    messageId: info.messageId,
    response: info.response
  };
}

module.exports = { sendViaOCI, getTransporter };
