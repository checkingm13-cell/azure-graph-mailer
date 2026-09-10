require('dotenv').config();
const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');

async function testEmail() {
  console.log('🔄 Authenticating with Microsoft Graph...');

  const tenantId = process.env.TENANT_ID || process.env.AZURE_TENANT_ID;
  const clientId = process.env.CLIENT_ID || process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET;
  const senderEmail = process.env.DEFAULT_SENDER_EMAIL || 'dr.reetashah@theparipexjournal.com';
  const recipientEmail = process.argv[2] || 'checkingm13@gmail.com';

  console.log(`📋 Configuration:`);
  console.log(`   - Sender Email   : ${senderEmail}`);
  console.log(`   - Recipient Email: ${recipientEmail}`);
  console.log(`   - Tenant ID      : ${tenantId ? tenantId.slice(0, 8) + '...' : 'MISSING'}`);
  console.log(`   - Client ID      : ${clientId ? clientId.slice(0, 8) + '...' : 'MISSING'}`);

  // 1. Get Token
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const token = await credential.getToken('https://graph.microsoft.com/.default');
  console.log('🔑 Authentication Token acquired successfully!');

  // 2. Setup Graph Client
  const graphClient = Client.init({
    authProvider: (done) => {
      done(null, token.token);
    }
  });

  // 3. Email Payload
  const mail = {
    message: {
      subject: "✅ Test Successful: Azure Graph Mailer is LIVE!",
      body: {
        contentType: "HTML",
        content: `<h2>Congratulations Hamza! 🎉</h2>
<p>Your multi-account automation engine is successfully connected to Microsoft Graph API.</p>
<p><b>Dedicated Sender:</b> ${senderEmail}</p>
<p><b>Recipient:</b> ${recipientEmail}</p>
<p><b>Timestamp:</b> ${new Date().toISOString()}</p>
<hr/>
<p><i>Journal Paripex - Academic Editorial System</i></p>`
      },
      toRecipients: [
        {
          emailAddress: {
            address: recipientEmail
          }
        }
      ]
    },
    saveToSentItems: "false"
  };

  try {
    console.log(`📤 Sending test email from: ${senderEmail}...`);

    // 4. Send via Graph API
    await graphClient.api(`/users/${senderEmail}/sendMail`).post(mail);

    console.log('\n===========================================================');
    console.log(`🎉 SUCCESS! Email bhej diya gaya hai to "${recipientEmail}".`);
    console.log('👉 Apna inbox (aur Spam/Promotions folder) check karo!');
    console.log('===========================================================');
  } catch (error) {
    console.error('\n❌ FAILED:', error.message);
    if (error.statusCode === 403) {
      console.error('🔒 Permission Error (403): Check if Mail.Send (Application) has Admin Consent in Azure Portal.');
    } else if (error.statusCode === 404) {
      console.error('📭 Not Found (404): Mailbox does not exist yet or is not provisioned in Exchange Online.');
      console.error('👉 Make sure "dr.reetashah@theparipexjournal.com" is created as a Shared Mailbox in Microsoft 365 Admin Center.');
    } else {
      console.error('Status Code:', error.statusCode);
      if (error.body) console.error('Response Body:', error.body);
    }
  }
}

testEmail();
