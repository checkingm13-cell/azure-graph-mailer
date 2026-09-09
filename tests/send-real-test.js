/**
 * Real Live Test Email Dispatcher
 * Sends a real test email through Microsoft Graph API using your Shared Mailbox
 * Usage: node tests/send-real-test.js <recipient-email>
 */

require('dotenv').config();
const { sendViaGraph } = require('../src/services/graphMailer');

async function main() {
  const recipient = process.argv[2] || process.env.TEST_RECIPIENT_EMAIL || 'checkingm13@gmail.com';
  const sender = process.env.DEFAULT_SENDER_EMAIL || 'noreply@theparipexjournal.com';

  console.log('===========================================================');
  console.log('🚀 Microsoft Graph API - Real Live Email Dispatcher Test');
  console.log('===========================================================');
  console.log('Sender (Shared Mailbox) :', sender);
  console.log('Recipient Target        :', recipient);
  console.log('Tenant ID               :', process.env.AZURE_TENANT_ID);
  console.log('Client ID               :', process.env.AZURE_CLIENT_ID);
  console.log('-----------------------------------------------------------');
  console.log('Attempting dispatch via POST /users/' + sender + '/sendMail ...');

  try {
    const result = await sendViaGraph({
      fromEmail: sender,
      toEmail: recipient,
      toName: 'Test Recipient',
      subject: '⚡ Live Test: Azure Graph Mailer Automation Engine',
      htmlBody: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0284c7;">🎉 Real Email Test Successful!</h2>
          <p>Hello,</p>
          <p>This email confirms that your <strong>Azure Multi-Account Graph Mailer Engine</strong> is 100% connected with Microsoft 365 Exchange Online.</p>
          <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 4px 0;"><strong>Sender:</strong> ${sender}</p>
            <p style="margin: 4px 0;"><strong>Provider:</strong> Microsoft Graph API (v1.0)</p>
            <p style="margin: 4px 0;"><strong>Sent At:</strong> ${new Date().toISOString()}</p>
          </div>
          <p style="color: #64748b; font-size: 13px;">Sent automatically by Azure Graph Mailer Queue Worker.</p>
        </div>
      `,
      saveToSentItems: true
    });

    console.log('✅ TEST EMAIL DELIVERED SUCCESSFULLY!');
    console.log('Details:', JSON.stringify(result, null, 2));
    console.log('👉 Please check the inbox and spam folder of:', recipient);
  } catch (err) {
    console.error('❌ DISPATCH FAILED:', err.message);
    console.log('\n🔍 Troubleshooting Guide:');
    if (err.message.includes('M365_MAILBOX_NOT_FOUND')) {
      console.log('1. Have you created the Shared Mailbox in admin.microsoft.com?');
      console.log('2. If you just created it in the last 15 minutes, Microsoft Exchange can take 15-30 minutes for DNS/mailbox provisioning to propagate.');
      console.log('3. Ensure the mailbox email matches DEFAULT_SENDER_EMAIL in .env exactly.');
    } else if (err.message.includes('GRAPH_FORBIDDEN')) {
      console.log('1. Go to Azure Portal -> Entra ID -> App Registrations -> JournalParipex-Email-Automation.');
      console.log('2. Check API permissions: Ensure "Mail.Send" (Application) has "Grant admin consent" clicked (green checkmark).');
    }
  }
}

main();
