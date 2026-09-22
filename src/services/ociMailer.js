/**
 * Oracle Cloud Infrastructure (OCI) Email Delivery Dispatcher
 * Multi-Region pooled SMTP relay (~$0.10 / 10k emails) via Nodemailer
 */

const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const config = require('../config/env');

// Regional connection pool cache: Map<host, Transporter>
const transporters = new Map();
const domainRegionCache = new Map();

/**
 * Auto-detects OCI region from domain's DKIM CNAME record
 */
async function autoDetectOciRegion(emailOrDomain) {
  if (!emailOrDomain) return 'ap-mumbai-1';
  const domain = emailOrDomain.includes('@')
    ? emailOrDomain.split('@')[1].trim().toLowerCase()
    : emailOrDomain.trim().toLowerCase();

  if (domainRegionCache.has(domain)) {
    return domainRegionCache.get(domain);
  }

  const selectors = ['oci', 'oci-us', 'oci-iad', 'oci-fra', 'oci-bom', 'oci-syd', 'default'];
  for (const sel of selectors) {
    try {
      const cnames = await dns.resolveCname(`${sel}._domainkey.${domain}`);
      for (const target of cnames) {
        const lower = target.toLowerCase();
        if (lower.includes('bom1')) {
          domainRegionCache.set(domain, 'ap-mumbai-1');
          return 'ap-mumbai-1';
        }
        if (lower.includes('iad1')) {
          domainRegionCache.set(domain, 'us-ashburn-1');
          return 'us-ashburn-1';
        }
        if (lower.includes('phx1')) {
          domainRegionCache.set(domain, 'us-phoenix-1');
          return 'us-phoenix-1';
        }
        if (lower.includes('fra1')) {
          domainRegionCache.set(domain, 'eu-frankfurt-1');
          return 'eu-frankfurt-1';
        }
        if (lower.includes('lhr1') || lower.includes('lon1')) {
          domainRegionCache.set(domain, 'uk-london-1');
          return 'uk-london-1';
        }
        if (lower.includes('syd1')) {
          domainRegionCache.set(domain, 'ap-sydney-1');
          return 'ap-sydney-1';
        }
        if (lower.includes('yyz1')) {
          domainRegionCache.set(domain, 'ca-toronto-1');
          return 'ca-toronto-1';
        }
        if (lower.includes('yul1')) {
          domainRegionCache.set(domain, 'ca-montreal-1');
          return 'ca-montreal-1';
        }
      }
    } catch (_) {}
  }

  domainRegionCache.set(domain, 'ap-mumbai-1');
  return 'ap-mumbai-1';
}

/**
 * Resolves regional SMTP host from region code or hostname
 */
function resolveSmtpHost(region) {
  if (!region) return config.ociSmtpHost || 'smtp.email.ap-mumbai-1.oci.oraclecloud.com';
  if (region.includes('.')) return region; // Already a full hostname
  return `smtp.email.${region.trim().toLowerCase()}.oci.oraclecloud.com`;
}

/**
 * Retrieves or creates a pooled transporter for a specific region
 */
function getTransporter(region) {
  if (!config.ociSmtpUser || !config.ociSmtpPass) {
    throw new Error('OCI SMTP credentials (OCI_SMTP_USER, OCI_SMTP_PASS) are not configured in .env.');
  }

  const host = resolveSmtpHost(region);

  if (transporters.has(host)) {
    return transporters.get(host);
  }

  const pool = nodemailer.createTransport({
    host: host,
    port: config.ociSmtpPort || 587,
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

  transporters.set(host, pool);
  return pool;
}

/**
 * Dispatches an email via regional OCI SMTP
 */
async function sendViaOCI({ fromEmail, toEmail, subject, htmlBody, region, attachments = [] }) {
  const sender = fromEmail || config.ociSenderEmail || 'newsletter@education.yourpaperedition.com';
  
  // Resolve region: explicitly specified -> auto-detect from sender domain -> fallback default
  let targetRegion = region;
  if (!targetRegion || targetRegion === 'auto') {
    targetRegion = await autoDetectOciRegion(sender);
  }

  const mailer = getTransporter(targetRegion);

  const senderClean = sender.includes('<') ? sender.match(/<([^>]+)>/)?.[1] || sender : sender.trim();
  const senderDomain = senderClean.includes('@') ? senderClean.split('@')[1].trim() : 'worldwidejournals.com';

  const mailOptions = {
    from: sender.includes('<') ? sender : `"Paper Edition" <${sender.trim()}>`,
    to: toEmail.trim(),
    subject: subject,
    html: htmlBody,
    headers: {
      'X-Mailer': 'Azure-Graph-Mailer-OCI-Engine',
      'X-OCI-Region': targetRegion,
      'List-Unsubscribe': `<mailto:unsubscribe@${senderDomain}>, <https://${senderDomain}/unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    }
  };

  if (Array.isArray(attachments) && attachments.length > 0) {
    mailOptions.attachments = attachments;
  }

  const info = await mailer.sendMail(mailOptions);

  return {
    success: true,
    provider: 'OCI',
    region: targetRegion,
    host: resolveSmtpHost(targetRegion),
    messageId: info.messageId,
    response: info.response
  };
}

module.exports = { sendViaOCI, getTransporter, autoDetectOciRegion, resolveSmtpHost };
