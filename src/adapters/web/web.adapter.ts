import { Channel } from '@prisma/client';
import type { ChannelAdapter } from '../adapter.interface.js';
import type {
  AdapterConfig,
  NormalizedMessage,
  SendMessageParams,
  SendResult,
  WebCredentials,
} from '../adapter.types.js';
import { createSessionManager, type SessionManager } from './web.session.js';
import type { WebIncomingMessage, WebSession, WebWidgetConfig } from './web.types.js';
import { logger } from '../../lib/logger.js';

/**
 * Web Adapter
 * Handles browser-based chat widgets
 */
export class WebAdapter implements ChannelAdapter {
  readonly channel = Channel.WEB;

  private allowedOrigins: string[] = [];
  private rateLimit: number = 20; // messages per minute
  private sessionTimeout: number = 30; // minutes
  private sessionManager!: SessionManager;
  private tenantId!: string;
  private initialized = false;

  /**
   * Initialize the adapter
   */
  async initialize(config: AdapterConfig): Promise<void> {
    if (config.channel !== Channel.WEB) {
      throw new Error(`Invalid channel for WebAdapter: ${config.channel}`);
    }

    const credentials = config.credentials as WebCredentials;
    this.allowedOrigins = credentials.allowedOrigins || [];
    this.rateLimit = credentials.rateLimit || 20;
    this.sessionTimeout = credentials.sessionTimeout || 30;
    this.tenantId = config.tenantId;

    // Create session manager (use Redis in production, memory in dev)
    const useRedis = process.env.SESSION_STORE === 'redis' || process.env.NODE_ENV === 'production';
    this.sessionManager = createSessionManager(useRedis, this.sessionTimeout);

    this.initialized = true;
    logger.info({ tenantId: this.tenantId }, 'Web adapter initialized');
  }

  /**
   * Validate origin against allowed origins
   */
  validateOrigin(origin: string): boolean {
    if (!origin) return false;

    // Normalize origins (remove trailing slashes, lowercase)
    const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
    const normalizedAllowed = this.allowedOrigins.map((o) => o.replace(/\/$/, '').toLowerCase());

    return normalizedAllowed.includes(normalizedOrigin);
  }

  /**
   * Get or create session
   */
  async getSession(sessionId?: string): Promise<WebSession> {
    if (!this.initialized) {
      throw new Error('Adapter not initialized');
    }

    return this.sessionManager.getOrCreateSession(this.tenantId, sessionId);
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

    // Validate origin if provided
    const origin = headers?.origin || headers?.referer;
    if (origin && !this.validateOrigin(origin)) {
      logger.warn({ origin, tenantId: this.tenantId }, 'Invalid origin for web adapter');
      throw new Error('Invalid origin');
    }

    // Parse payload
    let message: WebIncomingMessage;
    if (typeof payload === 'string') {
      message = JSON.parse(payload) as WebIncomingMessage;
    } else if (typeof payload === 'object' && payload !== null) {
      message = payload as WebIncomingMessage;
    } else {
      throw new Error('Invalid payload format');
    }

    // Validate content
    if (!message.content || message.content.trim().length === 0) {
      throw new Error('Message content cannot be empty');
    }

    // Check content length (4096 chars max)
    if (message.content.length > 4096) {
      throw new Error('Message content exceeds maximum length of 4096 characters');
    }

    // Handle file uploads (not supported yet)
    if (message.contentType === 'file') {
      logger.warn('File uploads not yet supported');
      return null;
    }

    // Get or create session
    let session: WebSession;
    try {
      session = await this.getSession(message.sessionId);
    } catch (error: any) {
      if (error.message.includes('Invalid session ID')) {
        throw new Error('Invalid session ID format');
      }
      throw error;
    }

    // Build normalized message
    const normalized: NormalizedMessage = {
      externalId: `web_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      externalUserId: session.sessionId,
      externalConversationId: session.conversationId,
      channel: Channel.WEB,
      content: message.content.trim(),
      contentType: 'text',
      hasMedia: false,
      timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
      metadata: message.metadata || {},
    };

    return normalized;
  }

  /**
   * Send message (not used for web - messages are sent via HTTP response)
   * This is a placeholder implementation
   */
  async sendMessage(_params: SendMessageParams): Promise<SendResult> {
    // Web adapter doesn't use this method - messages are sent via HTTP responses
    // This exists only to satisfy the interface
    throw new Error('Web adapter does not support sendMessage - use HTTP responses instead');
  }

  /**
   * Get widget configuration for client
   */
  getWidgetConfig(tenant: {
    slug: string;
    botName: string;
    welcomeMessage?: string | null;
    settings?: Record<string, unknown> | null;
  }): WebWidgetConfig {
    const settings = (tenant.settings as Record<string, unknown>) || {};
    const widgetSettings = (settings.widget as Record<string, unknown>) || {};

    return {
      tenantSlug: tenant.slug,
      botName: tenant.botName,
      welcomeMessage: tenant.welcomeMessage || undefined,
      primaryColor: (widgetSettings.primaryColor as string) || '#0066cc',
      position: (widgetSettings.position as 'left' | 'right') || 'right',
      placeholder: (widgetSettings.placeholder as string) || 'Type your message...',
      offline: widgetSettings.offline
        ? {
            enabled: (widgetSettings.offline as Record<string, unknown>).enabled as boolean,
            message: (widgetSettings.offline as Record<string, unknown>).message as string,
            collectEmail: (widgetSettings.offline as Record<string, unknown>)
              .collectEmail as boolean,
          }
        : undefined,
    };
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    if (!this.initialized) {
      return false;
    }

    // Check if session manager is working
    try {
      const testSession = await this.sessionManager.getOrCreateSession(this.tenantId, undefined, {
        healthCheck: true,
      });
      await this.sessionManager.deleteSession(testSession.sessionId);
      return true;
    } catch {
      return false;
    }
  }
}
