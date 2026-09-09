/**
 * Template Engine for Merging Recipient Attributes
 */

function renderTemplate(templateStr, data = {}) {
  if (!templateStr || typeof templateStr !== 'string') {
    return '';
  }

  let result = templateStr;

  // Normalized key-value map for case-insensitive and flexible replacement
  const map = {
    name: data.name || '',
    'first name': (data.name || '').split(' ')[0] || '',
    email: data.email || '',
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

  return result;
}

module.exports = { renderTemplate };
