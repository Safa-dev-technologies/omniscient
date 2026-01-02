/**
 * Web adapter types
 * Types specific to the Web channel adapter
 */

/**
 * Incoming message from web widget
 */
export interface WebIncomingMessage {
  /** Client-generated or server-provided session ID */
  sessionId?: string;
  /** Message text content */
  content: string;
  /** Type of content */
  contentType?: 'text' | 'file';
  /** ISO 8601 timestamp */
  timestamp?: string;
  /** Additional metadata from client */
  metadata?: {
    /** Current page URL */
    page?: string;
    /** Referrer URL */
    referrer?: string;
    /** User agent string */
    userAgent?: string;
    /** Browser language */
    language?: string;
    /** IANA timezone */
    timezone?: string;
  };
}

/**
 * Outgoing message to web widget
 */
export interface WebOutgoingMessage {
  /** Server-generated message ID */
  messageId: string;
  /** Message text content */
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Knowledge sources used (if any) */
  sources?: Array<{
    name: string;
    section?: string;
  }>;
  /** Suggested quick replies */
  suggestedReplies?: string[];
  /** Typing indicator */
  isTyping?: boolean;
  /** Whether conversation is escalated */
  isEscalated?: boolean;
}

/**
 * Session data stored in Redis/memory
 */
export interface WebSession {
  /** Unique session identifier */
  sessionId: string;
  /** Tenant ID this session belongs to */
  tenantId: string;
  /** Active conversation ID (if any) */
  conversationId?: string;
  /** User ID (if linked to User model) */
  userId?: string;
  /** When session was created */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Additional session metadata */
  metadata: Record<string, unknown>;
}

/**
 * Widget configuration (sent to client)
 */
export interface WebWidgetConfig {
  /** Tenant slug for identification */
  tenantSlug: string;
  /** Bot display name */
  botName: string;
  /** Welcome message shown on widget open */
  welcomeMessage?: string;
  /** Primary brand color (hex) */
  primaryColor?: string;
  /** Widget position on page */
  position?: 'left' | 'right';
  /** Input placeholder text */
  placeholder?: string;
  /** Offline mode configuration */
  offline?: {
    enabled: boolean;
    message: string;
    collectEmail?: boolean;
  };
}

/**
 * Real-time event types (for SSE/WebSocket)
 */
export interface WebEvent {
  /** Event type */
  type: 'message' | 'typing' | 'status' | 'error';
  /** Event payload */
  payload: unknown;
  /** ISO 8601 timestamp */
  timestamp: string;
}
