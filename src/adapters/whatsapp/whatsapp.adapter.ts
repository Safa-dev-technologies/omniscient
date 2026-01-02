import { Channel } from '@prisma/client';
import type { ChannelAdapter } from '../adapter.interface.js';
import type {
  AdapterConfig,
  NormalizedMessage,
  SendMessageParams,
  SendResult,
  WebhookVerifyParams,
  WebhookVerifyResult,
  WhatsAppCredentials,
} from '../adapter.types.js';
import type {
  WhatsAppWebhookPayload,
  WhatsAppMessage,
  WhatsAppStatus,
  WhatsAppSendTextRequest,
  WhatsAppSendInteractiveRequest,
  WhatsAppApiResponse,
} from './whatsapp.types.js';
import { verifyWebhookSignature, formatPhoneNumber } from './whatsapp.utils.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/index.js';

/**
 * WhatsApp Adapter
 * Handles WhatsApp Business Cloud API integration
 */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = Channel.WHATSAPP;

  private phoneNumberId = '';
  private accessToken = '';
  private webhookVerifyToken = '';
  private appSecret = ''; // For signature verification
  private tenantId = '';
  private initialized = false;
  private apiBaseUrl = 'https://graph.facebook.com/v18.0';

  /**
   * Initialize the adapter
   */
  async initialize(config: AdapterConfig): Promise<void> {
    if (config.channel !== Channel.WHATSAPP) {
      throw new Error(`Invalid channel for WhatsAppAdapter: ${config.channel}`);
    }

    const credentials = config.credentials as WhatsAppCredentials & { appSecret?: string };
    this.phoneNumberId = credentials.phoneNumberId;
    this.accessToken = credentials.accessToken;
    this.webhookVerifyToken = credentials.webhookVerifyToken;
    // Get app secret from credentials or environment (for signature verification)
    this.appSecret = credentials.appSecret || (env as any).WHATSAPP_APP_SECRET || '';
    this.tenantId = config.tenantId;

    // Validate credentials by checking if phone number ID is accessible
    // (We can't easily test without making an API call, so we'll just validate structure)
    if (!this.phoneNumberId || !this.accessToken || !this.webhookVerifyToken) {
      throw new Error('Missing required WhatsApp credentials');
    }

    this.initialized = true;
    logger.info(
      { phoneNumberId: this.phoneNumberId, tenantId: this.tenantId },
      'WhatsApp adapter initialized'
    );
  }

  /**
   * Verify webhook (GET request during setup)
   */
  verifyWebhook(params: WebhookVerifyParams): WebhookVerifyResult {
    if (!this.initialized) {
      return { valid: false };
    }

    // Meta sends: hub.mode, hub.verify_token, hub.challenge
    if (params.mode === 'subscribe' && params.token === this.webhookVerifyToken) {
      return {
        valid: true,
        challenge: params.challenge,
      };
    }

    return { valid: false };
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: string | Buffer, signature: string): boolean {
    if (!this.appSecret) {
      logger.warn(
        { tenantId: this.tenantId },
        'WhatsApp webhook signature verification skipped (no app secret)'
      );
      return true; // If no secret configured, skip verification (not recommended for production)
    }

    const payloadString = typeof payload === 'string' ? payload : payload.toString('utf8');
    return verifyWebhookSignature(payloadString, signature, this.appSecret);
  }

  /**
   * Parse incoming webhook payload
   */
  async parseIncoming(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<NormalizedMessage | null> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    // Verify signature if app secret is configured
    if (this.appSecret) {
      const signature = headers?.['x-hub-signature-256'];
      if (!signature) {
        logger.warn({ tenantId: this.tenantId }, 'Missing WhatsApp webhook signature');
        throw new Error('Missing webhook signature');
      }

      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      if (!this.verifySignature(payloadString, signature)) {
        logger.warn({ tenantId: this.tenantId }, 'Invalid WhatsApp webhook signature');
        throw new Error('Invalid webhook signature');
      }
    }

    // Parse payload
    let webhookPayload: WhatsAppWebhookPayload;
    if (typeof payload === 'string') {
      webhookPayload = JSON.parse(payload) as WhatsAppWebhookPayload;
    } else if (typeof payload === 'object' && payload !== null) {
      webhookPayload = payload as WhatsAppWebhookPayload;
    } else {
      throw new Error('Invalid payload format');
    }

    // Extract messages from payload
    for (const entry of webhookPayload.entry || []) {
      for (const change of entry.changes || []) {
        // Handle status updates (delivery receipts) - return null
        if (change.value.statuses && change.value.statuses.length > 0) {
          // Log status for debugging but don't process as message
          logger.debug(
            { statuses: change.value.statuses, tenantId: this.tenantId },
            'WhatsApp status update received'
          );
          return null;
        }

        // Handle messages
        if (change.value.messages && change.value.messages.length > 0) {
          const message = change.value.messages[0]; // Process first message
          return this.parseMessage(message, change.value.contacts || []);
        }
      }
    }

    // No messages found
    return null;
  }

  /**
   * Parse WhatsApp message into normalized format
   */
  private parseMessage(
    message: WhatsAppMessage,
    contacts: Array<{ profile: { name: string }; wa_id: string }>
  ): NormalizedMessage {
    // Find contact info
    const contact = contacts.find((c) => c.wa_id === message.from);

    // Extract content and media info
    const { content, contentType, hasMedia, mediaType, mediaId } =
      this.extractMessageContent(message);

    // Build normalized message
    const normalized: NormalizedMessage = {
      externalId: message.id,
      externalUserId: message.from,
      channel: Channel.WHATSAPP,
      content: content || '',
      contentType,
      hasMedia,
      mediaType,
      // Media URL will be fetched lazily when needed
      timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
      metadata: {
        messageType: message.type,
        mediaId: mediaId,
        context: message.context, // Reply context
      },
      senderName: contact?.profile.name,
      senderPhone: message.from,
    };

    return normalized;
  }

  /**
   * Extract content and media info from WhatsApp message
   */
  private extractMessageContent(message: WhatsAppMessage): {
    content: string;
    contentType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
    hasMedia: boolean;
    mediaType?: string;
    mediaId?: string;
  } {
    // Text message
    if (message.type === 'text' && message.text) {
      return {
        content: message.text.body,
        contentType: 'text',
        hasMedia: false,
      };
    }

    // Image
    if (message.type === 'image' && message.image) {
      return {
        content: '', // Images don't have text content
        contentType: 'image',
        hasMedia: true,
        mediaType: message.image.mime_type,
        mediaId: message.image.id,
      };
    }

    // Video
    if (message.type === 'video' && message.video) {
      return {
        content: '',
        contentType: 'video',
        hasMedia: true,
        mediaType: message.video.mime_type,
        mediaId: message.video.id,
      };
    }

    // Audio
    if (message.type === 'audio' && message.audio) {
      return {
        content: '',
        contentType: 'audio',
        hasMedia: true,
        mediaType: message.audio.mime_type,
        mediaId: message.audio.id,
      };
    }

    // Document
    if (message.type === 'document' && message.document) {
      return {
        content: message.document.filename || '',
        contentType: 'document',
        hasMedia: true,
        mediaType: message.document.mime_type,
        mediaId: message.document.id,
      };
    }

    // Location
    if (message.type === 'location' && message.location) {
      return {
        content: `Location: ${message.location.latitude}, ${message.location.longitude}${
          message.location.name ? ` (${message.location.name})` : ''
        }`,
        contentType: 'location',
        hasMedia: false,
      };
    }

    // Interactive/Button (button click)
    if ((message.type === 'interactive' || message.type === 'button') && message.interactive) {
      // Extract button ID from interactive response
      const buttonId =
        message.interactive.action?.buttons?.[0]?.reply?.id || message.button?.payload || '';
      return {
        content: buttonId,
        contentType: 'text',
        hasMedia: false,
      };
    }

    if (message.type === 'button' && message.button) {
      return {
        content: message.button.payload,
        contentType: 'text',
        hasMedia: false,
      };
    }

    // Reaction, contacts, etc. - extract what we can
    if (message.type === 'reaction' && message.reaction) {
      return {
        content: message.reaction.emoji,
        contentType: 'text',
        hasMedia: false,
      };
    }

    // Default: empty text
    return {
      content: '',
      contentType: 'text',
      hasMedia: false,
    };
  }

  /**
   * Send message
   */
  async sendMessage(params: SendMessageParams): Promise<SendResult> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    // Validate and format phone number
    let phoneNumber: string;
    try {
      phoneNumber = formatPhoneNumber(params.externalUserId);
    } catch (error: any) {
      return {
        success: false,
        error: `Invalid phone number: ${error.message}`,
        timestamp: new Date(),
      };
    }

    // Validate content - WhatsApp requires non-empty text messages
    if (!params.content || params.content.trim().length === 0) {
      return {
        success: false,
        error: 'Message content cannot be empty',
        timestamp: new Date(),
      };
    }

    // Validate content length
    if (params.content.length > 4096) {
      return {
        success: false,
        error: 'Message content exceeds maximum length of 4096 characters',
        timestamp: new Date(),
      };
    }

    // Build request
    let request: WhatsAppSendTextRequest | WhatsAppSendInteractiveRequest;

    // If buttons provided, use interactive message
    if (params.buttons && params.buttons.length > 0) {
      // Validate button count (max 3 buttons)
      if (params.buttons.length > 3) {
        return {
          success: false,
          error: 'Too many buttons (max 3)',
          timestamp: new Date(),
        };
      }

      // Validate button text length (max 20 chars)
      for (const btn of params.buttons) {
        if (btn.text.length > 20) {
          return {
            success: false,
            error: 'Button text exceeds maximum length of 20 characters',
            timestamp: new Date(),
          };
        }
      }

      request = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: params.content.substring(0, 1024) }, // Max 1024 chars for body
          action: {
            buttons: params.buttons.slice(0, 3).map((btn) => ({
              type: 'reply' as const,
              reply: {
                id: (btn.payload || btn.id).substring(0, 256), // Max 256 chars for button ID
                title: btn.text.substring(0, 20), // Max 20 chars for button text
              },
            })),
          },
        },
      };
    } else {
      // Text message
      request = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phoneNumber,
        type: 'text',
        text: {
          body: params.content,
          preview_url: false, // Set to true if you want link previews
        },
      };
    }

    // Send message
    try {
      const url = `${this.apiBaseUrl}/${this.phoneNumberId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      const data = (await response.json()) as WhatsAppApiResponse;

      if (data.error) {
        logger.error(
          {
            error: data.error.message,
            errorCode: data.error.code,
            tenantId: this.tenantId,
          },
          'Failed to send WhatsApp message'
        );

        // Map error codes to user-friendly messages
        let errorMessage = data.error.message;
        if (data.error.code === 190) {
          errorMessage = 'Invalid access token';
        } else if (data.error.code === 131030) {
          errorMessage = 'Rate limit exceeded';
        } else if (data.error.code === 131051) {
          errorMessage = 'Invalid phone number';
        }

        return {
          success: false,
          error: errorMessage,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        externalMessageId: data.messages?.[0]?.id,
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error, tenantId: this.tenantId }, 'Error sending WhatsApp message');
      return {
        success: false,
        error: error.message || 'Network error',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    // We can't easily check WhatsApp API health without making a request
    // For now, just check if initialized
    return true;
  }
}
