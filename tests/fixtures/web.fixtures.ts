import type { WebIncomingMessage, WebSession } from '../../src/adapters/web/web.types.js';

/**
 * Mock Web incoming message
 */
export const mockWebMessage: WebIncomingMessage = {
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  content: 'Hello, I need help',
  contentType: 'text',
  timestamp: new Date().toISOString(),
  metadata: {
    page: 'https://example.com/help',
    referrer: 'https://example.com',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    language: 'en-US',
    timezone: 'America/New_York',
  },
};

/**
 * Mock Web incoming message without sessionId (should create new session)
 */
export const mockWebMessageNoSession: WebIncomingMessage = {
  content: 'Hello',
  contentType: 'text',
};

/**
 * Mock Web incoming message with empty content (should be rejected)
 */
export const mockWebMessageEmpty: WebIncomingMessage = {
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  content: '',
  contentType: 'text',
};

/**
 * Mock Web incoming message with too long content (should be rejected)
 */
export const mockWebMessageTooLong: WebIncomingMessage = {
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  content: 'x'.repeat(5000), // Exceeds 4096 char limit
  contentType: 'text',
};

/**
 * Mock Web session
 */
export const mockWebSession: WebSession = {
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: 'tenant-123',
  conversationId: 'conv-123',
  userId: 'user-123',
  createdAt: new Date(),
  lastActivityAt: new Date(),
  metadata: {
    page: 'https://example.com/help',
  },
};

/**
 * Mock Web credentials for testing
 */
export const mockWebCredentials = {
  allowedOrigins: ['https://example.com', 'https://app.example.com'],
  rateLimit: 20,
  sessionTimeout: 30,
};
