import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSessionManager,
  type SessionManager,
} from '../../../src/adapters/web/web.session.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    // Use memory storage for tests
    sessionManager = createSessionManager(false, 30);
  });

  describe('getOrCreateSession', () => {
    it('should generate cryptographically random session ID', async () => {
      const session1 = await sessionManager.getOrCreateSession('tenant1');
      const session2 = await sessionManager.getOrCreateSession('tenant1');

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ); // UUID v4 format
    });

    it('should bind session to tenant', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');

      const isValid = await sessionManager.validateSession(session.sessionId, 'tenant1');
      const isInvalid = await sessionManager.validateSession(session.sessionId, 'tenant2');

      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });

    it('should create session with metadata', async () => {
      const metadata = { page: 'https://example.com', userAgent: 'Mozilla/5.0' };
      const session = await sessionManager.getOrCreateSession('tenant1', undefined, metadata);

      expect(session.metadata).toEqual(metadata);
    });

    it('should retrieve existing session if valid sessionId provided', async () => {
      const session1 = await sessionManager.getOrCreateSession('tenant1');
      const session2 = await sessionManager.getOrCreateSession('tenant1', session1.sessionId);

      expect(session2.sessionId).toBe(session1.sessionId);
      expect(session2.tenantId).toBe(session1.tenantId);
    });

    it('should create new session if sessionId belongs to different tenant', async () => {
      const session1 = await sessionManager.getOrCreateSession('tenant1');

      // Try to get session with sessionId from tenant1 but for tenant2
      // This should create a new session since session belongs to tenant1
      const session2 = await sessionManager.getOrCreateSession('tenant2', session1.sessionId);

      expect(session2.sessionId).not.toBe(session1.sessionId);
      expect(session2.tenantId).toBe('tenant2');
    });

    it('should throw error for invalid session ID format', async () => {
      await expect(sessionManager.getOrCreateSession('tenant1', 'not-a-uuid')).rejects.toThrow(
        'Invalid session ID format'
      );
    });
  });

  describe('getSession', () => {
    it('should retrieve existing session', async () => {
      const created = await sessionManager.getOrCreateSession('tenant1');
      const retrieved = await sessionManager.getSession(created.sessionId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.sessionId).toBe(created.sessionId);
      expect(retrieved!.tenantId).toBe(created.tenantId);
    });

    it('should return null for non-existent session', async () => {
      const retrieved = await sessionManager.getSession('550e8400-e29b-41d4-a716-446655440000');
      expect(retrieved).toBeNull();
    });

    it('should return null for invalid session ID format', async () => {
      const retrieved = await sessionManager.getSession('not-a-uuid');
      expect(retrieved).toBeNull();
    });
  });

  describe('touchSession', () => {
    it('should update last activity timestamp', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');
      const originalActivity = session.lastActivityAt;

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      await sessionManager.touchSession(session.sessionId);
      const updated = await sessionManager.getSession(session.sessionId);

      expect(updated!.lastActivityAt.getTime()).toBeGreaterThan(originalActivity.getTime());
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        sessionManager.touchSession('550e8400-e29b-41d4-a716-446655440000')
      ).rejects.toThrow('Session not found');
    });
  });

  describe('linkConversation', () => {
    it('should link conversation to session', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');
      const conversationId = 'conv-123';

      await sessionManager.linkConversation(session.sessionId, conversationId);
      const updated = await sessionManager.getSession(session.sessionId);

      expect(updated!.conversationId).toBe(conversationId);
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        sessionManager.linkConversation('550e8400-e29b-41d4-a716-446655440000', 'conv-123')
      ).rejects.toThrow('Session not found');
    });
  });

  describe('linkUser', () => {
    it('should link user to session', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');
      const userId = 'user-123';

      await sessionManager.linkUser(session.sessionId, userId);
      const updated = await sessionManager.getSession(session.sessionId);

      expect(updated!.userId).toBe(userId);
    });
  });

  describe('validateSession', () => {
    it('should return true for valid session belonging to tenant', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');
      const isValid = await sessionManager.validateSession(session.sessionId, 'tenant1');

      expect(isValid).toBe(true);
    });

    it('should return false for session belonging to different tenant', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');
      const isValid = await sessionManager.validateSession(session.sessionId, 'tenant2');

      expect(isValid).toBe(false);
    });

    it('should return false for invalid session ID format', async () => {
      expect(await sessionManager.validateSession('not-a-uuid', 'tenant1')).toBe(false);
    });

    it('should return false for non-existent session', async () => {
      expect(
        await sessionManager.validateSession('550e8400-e29b-41d4-a716-446655440000', 'tenant1')
      ).toBe(false);
    });
  });

  describe('deleteSession', () => {
    it('should delete session', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');
      await sessionManager.deleteSession(session.sessionId);

      const retrieved = await sessionManager.getSession(session.sessionId);
      expect(retrieved).toBeNull();
    });
  });
});
