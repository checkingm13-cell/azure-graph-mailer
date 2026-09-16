/**
 * Template Engine for Merging Recipient Attributes
 */

function renderTemplate(templateStr, data = {}) {
  if (!templateStr || typeof templateStr !== 'string') {
    return '';
  }

  let result = templateStr;

  const recipientDomain = (data.email && data.email.includes('@'))
    ? data.email.split('@')[1].trim().toLowerCase()
    : '';
  const senderEmail = data.sender_email || data.senderEmail || data.senderemail || '';
  const senderDomain = (senderEmail && senderEmail.includes('@'))
    ? senderEmail.split('@')[1].trim().toLowerCase()
    : (data.sender_domain || data.senderDomain || data.senderdomain || '');

  // Normalized key-value map for case-insensitive and flexible replacement
  const map = {
    name: data.name || '',
    'first name': (data.name || '').split(' ')[0] || '',
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
    affiliation: data.affiliation || '',
    date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  };

  // Replace {{tag}} and {tag} variations
  for (const [key, value] of Object.entries(map)) {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}|\\{\\s*${escapedKey}\\s*\\}`, 'gi');
    result = result.replace(regex, value);
  }

  // Auto-rewrite relative links (e.g. href="/submit-paper" -> href="https://${senderDomain}/submit-paper")
  if (senderDomain) {
    result = result.replace(/href=["'](\/(?!\/)[^"']*)["']/gi, (match, path) => {
      return `href="https://${senderDomain}${path}"`;
    });
  }

  return result;
}

module.exports = { renderTemplate };
