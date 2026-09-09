/**
 * Microsoft Graph Mail Dispatcher
 * Sends emails via POST /users/{fromEmail}/sendMail
 */

const { getGraphClient } = require('../graph/graphClient');

async function sendViaGraph({
  fromEmail,
  toEmail,
  toName = '',
  subject,
  htmlBody,
  textBody,
  contentType = 'HTML',
  saveToSentItems = true,
  ccRecipients = [],
  bccRecipients = [],
  replyTo = []
}) {
  if (!fromEmail) throw new Error('Missing sender email address.');
  if (!toEmail) throw new Error('Missing recipient email address.');
  if (!subject) throw new Error('Missing email subject.');

  const client = getGraphClient();

  // Microsoft Graph API message resource schema
  // Spec: https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0
  const message = {
    subject: subject,
    body: {
      contentType: contentType === 'Text' ? 'Text' : 'HTML',
      content: htmlBody || textBody || ''
    },
    toRecipients: [
      {
        emailAddress: {
          address: toEmail.trim(),
          ...(toName ? { name: toName.trim() } : {})
        }
      }
    ]
  };

  // Optional: CC recipients
  if (Array.isArray(ccRecipients) && ccRecipients.length > 0) {
    message.ccRecipients = ccRecipients.map((rec) => {
      if (typeof rec === 'string') return { emailAddress: { address: rec.trim() } };
      return { emailAddress: { address: rec.address.trim(), ...(rec.name ? { name: rec.name } : {}) } };
    });
  }

  // Optional: BCC recipients
  if (Array.isArray(bccRecipients) && bccRecipients.length > 0) {
    message.bccRecipients = bccRecipients.map((rec) => {
      if (typeof rec === 'string') return { emailAddress: { address: rec.trim() } };
      return { emailAddress: { address: rec.address.trim(), ...(rec.name ? { name: rec.name } : {}) } };
    });
  }

  // Optional: Reply-To headers
  if (Array.isArray(replyTo) && replyTo.length > 0) {
    message.replyTo = replyTo.map((rec) => {
      if (typeof rec === 'string') return { emailAddress: { address: rec.trim() } };
      return { emailAddress: { address: rec.address.trim(), ...(rec.name ? { name: rec.name } : {}) } };
    });
  }

  const mailPayload = {
    message: message
  };

  // Microsoft Graph docs: "Specify saveToSentItems only if the parameter is false; default is true."
  if (saveToSentItems === false) {
    mailPayload.saveToSentItems = false;
  }

  try {
    const endpoint = `/users/${encodeURIComponent(fromEmail.trim())}/sendMail`;
    // Microsoft Graph returns 202 Accepted on success with empty body
    await client.api(endpoint).post(mailPayload);
    return { success: true, provider: 'GRAPH_API', from: fromEmail, to: toEmail };
  } catch (err) {
    // Enrich error message with actionable diagnostics per Microsoft Graph reference
    let enrichedMsg = err.message || 'Unknown Microsoft Graph error';
    let isThrottled = false;
    let retryAfterSec = 60;

    const statusCode = err.statusCode || err.status || (err.response && err.response.status);

    if (statusCode === 429) {
      isThrottled = true;
      const rawRetryAfter = err.headers?.get ? err.headers.get('retry-after') : err.headers?.['retry-after'];
      if (rawRetryAfter && !isNaN(parseInt(rawRetryAfter, 10))) {
        retryAfterSec = parseInt(rawRetryAfter, 10);
      }
      enrichedMsg = `[GRAPH_THROTTLED_429] Exchange Online rate limit reached for "${fromEmail}". Cooldown required: ${retryAfterSec}s. (Max 30 emails/min per mailbox).`;
    } else if (statusCode === 404 || enrichedMsg.includes('ResourceNotFound') || enrichedMsg.includes('segment')) {
      enrichedMsg = `[M365_MAILBOX_NOT_FOUND_404] The sender account "${fromEmail}" does not have an active Exchange Online mailbox or license in tenant.`;
    } else if (statusCode === 403 || enrichedMsg.includes('AccessDenied')) {
      enrichedMsg = `[GRAPH_FORBIDDEN_403] App Registration lacks "Mail.Send" Application Permission or Admin Consent was not granted.`;
    } else if (statusCode === 400) {
      enrichedMsg = `[GRAPH_BAD_REQUEST_400] Malformed message payload: ${enrichedMsg}`;
    }

    const enhancedError = new Error(enrichedMsg);
    enhancedError.statusCode = statusCode;
    enhancedError.isThrottled = isThrottled;
    enhancedError.retryAfter = retryAfterSec;
    enhancedError.original = err;
    throw enhancedError;
  }
}

module.exports = { sendViaGraph };
