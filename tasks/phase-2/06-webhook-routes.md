# Task 06: Webhook Routes

## Overview
Create the webhook route handlers that receive incoming messages from all channels and route them through the appropriate adapters to the chat service. This is the entry point for all external channel communications.

## Files to Create

```
src/webhooks/
├── webhook.routes.ts       # Route registration
├── webhook.controller.ts   # Request handlers
├── webhook.service.ts      # Orchestration logic
├── webhook.middleware.ts   # Channel-specific middleware
└── index.ts                # Re-exports
```

## Requirements

### 1. Route Structure

```
POST   /v1/webhooks/whatsapp              WhatsApp incoming messages
GET    /v1/webhooks/whatsapp              WhatsApp webhook verification

POST   /v1/webhooks/telegram/:tenantSlug  Telegram incoming messages

POST   /v1/webhooks/web/:tenantSlug       Web widget messages
GET    /v1/webhooks/web/:tenantSlug/config Widget configuration
GET    /v1/webhooks/web/:tenantSlug/events SSE event stream (optional)
```

### 2. webhook.middleware.ts

```typescript
/**
 * Resolve tenant from webhook request
 * Different channels have different tenant resolution strategies:
 * - WhatsApp: Phone number ID in payload → lookup ChannelConfig
 * - Telegram: Tenant slug in URL path
 * - Web: Tenant slug in URL path
 */
async function resolveTenantFromWebhook(
  channel: Channel,
  request: FastifyRequest
): Promise<Tenant | null>;

/**
 * Verify webhook signature/secret
 * Must be done BEFORE parsing body for WhatsApp
 */
async function verifyWebhookSignature(
  channel: Channel,
  request: FastifyRequest
): Promise<boolean>;

/**
 * Rate limit webhook requests
 * Per-channel, per-tenant limits
 */
async function webhookRateLimit(
  channel: Channel,
  tenantId: string
): Promise<{ allowed: boolean; retryAfter?: number }>;
```

### 3. webhook.controller.ts

```typescript
/**
 * Handle WhatsApp webhook verification (GET)
 * Meta sends this to verify webhook URL during setup
 */
async function handleWhatsAppVerification(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void>;

/**
 * Handle WhatsApp incoming message (POST)
 */
async function handleWhatsAppWebhook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void>;

/**
 * Handle Telegram incoming message
 */
async function handleTelegramWebhook(
  request: FastifyRequest<{ Params: { tenantSlug: string } }>,
  reply: FastifyReply
): Promise<void>;

/**
 * Handle Web widget message
 */
async function handleWebMessage(
  request: FastifyRequest<{ Params: { tenantSlug: string } }>,
  reply: FastifyReply
): Promise<void>;

/**
 * Get Web widget configuration
 */
async function getWebWidgetConfig(
  request: FastifyRequest<{ Params: { tenantSlug: string } }>,
  reply: FastifyReply
): Promise<void>;
```

### 4. webhook.service.ts

Main orchestration logic:

```typescript
interface WebhookService {
  /**
   * Process incoming webhook from any channel
   * 1. Parse message using appropriate adapter
   * 2. Find or create conversation
   * 3. Send to chat service for bot response
   * 4. Send response back via adapter
   */
  processIncomingMessage(
    channel: Channel,
    tenantId: string,
    payload: unknown,
    headers: Record<string, string>
  ): Promise<WebhookResult>;

  /**
   * Get or create adapter instance for tenant/channel
   * Adapters should be cached per tenant
   */
  getAdapter(
    tenantId: string,
    channel: Channel
  ): Promise<ChannelAdapter>;

  /**
   * Handle message processing errors
   * Log, notify, and return appropriate response
   */
  handleError(
    error: Error,
    channel: Channel,
    tenantId: string
  ): WebhookResult;
}

interface WebhookResult {
  success: boolean;
  messageId?: string;
  error?: string;
  // For WhatsApp: must respond quickly, process async
  async?: boolean;
}
```

### 5. webhook.routes.ts

```typescript
async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  // WhatsApp - no tenant in URL, resolved from payload
  fastify.get('/whatsapp', handleWhatsAppVerification);
  fastify.post('/whatsapp', {
    config: {
      rawBody: true,  // Need raw body for signature verification
    },
    preHandler: [verifyWhatsAppSignature],
  }, handleWhatsAppWebhook);

  // Telegram - tenant in URL
  fastify.post('/telegram/:tenantSlug', {
    preHandler: [verifyTelegramSecret],
  }, handleTelegramWebhook);

  // Web - tenant in URL, CORS enabled
  fastify.post('/web/:tenantSlug', {
    preHandler: [validateCors, validateWebSession],
  }, handleWebMessage);

  fastify.get('/web/:tenantSlug/config', {
    preHandler: [validateCors],
  }, getWebWidgetConfig);
}
```

## Security Considerations

### Request Validation Order

**CRITICAL**: For WhatsApp, signature MUST be verified BEFORE parsing JSON body.

```typescript
// Fastify config for raw body access
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    // Store raw body for signature verification
    req.rawBody = body;
    try {
      const json = JSON.parse(body.toString());
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// Then in preHandler
async function verifyWhatsAppSignature(request: FastifyRequest): Promise<void> {
  const signature = request.headers['x-hub-signature-256'] as string;
  const rawBody = request.rawBody as Buffer;

  const isValid = whatsAppAdapter.verifySignature(rawBody.toString(), signature);
  if (!isValid) {
    throw new Error('Invalid webhook signature');
  }
}
```

