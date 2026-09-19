/**
 * Template Engine for Merging Recipient Attributes
 */

/**
 * Extracts apex root domain from domain or email, stripping subdomains 
 * (e.g. mail.theparipexjournal.com -> theparipexjournal.com, education.yourpaperedition.com -> yourpaperedition.com)
 */
function extractApexDomain(domainOrEmail) {
  if (!domainOrEmail || typeof domainOrEmail !== 'string') return '';
  let domain = domainOrEmail.includes('@') ? domainOrEmail.split('@')[1] : domainOrEmail;
  domain = domain.trim().toLowerCase().replace(/^https?:\/\//i, '').split('/')[0];
  const parts = domain.split('.');
  if (parts.length <= 2) return domain;
  
  // Known two-part public suffix ccTLDs
  const twoPartTlds = [
    'co.uk', 'co.in', 'org.uk', 'gov.in', 'net.in', 'ac.in', 'edu.in', 'com.au', 'net.au', 'org.au',
    'co.nz', 'net.nz', 'org.nz', 'com.br', 'net.br', 'org.br', 'co.za', 'com.sg', 'edu.sg', 'com.my',
    'co.jp', 'ne.jp', 'ac.jp', 'com.ph', 'edu.ph', 'com.mx', 'org.mx', 'co.kr', 'ne.kr'
  ];
  
  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function renderTemplate(templateStr, data = {}) {
  if (!templateStr || typeof templateStr !== 'string') {
    return '';
  }

  let result = templateStr;

  // Smart Multi-Subject & Spintax Rotation Support:
  // If templateStr contains multiple variations separated by pipe (|) or newline, pick dynamically
  if (result.includes('|') || result.includes('\n')) {
    const rawParts = result.includes('|')
      ? result.split('|')
      : result.split(/\r?\n/);
    const variations = rawParts.map(p => p.trim()).filter(Boolean);

    if (variations.length > 1) {
      // Deterministic selection based on recipient index or email hash
      let chosenIdx = 0;
      if (typeof data._index === 'number' && data._index >= 0) {
        chosenIdx = data._index % variations.length;
      } else if (data.email) {
        // Simple fast string hash for deterministic selection per contact
        let hash = 0;
        for (let i = 0; i < data.email.length; i++) {
          hash = ((hash << 5) - hash) + data.email.charCodeAt(i);
          hash |= 0;
        }
        chosenIdx = Math.abs(hash) % variations.length;
      } else {
        chosenIdx = Math.floor(Math.random() * variations.length);
      }
      result = variations[chosenIdx];
    }
  }

  // Support inline spintax: {Option A|Option B|Option C}
  if (result.includes('{') && result.includes('}')) {
    result = result.replace(/\{([^{}]+)\}/g, (match, choices) => {
      const parts = choices.split('|');
      if (parts.length > 1) {
        let pickIdx = 0;
        if (typeof data._index === 'number') {
          pickIdx = data._index % parts.length;
        } else if (data.email) {
          let hash = 0;
          for (let i = 0; i < data.email.length; i++) {
            hash = ((hash << 3) - hash) + data.email.charCodeAt(i);
            hash |= 0;
          }
          pickIdx = Math.abs(hash) % parts.length;
        } else {
          pickIdx = Math.floor(Math.random() * parts.length);
        }
        return parts[pickIdx].trim();
      }
      return match;
    });
  }

  const recipientDomain = (data.email && data.email.includes('@'))
    ? data.email.split('@')[1].trim().toLowerCase()
    : '';
  const senderEmail = data.sender_email || data.senderEmail || data.senderemail || '';
  const rawSenderDomain = (senderEmail && senderEmail.includes('@'))
    ? senderEmail.split('@')[1].trim().toLowerCase()
    : (data.sender_domain || data.senderDomain || data.senderdomain || '');
  const senderDomain = extractApexDomain(rawSenderDomain);

  const firstName = (data.name || '').split(' ')[0] || data.name || 'Researcher';
  const fullName = data.name || 'Researcher';

  // Normalized key-value map for case-insensitive and flexible replacement
  const map = {
    fname: firstName,
    'fname': firstName,
    'first name': firstName,
    firstname: firstName,
    name: fullName,
    email: data.email || '',
    domain: recipientDomain,
    recipient_domain: recipientDomain,
    recipientdomain: recipientDomain,
    sender_domain: senderDomain,
    senderdomain: senderDomain,
    senderDomain: senderDomain,
    sender_email: senderEmail,
    senderemail: senderEmail,
    senderEmail: senderEmail,
    'paper title': data.paper_title || data.paperTitle || '',
    papertitle: data.paper_title || data.paperTitle || '',
    affiliation: data.affiliation || '',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  };

  // Replace {{tag}}, {tag}, and [tag] variations (e.g. [FNAME], {{Name}}, {{senderDomain}})
  for (const [key, value] of Object.entries(map)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}|\\{\\s*${escapedKey}\\s*\\}|\\[\\s*${escapedKey}\\s*\\]`, 'gi');
    result = result.replace(regex, value);
  }

  // Safe anchor-only link rewriting (e.g. <a href="/submit-paper"> -> <a href="https://${senderDomain}/submit-paper">)
  // Also fix any links where senderDomain was inserted without https:// protocol or ended up with https://https://
  if (senderDomain) {
    result = result.replace(/<a\b([^>]*?)\bhref=["'](\/(?!\/)[^"']*)["']([^>]*)>/gi, (match, prefix, path, suffix) => {
      return `<a${prefix}href="https://${senderDomain}${path}"${suffix}>`;
    });
    // If a template has href="theparipexjournal.com/..." without http(s)://, auto-prepend https://
    const escapedDomain = senderDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const missingProtocolRegex = new RegExp(`(<a\\b[^>]*?\\bhref=["'])(?:https?:\\/\\/)?(${escapedDomain}[^"']*)(["'][^>]*>)`, 'gi');
    result = result.replace(missingProtocolRegex, '$1https://$2$3');
  }

  // Clean up any inadvertent double https://https://
  result = result.replace(/https?:\/\/https?:\/\//gi, 'https://');

  return result;
}

module.exports = { renderTemplate, extractApexDomain };
