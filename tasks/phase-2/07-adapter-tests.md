# Task 07: Adapter Unit Tests

## Overview
Write comprehensive unit tests for all adapters, channel config, and webhook routes. Tests must cover security-critical paths, edge cases, and error handling.

## Test Files to Create

```
tests/unit/adapters/
├── whatsapp.adapter.test.ts
├── whatsapp.utils.test.ts
├── telegram.adapter.test.ts
├── telegram.utils.test.ts
├── web.adapter.test.ts
└── web.session.test.ts

tests/unit/channel/
├── channel.service.test.ts
└── channel.controller.test.ts

tests/unit/webhooks/
├── webhook.service.test.ts
├── webhook.controller.test.ts
└── webhook.middleware.test.ts

tests/fixtures/
├── whatsapp.fixtures.ts
├── telegram.fixtures.ts
└── web.fixtures.ts
```

## Test Requirements

### CRITICAL: Security Tests

These tests are NON-NEGOTIABLE and must pass before any PR is merged:

#### Signature Verification Tests

```typescript
// whatsapp.utils.test.ts
describe('verifyWebhookSignature', () => {
  it('should return true for valid signature', () => {
    const payload = '{"test": "data"}';
    const secret = 'test_secret';
    const validSignature = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    expect(verifyWebhookSignature(payload, validSignature, secret)).toBe(true);
  });

  it('should return false for invalid signature', () => {
    expect(verifyWebhookSignature('payload', 'sha256=invalid', 'secret')).toBe(false);
  });

  it('should return false for missing sha256 prefix', () => {
    expect(verifyWebhookSignature('payload', 'noshaprefix', 'secret')).toBe(false);
  });

  it('should return false for empty signature', () => {
    expect(verifyWebhookSignature('payload', '', 'secret')).toBe(false);
  });

  it('should return false for null signature', () => {
    expect(verifyWebhookSignature('payload', null as any, 'secret')).toBe(false);
  });

  it('should be timing-safe (no early return on mismatch)', () => {
    // This is hard to test directly, but verify implementation uses timingSafeEqual
  });
});

// telegram.utils.test.ts
describe('verifyWebhookSecret', () => {
  it('should return true for matching secret', () => {
    expect(verifyWebhookSecret('my_secret_token', 'my_secret_token')).toBe(true);
  });

  it('should return false for mismatched secret', () => {
    expect(verifyWebhookSecret('wrong_token', 'correct_token')).toBe(false);
  });

  it('should return false for undefined header', () => {
    expect(verifyWebhookSecret(undefined, 'secret')).toBe(false);
  });

  it('should return false for empty expected secret', () => {
    expect(verifyWebhookSecret('token', '')).toBe(false);
  });
});

// web.adapter.test.ts
describe('validateOrigin', () => {
  it('should return true for allowed origin', () => {
    const allowed = ['https://example.com', 'https://app.example.com'];
    expect(validateOrigin('https://example.com', allowed)).toBe(true);
  });

  it('should return false for disallowed origin', () => {
    const allowed = ['https://example.com'];
    expect(validateOrigin('https://evil.com', allowed)).toBe(false);
  });

  it('should handle trailing slashes', () => {
    const allowed = ['https://example.com/'];
    expect(validateOrigin('https://example.com', allowed)).toBe(true);
  });

  it('should be case-insensitive', () => {
    const allowed = ['https://Example.com'];
    expect(validateOrigin('https://example.com', allowed)).toBe(true);
  });

  it('should return false for null origin', () => {
    expect(validateOrigin(null as any, ['https://example.com'])).toBe(false);
  });

  it('should return false for empty allowed list', () => {
    expect(validateOrigin('https://example.com', [])).toBe(false);
  });
});
```

#### Session Security Tests

