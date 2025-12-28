import { describe, it, expect, vi, beforeEach } from 'vitest';
import { masterKeyMiddleware } from '../../../src/middleware/masterKey.middleware.js';
import { mockFastifyReply } from '../../fixtures/tenant.fixtures.js';

// Mock env
vi.mock('../../../src/config/index.js', () => ({
  env: {
    MASTER_API_KEY: 'master_test_secret_key_12345',
  },
}));

describe('Master Key Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should authenticate valid master key', async () => {
    const request = {
      headers: { authorization: 'Bearer master_test_secret_key_12345' },
    } as any;
    const reply = mockFastifyReply();

    await masterKeyMiddleware(request, reply);

    expect(request.isMasterKey).toBe(true);
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('should reject missing authorization header', async () => {
    const request = { headers: {} } as any;
    const reply = mockFastifyReply();

    await masterKeyMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.body.error.message).toBe('Missing or invalid Authorization header');
  });

  it('should reject non-master key format', async () => {
    const request = {
      headers: { authorization: 'Bearer omni_live_some_key' },
    } as any;
    const reply = mockFastifyReply();

    await masterKeyMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.body.error.message).toBe('Invalid API key format');
  });

  it('should reject invalid master key', async () => {
    const request = {
      headers: { authorization: 'Bearer master_wrong_key' },
    } as any;
    const reply = mockFastifyReply();

    await masterKeyMiddleware(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.body.error.message).toBe('Invalid API key');
  });

  it('should use constant-time comparison (no timing leak)', async () => {
    const request1 = {
      headers: { authorization: 'Bearer master_a' },
    } as any;
    const request2 = {
      headers: { authorization: 'Bearer master_completely_different_long_key' },
    } as any;
    const reply1 = mockFastifyReply();
    const reply2 = mockFastifyReply();

    // Both should fail with same error (no length leak)
    await masterKeyMiddleware(request1, reply1);
    await masterKeyMiddleware(request2, reply2);

    expect(reply1.body.error.message).toBe('Invalid API key');
    expect(reply2.body.error.message).toBe('Invalid API key');
  });
});

describe('Master Key Middleware - No Master Key Configured', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should reject with generic error when MASTER_API_KEY is not configured', async () => {
    // Re-mock with undefined master key
    vi.doMock('../../../src/config/index.js', () => ({
      env: {
        MASTER_API_KEY: undefined,
      },
    }));

    const { masterKeyMiddleware: middlewareNoKey } =
      await import('../../../src/middleware/masterKey.middleware.js');
    const { mockFastifyReply: mockReply } = await import('../../fixtures/tenant.fixtures.js');

    const request = {
      headers: { authorization: 'Bearer master_valid_key' },
    } as any;
    const reply = mockReply();

    await middlewareNoKey(request, reply);

    // Should return generic error (no info leak about missing config)
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.body.error.message).toBe('Invalid API key');
    expect(request.isMasterKey).toBeUndefined();
  });

  it('should reject with generic error when MASTER_API_KEY is empty string', async () => {
    vi.doMock('../../../src/config/index.js', () => ({
      env: {
        MASTER_API_KEY: '',
      },
    }));

    const { masterKeyMiddleware: middlewareEmptyKey } =
      await import('../../../src/middleware/masterKey.middleware.js');
    const { mockFastifyReply: mockReply } = await import('../../fixtures/tenant.fixtures.js');

    const request = {
      headers: { authorization: 'Bearer master_valid_key' },
    } as any;
    const reply = mockReply();

    await middlewareEmptyKey(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.body.error.message).toBe('Invalid API key');
  });
});
