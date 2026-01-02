# Task 03: WhatsApp Adapter

## Overview
Implement the WhatsApp Business Cloud API adapter for receiving and sending messages. This is one of the most complex adapters due to Meta's API requirements and security model.

## Files to Create

```
src/adapters/whatsapp/
├── whatsapp.adapter.ts     # Main adapter implementation
├── whatsapp.types.ts       # WhatsApp-specific types
├── whatsapp.utils.ts       # Signature verification, helpers
└── index.ts                # Re-exports
```

## WhatsApp Cloud API Reference

- Base URL: `https://graph.facebook.com/v18.0`
- Send Message: `POST /{phoneNumberId}/messages`
- Webhook: Receives POST requests with message payloads

## Requirements

### 1. whatsapp.types.ts

Define types matching WhatsApp Cloud API payloads:

```typescript
// Incoming webhook payload structure
interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: WhatsAppEntry[];
}

interface WhatsAppEntry {
  id: string;                    // Business Account ID
  changes: WhatsAppChange[];
}

interface WhatsAppChange {
  value: {
    messaging_product: 'whatsapp';
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: WhatsAppContact[];
    messages?: WhatsAppMessage[];
    statuses?: WhatsAppStatus[];   // Delivery receipts
    errors?: WhatsAppError[];
  };
  field: 'messages';
}

interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;                 // WhatsApp ID (phone number)
}

interface WhatsAppMessage {
  from: string;                  // Sender's phone number
  id: string;                    // Message ID
  timestamp: string;             // Unix timestamp
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'contacts' | 'interactive' | 'button' | 'reaction';
  text?: { body: string };
  image?: WhatsAppMedia;
  audio?: WhatsAppMedia;
  video?: WhatsAppMedia;
  document?: WhatsAppMedia & { filename: string };
  location?: { latitude: number; longitude: number; name?: string };
  interactive?: WhatsAppInteractive;
  button?: { text: string; payload: string };
  reaction?: { message_id: string; emoji: string };
  context?: { from: string; id: string };  // Reply context
}

interface WhatsAppMedia {
  id: string;                    // Media ID (need to fetch URL separately)
  mime_type: string;
  sha256: string;
}

interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: WhatsAppError[];
}

interface WhatsAppError {
  code: number;
  title: string;
  message: string;
  error_data?: { details: string };
}

// Outgoing message structures
interface WhatsAppSendTextRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: { body: string; preview_url?: boolean };
}

interface WhatsAppSendInteractiveRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button' | 'list';
    body: { text: string };
    action: {
      buttons?: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
      // For list type
      button?: string;
      sections?: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
    };
  };
}
```

### 2. whatsapp.utils.ts

```typescript
/**
 * Verify WhatsApp webhook signature
 * CRITICAL: All incoming webhooks MUST be verified
 *
 * @param payload - Raw request body as string
 * @param signature - X-Hub-Signature-256 header value
 * @param appSecret - Facebook App Secret
 * @returns boolean - true if signature is valid
 */
function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean;

/**
 * Get media URL from media ID
 * Media IDs must be exchanged for URLs before downloading
 */
async function getMediaUrl(
  mediaId: string,
  accessToken: string
): Promise<string>;

/**
 * Format phone number for WhatsApp
 * Removes +, spaces, dashes. Ensures country code.
 */
function formatPhoneNumber(phone: string): string;
```

### 3. whatsapp.adapter.ts

Implement the `ChannelAdapter` interface:

```typescript
class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = Channel.WHATSAPP;

  private phoneNumberId: string;
  private accessToken: string;
  private webhookVerifyToken: string;
  private appSecret: string;  // For signature verification

  async initialize(config: AdapterConfig): Promise<void>;

  async parseIncoming(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<NormalizedMessage | null>;

  async sendMessage(params: SendMessageParams): Promise<SendResult>;

  verifyWebhook(params: WebhookVerifyParams): WebhookVerifyResult;

  verifySignature(payload: string, signature: string): boolean;

  async isHealthy(): Promise<boolean>;
}
```

## Security Considerations

### CRITICAL: Signature Verification

1. **Every webhook request MUST be verified**
   - WhatsApp signs payloads with X-Hub-Signature-256 header
   - Use HMAC-SHA256 with your App Secret
   - Reject requests with invalid/missing signatures

```typescript
// Signature format: "sha256=HEXDIGEST"
function verifyWebhookSignature(payload: string, signature: string, appSecret: string): boolean {
  if (!signature?.startsWith('sha256=')) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');

  const actualSignature = signature.slice(7); // Remove "sha256=" prefix

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(actualSignature)
  );
}
```