```typescript
// web.session.test.ts
describe('SessionManager', () => {
  describe('getOrCreateSession', () => {
    it('should generate cryptographically random session ID', async () => {
      const session1 = await sessionManager.getOrCreateSession('tenant1');
      const session2 = await sessionManager.getOrCreateSession('tenant1');

      expect(session1.sessionId).not.toBe(session2.sessionId);
      expect(session1.sessionId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it('should bind session to tenant', async () => {
      const session = await sessionManager.getOrCreateSession('tenant1');

      const isValid = await sessionManager.validateSession(session.sessionId, 'tenant1');
      const isInvalid = await sessionManager.validateSession(session.sessionId, 'tenant2');

      expect(isValid).toBe(true);
      expect(isInvalid).toBe(false);
    });
  });

  describe('validateSession', () => {
    it('should return false for invalid session ID format', async () => {
      expect(await sessionManager.validateSession('not-a-uuid', 'tenant1')).toBe(false);
    });

    it('should return false for non-existent session', async () => {
      expect(await sessionManager.validateSession(
        '550e8400-e29b-41d4-a716-446655440000',
        'tenant1'
      )).toBe(false);
    });
  });
});
```

### Fixture Files

Create realistic test fixtures:

```typescript
// whatsapp.fixtures.ts
export const mockWhatsAppTextMessage = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'BUSINESS_ACCOUNT_ID',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '15551234567',
          phone_number_id: 'PHONE_NUMBER_ID',
        },
        contacts: [{
          profile: { name: 'John Doe' },
          wa_id: '15559876543',
        }],
        messages: [{
          from: '15559876543',
          id: 'wamid.xxx',
          timestamp: '1699900000',
          type: 'text',
          text: { body: 'Hello, I need help' },
        }],
      },
      field: 'messages',
    }],
  }],
};

export const mockWhatsAppStatusUpdate = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'BUSINESS_ACCOUNT_ID',
    changes: [{
      value: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '15551234567',
          phone_number_id: 'PHONE_NUMBER_ID',
        },
        statuses: [{
          id: 'wamid.xxx',
          status: 'delivered',
          timestamp: '1699900001',
          recipient_id: '15559876543',
        }],
      },
      field: 'messages',
    }],
  }],
};

export const mockWhatsAppImageMessage = {
  // ... with image instead of text
};

// telegram.fixtures.ts
export const mockTelegramTextMessage = {
  update_id: 123456789,
  message: {
    message_id: 100,
    from: {
      id: 987654321,
      is_bot: false,
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
      language_code: 'en',
    },
    chat: {
      id: 987654321,
      type: 'private',
      first_name: 'John',
      last_name: 'Doe',
      username: 'johndoe',
    },
    date: 1699900000,
    text: 'Hello, I need help',
  },
};

export const mockTelegramCallbackQuery = {
  update_id: 123456790,
  callback_query: {
    id: 'callback123',
    from: { id: 987654321, is_bot: false, first_name: 'John' },
    message: { /* original message */ },
    chat_instance: 'chat123',
    data: 'button_clicked',
  },
};

// web.fixtures.ts
export const mockWebMessage = {
  sessionId: '550e8400-e29b-41d4-a716-446655440000',
  content: 'Hello, I need help',
  metadata: {
    page: 'https://example.com/help',
    userAgent: 'Mozilla/5.0...',
    language: 'en-US',
  },
};
```

### Adapter Tests

