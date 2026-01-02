import type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppApiResponse,
} from '../../src/adapters/whatsapp/whatsapp.types.js';

/**
 * Mock WhatsApp text message payload
 */
export const mockWhatsAppTextMessage: WhatsAppWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'BUSINESS_ACCOUNT_ID',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15551234567',
              phone_number_id: 'PHONE_NUMBER_ID',
            },
            contacts: [
              {
                profile: { name: 'John Doe' },
                wa_id: '15559876543',
              },
            ],
            messages: [
              {
                from: '15559876543',
                id: 'wamid.xxx',
                timestamp: '1699900000',
                type: 'text',
                text: { body: 'Hello, I need help' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

/**
 * Mock WhatsApp status update (delivery receipt)
 */
export const mockWhatsAppStatusUpdate: WhatsAppWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'BUSINESS_ACCOUNT_ID',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15551234567',
              phone_number_id: 'PHONE_NUMBER_ID',
            },
            statuses: [
              {
                id: 'wamid.xxx',
                status: 'delivered',
                timestamp: '1699900001',
                recipient_id: '15559876543',
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

/**
 * Mock WhatsApp image message payload
 */
export const mockWhatsAppImageMessage: WhatsAppWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'BUSINESS_ACCOUNT_ID',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15551234567',
              phone_number_id: 'PHONE_NUMBER_ID',
            },
            contacts: [
              {
                profile: { name: 'John Doe' },
                wa_id: '15559876543',
              },
            ],
            messages: [
              {
                from: '15559876543',
                id: 'wamid.image',
                timestamp: '1699900000',
                type: 'image',
                image: {
                  id: 'IMAGE_ID',
                  mime_type: 'image/jpeg',
                  sha256: 'abc123',
                },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

/**
 * Mock WhatsApp interactive message (button click)
 */
export const mockWhatsAppButtonMessage: WhatsAppWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'BUSINESS_ACCOUNT_ID',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '15551234567',
              phone_number_id: 'PHONE_NUMBER_ID',
            },
            contacts: [
              {
                profile: { name: 'John Doe' },
                wa_id: '15559876543',
              },
            ],
            messages: [
              {
                from: '15559876543',
                id: 'wamid.button',
                timestamp: '1699900000',
                type: 'interactive',
                interactive: {
                  type: 'button',
                  body: { text: 'Choose an option' },
                  action: {
                    buttons: [
                      {
                        type: 'reply',
                        reply: {
                          id: 'option1',
                          title: 'Option 1',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

/**
 * Mock successful WhatsApp API response
 */
export const mockWhatsAppApiSuccess: WhatsAppApiResponse = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '15559876543', wa_id: '15559876543' }],
  messages: [{ id: 'wamid.xxx' }],
};

/**
 * Mock WhatsApp API error response
 */
export const mockWhatsAppApiError: WhatsAppApiResponse = {
  messaging_product: 'whatsapp',
  error: {
    message: 'Invalid OAuth access token',
    type: 'OAuthException',
    code: 190,
  },
};

/**
 * Mock WhatsApp credentials for testing
 */
export const mockWhatsAppCredentials = {
  phoneNumberId: 'PHONE_NUMBER_ID',
  accessToken: 'EAABcd123456789XYZ',
  webhookVerifyToken: 'verify_secret_token',
  businessAccountId: 'BUSINESS_ACCOUNT_ID',
};
