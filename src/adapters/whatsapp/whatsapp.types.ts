/**
 * WhatsApp Cloud API types
 * Based on https://developers.facebook.com/docs/whatsapp/cloud-api
 */

/**
 * Incoming webhook payload structure
 */
export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: WhatsAppEntry[];
}

/**
 * Webhook entry
 */
export interface WhatsAppEntry {
  id: string; // Business Account ID
  changes: WhatsAppChange[];
}

/**
 * Webhook change
 */
export interface WhatsAppChange {
  value: {
    messaging_product: 'whatsapp';
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[]; // Delivery receipts
    errors?: WhatsAppError[];
  };
  field: 'messages';
}

/**
 * WhatsApp contact
 */
export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string; // WhatsApp ID (phone number)
}

/**
 * WhatsApp message
 */
export interface WhatsAppMessage {
  from: string; // Sender's phone number
  id: string; // Message ID
  timestamp: string; // Unix timestamp
  type:
    | 'text'
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'location'
    | 'contacts'
    | 'interactive'
    | 'button'
    | 'reaction';
  text?: { body: string };
  image?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  video?: WhatsAppMedia;
  document?: WhatsAppMedia & { filename: string };
  location?: { latitude: number; longitude: number; name?: string };
  interactive?: WhatsAppInteractive;
  button?: { text: string; payload: string };
  reaction?: { message_id: string; emoji: string };
  context?: { from: string; id: string }; // Reply context
}

/**
 * WhatsApp interactive message
 */
export interface WhatsAppInteractive {
  type: 'button' | 'list';
  body?: { text: string };
  action?: {
    buttons?: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
    button?: string;
    sections?: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
}

/**
 * WhatsApp media
 */
export interface WhatsAppMedia {
  id: string; // Media ID (need to fetch URL separately)
  mime_type: string;
  sha256: string;
}

/**
 * WhatsApp status (delivery receipt)
 */
export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: WhatsAppError[];
}

/**
 * WhatsApp error
 */
export interface WhatsAppError {
  code: number;
  title: string;
  message: string;
  error_data?: { details: string };
}

/**
 * Outgoing text message request
 */
export interface WhatsAppSendTextRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

/**
 * Outgoing interactive message request
 */
export interface WhatsAppSendInteractiveRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button' | 'list';
    body: { text: string };
    action: {
      buttons?: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
      // For list type
      button?: string;
      sections?: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };
  };
}

/**
 * WhatsApp API response
 */
export interface WhatsAppApiResponse {
  messaging_product: 'whatsapp';
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

/**
 * WhatsApp media response (from get media endpoint)
 */
export interface WhatsAppMediaResponse {
  url: string;
  mime_type: string;
  sha256: string;
  file_size: number;
  id: string;
}
