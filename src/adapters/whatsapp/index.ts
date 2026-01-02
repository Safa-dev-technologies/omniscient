/**
 * WhatsApp Adapter
 * WhatsApp Business Cloud API integration
 */

export { WhatsAppAdapter } from './whatsapp.adapter.js';
export type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppStatus,
  WhatsAppApiResponse,
  WhatsAppSendTextRequest,
  WhatsAppSendInteractiveRequest,
} from './whatsapp.types.js';
export { verifyWebhookSignature, getMediaUrl, formatPhoneNumber } from './whatsapp.utils.js';
