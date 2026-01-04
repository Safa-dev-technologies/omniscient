import { Channel } from '@prisma/client';
import type { ChannelAdapter } from '../adapter.interface.js';
import type {
  AdapterConfig,
  NormalizedMessage,
  SendMessageParams,
  SendResult,
  TelegramCredentials,
} from '../adapter.types.js';
import type {
  TelegramUpdate,
  TelegramMessage,
  TelegramCallbackQuery,
  TelegramApiResponse,
  TelegramSendMessageRequest,
} from './telegram.types.js';
import { verifyWebhookSecret, getDisplayName } from './telegram.utils.js';
import { logger } from '../../lib/logger.js';

/**
 * Telegram Adapter
 * Handles Telegram Bot API integration
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly channel = Channel.TELEGRAM;

  private botToken = '';
  private webhookSecret?: string;
  private botInfo?: { id: number; username?: string; first_name: string };
  private tenantId = '';
  private initialized = false;
  private apiBaseUrl = '';

  /**
   * Initialize the adapter
   */
  async initialize(config: AdapterConfig): Promise<void> {
    if (config.channel !== Channel.TELEGRAM) {
      throw new Error(`Invalid channel for TelegramAdapter: ${config.channel}`);
    }

    const credentials = config.credentials as TelegramCredentials;
    this.botToken = credentials.botToken;
    this.webhookSecret = credentials.webhookSecret;
    this.tenantId = config.tenantId;
    this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;

    // Validate token by calling getMe
    try {
      const response = await fetch(`${this.apiBaseUrl}/getMe`);
      const data = (await response.json()) as TelegramApiResponse<{
        id: number;
        username?: string;
        first_name: string;
      }>;

      if (!data.ok || !data.result) {
        throw new Error(`Invalid bot token: ${data.description || 'Unknown error'}`);
      }

      this.botInfo = data.result;
      this.initialized = true;
      logger.info(
        { botId: this.botInfo.id, botUsername: this.botInfo.username, tenantId: this.tenantId },
        'Telegram adapter initialized'
      );
    } catch (error: any) {
      logger.error({ error, tenantId: this.tenantId }, 'Failed to initialize Telegram adapter');
      throw new Error(`Failed to initialize Telegram adapter: ${error.message}`);
    }
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      // If no secret configured, skip verification
      return true;
    }

    // Telegram uses X-Telegram-Bot-Api-Secret-Token header
    // The signature parameter here is the header value
    return verifyWebhookSecret(signature, this.webhookSecret);
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

    // Verify webhook secret if configured
    if (this.webhookSecret) {
      const headerToken = headers?.['x-telegram-bot-api-secret-token'];
      if (!verifyWebhookSecret(headerToken, this.webhookSecret)) {
        logger.warn({ tenantId: this.tenantId }, 'Invalid Telegram webhook secret');
        throw new Error('Invalid webhook secret');
      }
    }

    // Parse payload
    let update: TelegramUpdate;
    if (typeof payload === 'string') {
      update = JSON.parse(payload) as TelegramUpdate;
    } else if (typeof payload === 'object' && payload !== null) {
      update = payload as TelegramUpdate;
    } else {
      throw new Error('Invalid payload format');
    }

    // Handle callback queries (button clicks)
    if (update.callback_query) {
      return this.parseCallbackQuery(update.callback_query);
    }

    // Handle messages
    const message = update.message || update.edited_message;
    if (!message) {
      // Channel posts, etc. - ignore for now
      return null;
    }

    // Ignore system messages
    if (
      message.new_chat_members ||
      message.left_chat_member ||
      message.group_chat_created ||
      message.chat.type === 'channel'
    ) {
      return null;
    }

    // Extract content and media info
    const { content, contentType, hasMedia, mediaType, mediaUrl } =
      this.extractMessageContent(message);

    if (!content && !hasMedia) {
      // Empty message - ignore
      return null;
    }

    // Build normalized message
    const normalized: NormalizedMessage = {
      externalId: message.message_id.toString(),
      externalUserId: message.from?.id.toString() || '',
      externalConversationId: message.chat.id.toString(),
      channel: Channel.TELEGRAM,
      content: content || '',
      contentType,
      hasMedia,
      mediaType,
      mediaUrl,
      timestamp: new Date(message.date * 1000),
      metadata: {
        chatType: message.chat.type,
        chatTitle: message.chat.title,
        replyToMessageId: message.reply_to_message?.message_id,
        mediaGroupId: message.media_group_id,
      },
      senderName: message.from ? getDisplayName(message.from) : undefined,
      senderUsername: message.from?.username,
    };

    return normalized;
  }

  /**
   * Parse callback query (button click)
   */
  private parseCallbackQuery(callbackQuery: TelegramCallbackQuery): NormalizedMessage {
    const message = callbackQuery.message;
    const content = callbackQuery.data || '';

    return {
      externalId: callbackQuery.id,
      externalUserId: callbackQuery.from.id.toString(),
      externalConversationId: message?.chat.id.toString(),
      channel: Channel.TELEGRAM,
      content,
      contentType: 'text',
      hasMedia: false,
      timestamp: new Date(),
      metadata: {
        isCallbackQuery: true,
        chatInstance: callbackQuery.chat_instance,
        originalMessageId: message?.message_id,
      },
      senderName: getDisplayName(callbackQuery.from),
      senderUsername: callbackQuery.from.username,
    };
  }

  /**
   * Extract content and media info from Telegram message
   */
  private extractMessageContent(message: TelegramMessage): {
    content: string;
    contentType: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
    hasMedia: boolean;
    mediaType?: string;
    mediaUrl?: string;
  } {
    // Text message
    if (message.text) {
      return {
        content: message.text,
        contentType: 'text',
        hasMedia: false,
      };
    }

    // Photo
    if (message.photo && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      return {
        content: message.caption || '',
        contentType: 'image',
        hasMedia: true,
        mediaType: 'image/jpeg',
        mediaUrl: `https://api.telegram.org/file/bot${this.botToken}/${largestPhoto.file_id}`,
      };
    }

    // Video
    if (message.video) {
      return {
        content: message.caption || '',
        contentType: 'video',
        hasMedia: true,
        mediaType: message.video.mime_type || 'video/mp4',
        mediaUrl: `https://api.telegram.org/file/bot${this.botToken}/${message.video.file_id}`,
      };
    }

    // Audio
    if (message.audio) {
      return {
        content: message.caption || message.audio.title || '',
        contentType: 'audio',
        hasMedia: true,
        mediaType: message.audio.mime_type || 'audio/mpeg',
        mediaUrl: `https://api.telegram.org/file/bot${this.botToken}/${message.audio.file_id}`,
      };
    }

    // Voice
    if (message.voice) {
      return {
        content: message.caption || '',
        contentType: 'audio',
        hasMedia: true,
        mediaType: message.voice.mime_type || 'audio/ogg',
        mediaUrl: `https://api.telegram.org/file/bot${this.botToken}/${message.voice.file_id}`,
      };
    }

    // Document
    if (message.document) {
      return {
        content: message.caption || message.document.file_name || '',
        contentType: 'document',
        hasMedia: true,
        mediaType: message.document.mime_type || 'application/octet-stream',
        mediaUrl: `https://api.telegram.org/file/bot${this.botToken}/${message.document.file_id}`,
      };
    }

    // Sticker (treat as image)
    if (message.sticker) {
      return {
        content: message.sticker.emoji || '',
        contentType: 'image',
        hasMedia: true,
        mediaType: 'image/webp',
        mediaUrl: `https://api.telegram.org/file/bot${this.botToken}/${message.sticker.file_id}`,
      };
    }

    // Location
    if (message.location) {
      return {
        content: `Location: ${message.location.latitude}, ${message.location.longitude}`,
        contentType: 'location',
        hasMedia: false,
      };
    }

    // Contact
    if (message.contact) {
      return {
        content: `Contact: ${message.contact.first_name} ${message.contact.phone_number}`,
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
      return {
        success: false,
        error: 'Adapter not initialized',
        timestamp: new Date(),
      };
    }

    // Validate content - Telegram requires non-empty text messages
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
    const request: TelegramSendMessageRequest = {
      chat_id: params.externalUserId,
      text: params.content,
      parse_mode: 'HTML', // Use HTML to avoid escaping issues
    };

    // Add reply_to_message_id if provided
    if (params.replyToMessageId) {
      request.reply_to_message_id = parseInt(params.replyToMessageId, 10);
    }

    // Add inline keyboard if buttons provided
    if (params.buttons && params.buttons.length > 0) {
      // Validate button count (max 100 total, max 8 per row)
      if (params.buttons.length > 100) {
        return {
          success: false,
          error: 'Too many buttons (max 100)',
          timestamp: new Date(),
        };
      }

      // Group buttons into rows (max 8 per row)
      const rows: Array<Array<{ text: string; callback_data: string }>> = [];
      for (let i = 0; i < params.buttons.length; i += 8) {
        const row = params.buttons.slice(i, i + 8).map((btn) => ({
          text: btn.text.substring(0, 64), // Max 64 bytes for button text
          callback_data: (btn.payload || btn.id).substring(0, 64), // Max 64 bytes for callback_data
        }));
        rows.push(row);
      }

      request.reply_markup = {
        inline_keyboard: rows,
      };
    }

    // Send message
    try {
      const response = await fetch(`${this.apiBaseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const data = (await response.json()) as TelegramApiResponse<TelegramMessage>;

      if (!data.ok) {
        logger.error(
          { error: data.description, errorCode: data.error_code, tenantId: this.tenantId },
          'Failed to send Telegram message'
        );
        return {
          success: false,
          error: data.description || 'Unknown error',
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        externalMessageId: data.result?.message_id.toString(),
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error, tenantId: this.tenantId }, 'Error sending Telegram message');
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

    try {
      const response = await fetch(`${this.apiBaseUrl}/getMe`);
      const data = (await response.json()) as TelegramApiResponse<unknown>;
      return data.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Set webhook URL
   */
  async setWebhook(url: string, secretToken?: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    try {
      const body: {
        url: string;
        secret_token?: string;
        allowed_updates?: string[];
      } = {
        url,
        allowed_updates: ['message', 'callback_query'],
      };

      if (secretToken) {
        body.secret_token = secretToken;
      }

      const response = await fetch(`${this.apiBaseUrl}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as TelegramApiResponse<boolean>;
      return data.ok === true;
    } catch (error: any) {
      logger.error({ error, tenantId: this.tenantId }, 'Failed to set Telegram webhook');
      return false;
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/deleteWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drop_pending_updates: true }),
      });

      const data = (await response.json()) as TelegramApiResponse<boolean>;
      return data.ok === true;
    } catch (error: any) {
      logger.error({ error, tenantId: this.tenantId }, 'Failed to delete Telegram webhook');
      return false;
    }
  }

  /**
   * Answer callback query (for inline buttons)
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    try {
      const body: { callback_query_id: string; text?: string; show_alert?: boolean } = {
        callback_query_id: callbackQueryId,
      };

      if (text) {
        body.text = text.substring(0, 200); // Max 200 chars
        body.show_alert = false; // Toast notification, not alert
      }

      const response = await fetch(`${this.apiBaseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as TelegramApiResponse<boolean>;
      return data.ok === true;
    } catch (error: any) {
      logger.error({ error, tenantId: this.tenantId }, 'Failed to answer callback query');
      return false;
    }
  }
}
