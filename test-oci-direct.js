require('dotenv').config();
const { sendViaOCI } = require('./src/services/ociMailer');

async function testOCI() {
  console.log('===========================================================');
  console.log('🚀 TESTING DIRECT ORACLE CLOUD (OCI) EMAIL DELIVERY DISPATCH');
  console.log('===========================================================');

  const payload = {
    fromEmail: 'newsletter@education.yourpaperedition.com',
    toEmail: 'checkingm13@gmail.com',
    subject: `🎉 Live OCI Deliverability Verification: Paper Edition (${new Date().toLocaleTimeString()})`,
    htmlBody: `
      <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #1e293b; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #c74a02; margin-top: 0;">🎉 Direct Oracle OCI Delivery Successful!</h2>
        <p>Hello,</p>
        <p>This email was dispatched directly via <b>Oracle Cloud Infrastructure (OCI) Email Delivery</b> using your fully verified domain <b>education.yourpaperedition.com</b>.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc; font-size: 13px;">
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Sender:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">newsletter@education.yourpaperedition.com</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Recipient:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">checkingm13@gmail.com</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">MTA Engine:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">Oracle Cloud Infrastructure (Email Delivery Mumbai)</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">SPF / DKIM:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">Verified Domain (2048-bit RSA DKIM + OCI SPF)</td></tr>
          <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Timestamp:</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${new Date().toISOString()}</td></tr>
        </table>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="font-size: 12px; color: #64748b;">Paper Edition &bull; Azure Graph Mailer OCI Engine</p>
      </div>
    `
  };

  console.log(`📤 Sending from: ${payload.fromEmail}`);
  console.log(`📥 Sending to  : ${payload.toEmail}`);
  console.log(`📨 Subject     : ${payload.subject}`);
  console.log('\nContacting Oracle Cloud SMTP Host (smtp.email.ap-mumbai-1.oci.oraclecloud.com:587)...');

  try {
    const result = await sendViaOCI(payload);
    console.log('\n===========================================================');
    console.log('🎉 SUCCESS! Oracle OCI Email Delivery Accepted the Email!');
    console.log('Message ID:', result.messageId);
    console.log('Response  :', result.response);
    console.log('===========================================================');
  } catch (error) {
    console.error('\n❌ OCI DISPATCH ERROR:');
    console.error(error.message);
    if (error.code) console.error('Error Code:', error.code);
    if (error.command) console.error('SMTP Command:', error.command);
  }
}

testOCI();