```typescript
// whatsapp.adapter.test.ts
describe('WhatsAppAdapter', () => {
  let adapter: WhatsAppAdapter;

  beforeEach(() => {
    adapter = new WhatsAppAdapter();
    adapter.initialize({
      tenantId: 'test-tenant',
      channel: Channel.WHATSAPP,
      credentials: {
        phoneNumberId: 'PHONE_ID',
        accessToken: 'ACCESS_TOKEN',
        webhookVerifyToken: 'VERIFY_TOKEN',
      },
    });
  });

  describe('parseIncoming', () => {
    it('should parse text message correctly', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppTextMessage);

      expect(result).not.toBeNull();
      expect(result!.content).toBe('Hello, I need help');
      expect(result!.externalUserId).toBe('15559876543');
      expect(result!.channel).toBe(Channel.WHATSAPP);
      expect(result!.contentType).toBe('text');
    });

    it('should return null for status updates', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppStatusUpdate);

      expect(result).toBeNull();
    });

    it('should parse image message with hasMedia=true', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppImageMessage);

      expect(result).not.toBeNull();
      expect(result!.hasMedia).toBe(true);
      expect(result!.contentType).toBe('image');
    });

    it('should handle malformed payload gracefully', async () => {
      const result = await adapter.parseIncoming({ invalid: 'data' });

      expect(result).toBeNull();
    });

    it('should include sender name in metadata', async () => {
      const result = await adapter.parseIncoming(mockWhatsAppTextMessage);

      expect(result!.senderName).toBe('John Doe');
    });
  });

  describe('verifyWebhook', () => {
    it('should return challenge for valid verify token', () => {
      const result = adapter.verifyWebhook({
        mode: 'subscribe',
        token: 'VERIFY_TOKEN',
        challenge: 'challenge_string',
      });

      expect(result.valid).toBe(true);
      expect(result.challenge).toBe('challenge_string');
    });

    it('should reject invalid verify token', () => {
      const result = adapter.verifyWebhook({
        mode: 'subscribe',
        token: 'WRONG_TOKEN',
        challenge: 'challenge_string',
      });

      expect(result.valid).toBe(false);
    });

    it('should reject non-subscribe mode', () => {
      const result = adapter.verifyWebhook({
        mode: 'unsubscribe',
        token: 'VERIFY_TOKEN',
        challenge: 'challenge_string',
      });

      expect(result.valid).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('should send text message successfully', async () => {
      // Mock fetch
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.xxx' }],
        }),
      } as Response);

      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: 'Hello!',
      });

      expect(result.success).toBe(true);
      expect(result.externalMessageId).toBe('wamid.xxx');
    });

    it('should handle API error', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({
          error: { message: 'Invalid token', code: 190 },
        }),
      } as Response);

      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: 'Hello!',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid token');
    });

    it('should reject empty content', async () => {
      const result = await adapter.sendMessage({
        externalUserId: '15559876543',
        content: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should truncate content exceeding 4096 characters', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messaging_product: 'whatsapp',
          messages: [{ id: 'wamid.xxx' }],
        }),
      } as Response);

      const longContent = 'x'.repeat(5000);
      await adapter.sendMessage({
        externalUserId: '15559876543',
        content: longContent,
      });

      const fetchCall = vi.mocked(fetch).mock.calls[0];
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.text.body.length).toBeLessThanOrEqual(4096);
    });
  });
});
```

### Channel Config Tests

```typescript
// channel.service.test.ts
describe('ChannelService', () => {
  describe('createConfig', () => {
    it('should encrypt credentials before saving', async () => {
      const result = await channelService.createConfig('tenant1', {
        channel: Channel.WHATSAPP,
        credentials: {
          phoneNumberId: '123',
          accessToken: 'secret_token',
          webhookVerifyToken: 'verify_token',
        },
      });

      // Verify the saved credentials are not plaintext
      const saved = await prisma.channelConfig.findUnique({
        where: { id: result.id },
      });

      expect(saved!.credentials).not.toContain('secret_token');
    });

    it('should reject duplicate channel config', async () => {
      await channelService.createConfig('tenant1', {
        channel: Channel.WHATSAPP,
        credentials: { /* ... */ },
      });

      await expect(
        channelService.createConfig('tenant1', {
          channel: Channel.WHATSAPP,
          credentials: { /* ... */ },
        })
      ).rejects.toThrow(/already configured/);
    });

    it('should validate WhatsApp credentials schema', async () => {
      await expect(
        channelService.createConfig('tenant1', {
          channel: Channel.WHATSAPP,
          credentials: {
            // Missing required fields
            phoneNumberId: '123',
          },
        })
      ).rejects.toThrow(/accessToken/);
    });

    it('should validate Telegram bot token format', async () => {
      await expect(
        channelService.createConfig('tenant1', {
          channel: Channel.TELEGRAM,
          credentials: {
            botToken: 'invalid_format',
          },
        })
      ).rejects.toThrow(/Invalid.*bot token/);
    });
  });

  describe('getConfig', () => {
    it('should mask credentials in response', async () => {
      await channelService.createConfig('tenant1', {
        channel: Channel.WHATSAPP,
        credentials: {
          phoneNumberId: '123',
          accessToken: 'EAABcd123456789XYZ',
          webhookVerifyToken: 'verify_secret_token',
        },
      });

      const config = await channelService.getConfig('tenant1', Channel.WHATSAPP);

      expect(config!.credentials.accessToken).toMatch(/^\*+\.\.\.[A-Za-z0-9]{4}$/);
      expect(config!.credentials.accessToken).not.toContain('EAABcd');
    });
  });
});
```