2. **Access token handling**
   - Never log access tokens
   - Tokens should come from encrypted storage
   - Consider token rotation strategy

3. **Webhook verify token**
   - Used during webhook registration with Meta
   - Should be cryptographically random
   - Store securely, compare in constant time

### Rate Limiting

WhatsApp has strict rate limits:
- 80 messages/second per phone number
- 1000 messages/day for unverified businesses
- Implement backoff on 429 responses

### Phone Number Validation

- Validate phone number format before sending
- Store numbers in E.164 format (e.g., +1234567890)
- Handle edge cases: country codes, leading zeros

## Edge Cases to Handle

### parseIncoming()

1. **Status updates (not messages)**
   - Return `null` for delivery receipts, read receipts
   - Log them for debugging but don't process as messages

2. **Unsupported message types**
   - Reactions, contacts, stickers, etc.
   - Return `null` or extract what text you can

3. **Media messages**
   - Set `hasMedia: true`, `contentType` appropriately
   - Media ID needs separate API call to get URL
   - Don't fetch media URL in parseIncoming (do it lazily)

4. **Interactive responses**
   - Button clicks come as type: 'interactive' or 'button'
   - Extract the button ID/payload for bot logic

5. **Quoted messages (replies)**
   - `context` field contains original message info
   - Consider including this in metadata

6. **Malformed payloads**
   - Wrap parsing in try-catch
   - Log errors, return `null`

### sendMessage()

1. **Message length limits**
   - Text: 4096 characters max
   - Truncate or split long messages

2. **Button limits**
   - Max 3 buttons per message
   - Button text max 20 characters

3. **24-hour window**
   - Can only send non-template messages within 24h of user's last message
   - After 24h, must use approved templates
   - Handle 400 errors for window violations

4. **Phone number not on WhatsApp**
   - API returns error for invalid recipients
   - Handle gracefully, mark user as unreachable

5. **Media sending**
   - Must upload media first to get ID, or use URL
   - Handle upload failures

### verifyWebhook()

1. **Initial setup verification**
   - Meta sends GET request with hub.mode, hub.verify_token, hub.challenge
   - Must respond with hub.challenge value if token matches
   - Return exact challenge, no extra characters

## API Integration

### Sending Messages

```typescript
// Text message
POST https://graph.facebook.com/v18.0/{phoneNumberId}/messages
Authorization: Bearer {accessToken}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "1234567890",
  "type": "text",
  "text": { "body": "Hello!" }
}

// Response
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "1234567890", "wa_id": "1234567890" }],
  "messages": [{ "id": "wamid.xxx" }]
}
```

### Error Response Handling

```json
{
  "error": {
    "message": "Invalid OAuth access token",
    "type": "OAuthException",
    "code": 190,
    "fbtrace_id": "xxx"
  }
}
```

Map to appropriate error codes:
- 190: Invalid token → refresh/re-auth needed
- 131030: Rate limited → implement backoff
- 131051: Invalid phone → mark unreachable

## Acceptance Criteria

- [ ] Implements `ChannelAdapter` interface completely
- [ ] Signature verification is implemented and enforced
- [ ] Webhook verification (GET challenge-response) works
- [ ] Text messages can be sent successfully
- [ ] Interactive messages (buttons) work
- [ ] Incoming text messages are parsed correctly
- [ ] Media messages set hasMedia=true with correct type
- [ ] Status updates return null (not processed as messages)
- [ ] Rate limit errors are handled with backoff
- [ ] Phone numbers are validated/formatted
- [ ] All errors are caught and returned in SendResult

## Testing Requirements

Create `tests/unit/adapters/whatsapp.adapter.test.ts`:

- [ ] Test signature verification (valid, invalid, missing)
- [ ] Test webhook verification (valid token, invalid token)
- [ ] Test parseIncoming with text message
- [ ] Test parseIncoming with image message
- [ ] Test parseIncoming with status update (should return null)
- [ ] Test parseIncoming with malformed payload
- [ ] Test sendMessage success
- [ ] Test sendMessage with API error
- [ ] Test phone number formatting

## Environment Variables Required

```bash
# Add to .env.example
WHATSAPP_APP_SECRET=xxx  # For signature verification (Meta App Secret)
```

## Notes for Implementer

1. **Use existing HTTP client pattern** - Check if project uses axios, fetch, or custom client
2. **Timing-safe comparison is NON-NEGOTIABLE** for signature verification
3. **Do NOT fetch media URLs eagerly** - It's a separate API call, do it only when needed
4. **Log webhook payloads in debug mode** for troubleshooting (but mask tokens)
5. **WhatsApp uses phone numbers as user IDs** - No separate user ID concept
6. **Consider creating a retry utility** for transient failures
