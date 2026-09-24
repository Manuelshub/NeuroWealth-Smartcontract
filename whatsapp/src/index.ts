import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { handleWhatsAppWebhook } from './webhook';
import { verifyTwilioSignature } from './twilioSignature';
import { assertConfig } from './cryptoUtils';

dotenv.config();
assertConfig();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'NeuroWealth WhatsApp Bot Handler' });
});

// WhatsApp Twilio Webhook route
// Only requests signed by Twilio (X-Twilio-Signature) reach the handler.
app.post('/api/whatsapp/webhook', verifyTwilioSignature(), handleWhatsAppWebhook);

app.listen(PORT, () => {
  console.log(`🚀 NeuroWealth WhatsApp Bot Handler running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/api/whatsapp/webhook`);
});