### Webhook Tests

```typescript
// webhook.controller.test.ts
describe('Webhook Controller', () => {
  describe('handleWhatsAppVerification', () => {
    it('should return challenge for valid request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'valid_token',
          'hub.challenge': 'test_challenge',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('test_challenge');
    });

    it('should return 403 for invalid token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/webhooks/whatsapp',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': 'invalid_token',
          'hub.challenge': 'test_challenge',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('handleWhatsAppWebhook', () => {
    it('should return 401 for missing signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/whatsapp',
        payload: mockWhatsAppTextMessage,
        // No X-Hub-Signature-256 header
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 for invalid signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/whatsapp',
        payload: mockWhatsAppTextMessage,
        headers: {
          'X-Hub-Signature-256': 'sha256=invalid',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should process valid webhook and return 200', async () => {
      const payload = JSON.stringify(mockWhatsAppTextMessage);
      const signature = 'sha256=' + crypto
        .createHmac('sha256', 'app_secret')
        .update(payload)
        .digest('hex');

      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/whatsapp',
        payload: mockWhatsAppTextMessage,
        headers: {
          'X-Hub-Signature-256': signature,
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('handleTelegramWebhook', () => {
    it('should return 404 for unknown tenant', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/telegram/unknown-tenant',
        payload: mockTelegramTextMessage,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 401 for invalid secret', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/telegram/valid-tenant',
        payload: mockTelegramTextMessage,
        headers: {
          'X-Telegram-Bot-Api-Secret-Token': 'wrong_secret',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('handleWebMessage', () => {
    it('should return 403 for disallowed origin', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/web/valid-tenant',
        payload: mockWebMessage,
        headers: {
          'Origin': 'https://evil.com',
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should create session if not provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/web/valid-tenant',
        payload: { content: 'Hello' }, // No sessionId
        headers: {
          'Origin': 'https://allowed-origin.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
```

## Acceptance Criteria

- [ ] All security-critical tests pass
- [ ] Test coverage >= 80% for adapter code
- [ ] All edge cases from adapter tasks are tested
- [ ] Fixtures are realistic and reusable
- [ ] No `any` types in test code
- [ ] Tests are fast (< 10 seconds total)
- [ ] Tests don't require external services
- [ ] Tests are deterministic (no flaky tests)

## Notes for Implementer

1. **Mock external APIs** - Never call real WhatsApp/Telegram APIs in tests
2. **Use vi.spyOn for fetch** - Or create a mock HTTP client
3. **Test error paths first** - Security tests are highest priority
4. **Keep fixtures DRY** - Create factory functions for variations
5. **Test timing-safe comparisons** - Document that implementation uses them
6. **Snapshot tests are discouraged** - Explicit assertions are better
7. **Run tests in CI** - Ensure `pnpm test` works in clean environment