### Tenant Resolution Security

1. **WhatsApp**: Phone number ID must match a ChannelConfig
   - Attacker can't spoof other tenants
   - Return 200 OK even for unknown phone IDs (don't reveal existence)

2. **Telegram**: Webhook secret must match
   - Each tenant has unique webhook URL with unique secret
   - Attacker would need to guess URL + secret

3. **Web**: Origin must be in allowed list
   - CORS blocks unauthorized origins
   - Still validate server-side (CORS is client-enforced)

### Response Timing

1. **WhatsApp requires fast response**
   - Must respond within 20 seconds
   - Process message async, respond immediately with 200
   - Use job queue for actual processing if needed

2. **Telegram is more lenient**
   - But still process async for consistency

3. **Web is synchronous**
   - Client expects response with bot message
   - But can use streaming/SSE for long responses

### Error Handling

1. **Never expose internal errors**
   - Log full error internally
   - Return generic error to webhook sender

2. **Always return 200 for WhatsApp**
   - Meta will retry failed webhooks
   - Even for errors, return 200 to prevent retries
   - Only return non-200 for signature failures

3. **Idempotency**
   - Webhooks may be sent multiple times
   - Deduplicate by message ID
   - Use message contentHash for dedup

## Edge Cases to Handle

### Tenant Resolution

1. **Unknown phone number ID (WhatsApp)**
   - Log warning, return 200
   - Don't process message

2. **Invalid tenant slug**
   - Return 404 Not Found
   - Log attempt (possible enumeration attack)

3. **Channel not configured for tenant**
   - Return 404 or 503
   - Log for debugging

4. **Channel disabled**
   - `ChannelConfig.enabled = false`
   - Return 503 Service Unavailable

### Message Processing

1. **Duplicate messages**
   - WhatsApp may send same message multiple times
   - Check message ID in recent cache (Redis)
   - Skip if already processed

2. **Old messages**
   - Timestamp older than 5 minutes
   - Log but still process (could be retry)

3. **System messages**
   - Delivery receipts, read receipts
   - Adapter returns null, don't process further

4. **User not found**
   - Create new user from external ID
   - Link to conversation

5. **Conversation not found**
   - Create new conversation
   - Use existing if within session window

### Error Scenarios

1. **LLM service down**
   - Return fallback message
   - Queue for retry

2. **Database down**
   - Return error to user
   - Don't lose message (queue it)

3. **External channel API down**
   - Log error
   - Message received but response failed
   - Consider retry queue

## Flow Diagram

```
                     ┌─────────────────────┐
                     │   Webhook Request   │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Verify Signature   │
                     │  (WhatsApp/Telegram)│
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Resolve Tenant     │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Get/Init Adapter   │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Parse Message      │
                     │  (Adapter)          │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  null? (system msg) │──Yes──► Return 200
                     └──────────┬──────────┘
                                │No
                     ┌──────────▼──────────┐
                     │  Deduplicate        │──Dup──► Return 200
                     └──────────┬──────────┘
                                │New
                     ┌──────────▼──────────┐
                     │  Find/Create User   │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Find/Create Conv   │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  ChatService.handle │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Adapter.sendMessage│
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  Return 200 OK      │
                     └─────────────────────┘
```

## Acceptance Criteria

- [ ] WhatsApp webhook verification (GET) works
- [ ] WhatsApp message processing works
- [ ] WhatsApp signature verification is enforced
- [ ] Telegram webhook processing works
- [ ] Telegram secret verification is enforced
- [ ] Web widget messages work
- [ ] Web widget config endpoint works
- [ ] CORS is properly configured for web
- [ ] Tenant resolution works for all channels
- [ ] Unknown tenants return appropriate error
- [ ] Disabled channels return 503
- [ ] Duplicate messages are detected and skipped
- [ ] Errors don't expose internal details
- [ ] All requests are logged with tenant context

## Testing Requirements

Create `tests/unit/webhooks/webhook.service.test.ts`:

- [ ] Test processIncomingMessage happy path
- [ ] Test adapter caching
- [ ] Test error handling

Create `tests/unit/webhooks/webhook.controller.test.ts`:

- [ ] Test WhatsApp verification endpoint
- [ ] Test WhatsApp webhook with valid signature
- [ ] Test WhatsApp webhook with invalid signature (401)
- [ ] Test Telegram webhook happy path
- [ ] Test Telegram webhook with invalid secret (401)
- [ ] Test Web message endpoint
- [ ] Test Web config endpoint
- [ ] Test unknown tenant (404)
- [ ] Test disabled channel (503)

Create `tests/unit/webhooks/webhook.middleware.test.ts`:

- [ ] Test tenant resolution for each channel
- [ ] Test signature verification
- [ ] Test rate limiting

## Notes for Implementer

1. **Raw body access is tricky in Fastify** - Need custom content type parser
2. **Adapter instances should be cached** - Don't create per-request
3. **Use existing chat.service** - Webhooks just feed into existing flow
4. **WhatsApp phone number ID vs phone number** - They're different!
5. **Log everything** - Webhooks are hard to debug without logs
6. **Respond fast, process async** - Especially for WhatsApp
7. **Don't trust any input** - Even from "verified" webhooks
