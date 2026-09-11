require('dotenv').config();
const { sendViaACS } = require('./src/services/acsMailer');

async function testACS() {
  console.log('===========================================================');
  console.log('🚀 TESTING DIRECT AZURE COMMUNICATION SERVICES DISPATCH');
  console.log('===========================================================');

  const payload = {
    fromEmail: 'DoNotReply@mail.theparipexjournal.com',
    toEmail: 'checkingm13@gmail.com',
    subject: `🎉 Live ACS Deliverability Verification: Journal Paripex (${new Date().toLocaleTimeString()})`,
    htmlBody: `
      <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #0284c7; margin-top: 0;">🎉 Direct Azure ACS Delivery Successful!</h2>
        <p>Hello <b>Hamza Memon</b>,</p>
        <p>This email was dispatched directly via <b>Azure Communication Services (ACS)</b> using your fully verified domain <b>mail.theparipexjournal.com</b>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc; font-size: 13px;">
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Sender:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">DoNotReply@mail.theparipexjournal.com</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Recipient:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">checkingm13@gmail.com</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">MTA Engine:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">Azure Communication Services (Enterprise Cloud)</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">SPF / DKIM:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">Verified Domain (No M365 550 5.7.708 Error)</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Timestamp:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${new Date().toISOString()}</td></tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">Worldwide Journals &bull; Journal Paripex Industrial Mailer Engine</p>
      </div>
    `
  };

  console.log(`📤 Sending from: ${payload.fromEmail}`);
  console.log(`📥 Sending to  : ${payload.toEmail}`);
  console.log(`📨 Subject     : ${payload.subject}`);
  console.log('\nContacting Azure Communication Services Email Client...');

  try {
    const result = await sendViaACS(payload);
    console.log('\n===========================================================');
    console.log('🎉 SUCCESS! Azure Communication Services Accepted the Email!');
    console.log('Message ID:', result.messageId);
    console.log('Status    :', result.status);
    console.log('Provider  :', result.provider);
    console.log('===========================================================');
    console.log('👉 Check your inbox at checkingm13@gmail.com (and Spam/Updates folder)!');
  } catch (error) {
    console.error('\n❌ ACS Dispatch Error:', error.message);
    if (error.details) console.error('Details:', error.details);
  }
}

testACS().catch(console.error);
