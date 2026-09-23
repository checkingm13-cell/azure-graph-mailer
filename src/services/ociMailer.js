/**
 * Oracle Cloud Infrastructure (OCI) Email Delivery Dispatcher
 * Multi-Region pooled SMTP relay (~$0.10 / 10k emails) via Nodemailer
 */

const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const config = require('../config/env');
const { extractApexDomain } = require('./templateEngine');

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

  const selectors = ['oci', 'ashburn', 'publication', 'oci-us', 'oci-iad', 'oci-fra', 'oci-bom', 'oci-syd', 'default'];
  for (const sel of selectors) {
    try {
      const cnames = await dns.resolveCname(`${sel}._domainkey.${domain}`);
      for (const target of cnames) {
        const lower = target.toLowerCase();
        // 1. Direct OCI region key in CNAME target (e.g. ...me-abudhabi-1.oci...)
        const regionMatch = lower.match(/([a-z]{2}-[a-z]+-\d+)\.oci/);
        if (regionMatch) {
          const matchedRegion = regionMatch[1];
          domainRegionCache.set(domain, matchedRegion);
          return matchedRegion;
        }

        // 2. Regional 3-letter airport code detection in CNAME
        if (lower.includes('bom1')) {
          domainRegionCache.set(domain, 'ap-mumbai-1');
          return 'ap-mumbai-1';
        }
        if (lower.includes('auh1')) {
          domainRegionCache.set(domain, 'me-abudhabi-1');
          return 'me-abudhabi-1';
        }
        if (lower.includes('iad1')) {
          domainRegionCache.set(domain, 'us-ashburn-1');
          return 'us-ashburn-1';
        }
        if (lower.includes('hyd1')) {
          domainRegionCache.set(domain, 'ap-hyderabad-1');
          return 'ap-hyderabad-1';
        }
        if (lower.includes('dxb1')) {
          domainRegionCache.set(domain, 'me-dubai-1');
          return 'me-dubai-1';
        }
        if (lower.includes('sin1')) {
          domainRegionCache.set(domain, 'ap-singapore-1');
          return 'ap-singapore-1';
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
 * Lightweight HTML-to-Plain-Text converter for multipart/alternative fallback
 */
function htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<a[\s\S]*?href=["']([^"']*)["'][\s\S]*?>([\s\S]*?)<\/a>/gi, (match, url, text) => {
      const cleanText = text.replace(/<[^>]+>/g, '').trim();
      return cleanText ? `${cleanText} (${url})` : url;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&bull;/gi, '•')
    .replace(/&amp;/gi, '&')
    .replace(/&rarr;/gi, '->')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n\s+\n/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Formats RFC 2822 date strictly anchored to Indian Standard Time (IST, +0530)
 */
function formatRfc2822IST(d = new Date()) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (330 * 60000));
  const dayName = days[ist.getDay()];
  const day = String(ist.getDate()).padStart(2, '0');
  const month = months[ist.getMonth()];
  const year = ist.getFullYear();
  const hours = String(ist.getHours()).padStart(2, '0');
  const minutes = String(ist.getMinutes()).padStart(2, '0');
  const seconds = String(ist.getSeconds()).padStart(2, '0');
  return `${dayName}, ${day} ${month} ${year} ${hours}:${minutes}:${seconds} +0530`;
}

/**
 * Resolves authoritative display name from sender domain if none supplied
 */
function resolveSenderDisplayName(senderEmail, subject = '') {
  const subLower = (subject || '').toLowerCase();
  if (subLower.includes('paripex') || subLower.includes('pijr')) return 'Paripex - Indian Journal of Research';
  if (subLower.includes('scientific research') || subLower.includes('ijsr')) return 'International Journal of Scientific Research (IJSR)';
  if (subLower.includes('applied research') || subLower.includes('ijar')) return 'Indian Journal of Applied Research (IJAR)';
  if (subLower.includes('research analysis') || subLower.includes('gjra')) return 'Global Journal for Research Analysis (GJRA)';

  const lower = (senderEmail || '').toLowerCase();
  if (lower.includes('researchandrise')) return 'International Journal of Scientific Research (IJSR)';
  if (lower.includes('yourpaperedition')) return 'Indian Journal of Applied Research (IJAR)';
  if (lower.includes('onlypaperpublication')) return 'Paripex - Indian Journal of Research';
  if (lower.includes('yourpaperpublication')) return 'Global Journal for Research Analysis (GJRA)';
  return 'Worldwide Journals';
}

/**
 * Dispatches an email via regional OCI SMTP matching MakeMyTrip enterprise deliverability standards
 */
async function sendViaOCI({ fromEmail, toEmail, subject, htmlBody, textBody, region, attachments = [] }) {
  const sender = fromEmail || config.ociSenderEmail || 'newsletter@education.yourpaperedition.com';
  
  // Resolve region: explicitly specified -> auto-detect from sender domain -> fallback default
  let targetRegion = region;
  if (!targetRegion || targetRegion === 'auto') {
    targetRegion = await autoDetectOciRegion(sender);
  }

  const mailer = getTransporter(targetRegion);

  const senderClean = sender.includes('<') ? sender.match(/<([^>]+)>/)?.[1] || sender : sender.trim();
  const rawSenderDomain = senderClean.includes('@') ? senderClean.split('@')[1].trim() : 'worldwidejournals.com';
  const apexDomain = extractApexDomain(rawSenderDomain) || rawSenderDomain;
  const displayName = resolveSenderDisplayName(senderClean, subject);

  const plainText = textBody || htmlToPlainText(htmlBody);

  // Enterprise MakeMyTrip-style Message-ID & headers
  const uniqueId = `${Date.now()}${Math.floor(100000 + Math.random() * 900000)}`;
  const customMessageId = `<${uniqueId}@${apexDomain}>`;

  // VERP (Variable Envelope Return Path) for automated bounce isolation
  const recipientClean = toEmail.trim().toLowerCase().replace(/[@+]/g, '=');
  const verpReturnPath = process.env.ENABLE_VERP === 'true'
    ? `bounce-${recipientClean}@${apexDomain}`
    : senderClean;

  // Proper Reply-To domain matching the sender's apex domain
  const replyToEmail = `editor@${apexDomain}`;

  const mailOptions = {
    from: sender.includes('<') ? sender : `"${displayName}" <${senderClean}>`,
    replyTo: `"${displayName}" <${replyToEmail}>`,
    to: toEmail.trim(),
    envelope: {
      from: verpReturnPath,
      to: toEmail.trim()
    },
    subject: subject,
    text: plainText,
    html: htmlBody,
    messageId: customMessageId,
    headers: {
      'Date': formatRfc2822IST(),
      'X-OCI-Region': targetRegion,
      'Feedback-ID': `journal:${apexDomain.replace(/\./g, '_')}:oci`,
      'List-Unsubscribe': `<https://${apexDomain}/unsubscribe>, <mailto:unsubscribe@${apexDomain}?subject=Unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Return-Path': `<${verpReturnPath}>`
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
    messageId: info.messageId || customMessageId,
    response: info.response
  };
}

module.exports = { sendViaOCI, getTransporter, autoDetectOciRegion, resolveSmtpHost };
