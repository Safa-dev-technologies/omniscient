# Task 05: Web Adapter

## Overview
Implement the Web adapter for browser-based chat widgets. Unlike WhatsApp/Telegram, we control both ends, so this is simpler but has different requirements around sessions, CORS, and real-time updates.

## Files to Create

```
src/adapters/web/
├── web.adapter.ts          # Main adapter implementation
├── web.types.ts            # Web-specific types
├── web.session.ts          # Session management
└── index.ts                # Re-exports
```

## Requirements

### 1. web.types.ts

```typescript
// Incoming message from web widget
interface WebIncomingMessage {
  sessionId: string;            // Client-generated or server-provided
  content: string;
  contentType?: 'text' | 'file';
  timestamp?: string;           // ISO 8601
  metadata?: {
    page?: string;              // Current page URL
    referrer?: string;
    userAgent?: string;
    language?: string;
    timezone?: string;
  };
}

// Outgoing message to web widget
interface WebOutgoingMessage {
  messageId: string;
  content: string;
  timestamp: string;
  sources?: Array<{
    name: string;
    section?: string;
  }>;
  suggestedReplies?: string[];
  isTyping?: boolean;
  isEscalated?: boolean;
}

// Session data stored in Redis/memory
interface WebSession {
  sessionId: string;
  tenantId: string;
  conversationId?: string;
  userId?: string;
  createdAt: Date;
  lastActivityAt: Date;
  metadata: Record<string, unknown>;
}

// Widget configuration (sent to client)
interface WebWidgetConfig {
  tenantSlug: string;
  botName: string;
  welcomeMessage?: string;
  primaryColor?: string;
  position?: 'left' | 'right';
  placeholder?: string;
  offline?: {
    enabled: boolean;
    message: string;
    collectEmail?: boolean;
  };
}

// Real-time event types (for SSE/WebSocket)
interface WebEvent {
  type: 'message' | 'typing' | 'status' | 'error';
  payload: unknown;
  timestamp: string;
}
```

### 2. web.session.ts

Session management utilities:

```typescript
interface SessionManager {
  // Create or retrieve session
  getOrCreateSession(
    tenantId: string,
    sessionId?: string,
    metadata?: Record<string, unknown>
  ): Promise<WebSession>;

  // Get existing session
  getSession(sessionId: string): Promise<WebSession | null>;

  // Update session activity
  touchSession(sessionId: string): Promise<void>;

  // Link session to conversation
  linkConversation(sessionId: string, conversationId: string): Promise<void>;

  // Clean up expired sessions
  cleanExpiredSessions(maxAgeMinutes: number): Promise<number>;

  // Validate session belongs to tenant
  validateSession(sessionId: string, tenantId: string): Promise<boolean>;
}
```

Implementation notes:
- Use Redis for session storage in production
- Use in-memory Map for development/testing
- Session TTL should be configurable (default 30 minutes of inactivity)
- Generate session IDs using `crypto.randomUUID()`

### 3. web.adapter.ts

```typescript
class WebAdapter implements ChannelAdapter {
  readonly channel = Channel.WEB;

  private allowedOrigins: string[];
  private rateLimit: number;
  private sessionTimeout: number;
  private sessionManager: SessionManager;

  async initialize(config: AdapterConfig): Promise<void>;

  async parseIncoming(
    payload: unknown,
    headers?: Record<string, string>
  ): Promise<NormalizedMessage | null>;

  async sendMessage(params: SendMessageParams): Promise<SendResult>;

  // Web-specific: Validate origin
  validateOrigin(origin: string): boolean;

  // Web-specific: Get or create session
  async getSession(sessionId?: string, tenantId: string): Promise<WebSession>;

  // Web-specific: Get widget config for client
  getWidgetConfig(tenant: Tenant): WebWidgetConfig;
}
```

## Security Considerations

### CORS Configuration

1. **Strict origin validation**
   - Only allow origins explicitly configured for the tenant
   - No wildcard (*) in production
   - Validate on every request

```typescript
function validateOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (!origin) return false;

  // Normalize origins (remove trailing slashes)
  const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
  const normalizedAllowed = allowedOrigins.map(o => o.replace(/\/$/, '').toLowerCase());

  return normalizedAllowed.includes(normalizedOrigin);
}
```

2. **CORS headers**
   - Set `Access-Control-Allow-Origin` to specific origin (not *)
   - Set `Access-Control-Allow-Credentials: true` if using cookies
   - Limit allowed methods and headers

### Session Security

1. **Session ID requirements**
   - Use cryptographically random IDs (UUID v4)
   - Never accept user-provided session IDs without validation
   - Bind sessions to tenant

```typescript
function generateSessionId(): string {
  return crypto.randomUUID();
}

function validateSessionId(sessionId: string): boolean {
  // Must be valid UUID v4
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(sessionId);
}
```

2. **Session fixation prevention**
   - Always generate new session ID on server
   - Client can suggest, but server validates/regenerates

3. **Session hijacking prevention**
   - Bind session to origin
   - Consider binding to user-agent (but handle mobile gracefully)
   - Short session timeouts

### Rate Limiting

1. **Per-session limits**
   - Max messages per minute (e.g., 20)
   - Max message length (e.g., 4096 chars)

2. **Per-tenant limits**
   - Max concurrent sessions
   - Max total requests per minute

3. **Implementation**
   - Use Redis for distributed rate limiting
   - Return 429 Too Many Requests with Retry-After header

### Input Validation

1. **Sanitize content**
   - Strip HTML if not needed
   - Check for script injection attempts
   - Log suspicious patterns

2. **Validate metadata**
   - URL fields should be valid URLs
   - Timezone should be valid IANA zone
   - User-agent can be very long - truncate

## Edge Cases to Handle

### parseIncoming()

1. **Missing sessionId**
   - Generate new session
   - Return in response headers or body

2. **Expired session**
   - Create new session
   - Optionally restore conversation context

3. **Invalid sessionId format**
   - Reject with 400 Bad Request
   - Don't create new session (potential abuse)

4. **Empty content**
   - Reject with 400 Bad Request
   - Different from whitespace-only (which should trim and reject)

5. **Content too long**
   - Reject with 400 and include max length in error

6. **File uploads**
   - For now, return unsupported
   - Future: handle file content separately

### sendMessage()

1. **Session not found**
   - Return error, don't create session
   - Client should restart conversation

2. **Typing indicators**
   - These are pseudo-messages for real-time updates
   - Don't store in database

3. **Suggested replies**
   - Optional feature for quick responses
   - Limit to 3-5 suggestions

### Real-time Updates

If implementing SSE or WebSocket:

1. **Connection management**
   - Track active connections per session
   - Handle reconnection gracefully
   - Heartbeat to detect dead connections

2. **Message ordering**
   - Include sequence numbers
   - Client should handle out-of-order messages

3. **Backpressure**
   - Don't queue unlimited messages
   - Drop oldest if buffer full

## API Endpoints

The web adapter will be used by these endpoints:

### POST /v1/webhooks/web/:tenantSlug
Main message endpoint

Request:
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "content": "Hello, I have a question",
  "metadata": {
    "page": "https://example.com/help",
    "language": "en"
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "messageId": "msg_abc123",
    "response": "Hi! How can I help you today?",
    "sources": [],
    "suggestedReplies": ["Check order status", "Return policy", "Contact support"]
  }
}
```

### GET /v1/webhooks/web/:tenantSlug/config
Get widget configuration

Response:
```json
{
  "success": true,
  "data": {
    "tenantSlug": "acme-corp",
    "botName": "Acme Support",
    "welcomeMessage": "Hi! How can I help you today?",
    "primaryColor": "#0066cc",
    "position": "right"
  }
}
```

### GET /v1/webhooks/web/:tenantSlug/events (SSE - Optional)
Real-time event stream

```
event: message
data: {"type":"message","payload":{"content":"Hello!"},"timestamp":"..."}

event: typing
data: {"type":"typing","payload":{"isTyping":true},"timestamp":"..."}
```

## Acceptance Criteria

- [ ] Implements `ChannelAdapter` interface
- [ ] Session management works (create, get, validate)
- [ ] Origin validation is enforced
- [ ] Session IDs are cryptographically random
- [ ] Sessions are bound to tenants
- [ ] Rate limiting is implemented
- [ ] Input validation handles all edge cases
- [ ] Widget config endpoint works
- [ ] Messages can be sent and received
- [ ] Expired sessions are handled gracefully

## Testing Requirements

Create `tests/unit/adapters/web.adapter.test.ts`:

- [ ] Test origin validation (valid, invalid, missing)
- [ ] Test session creation
- [ ] Test session validation (valid, invalid format, wrong tenant)
- [ ] Test parseIncoming with valid message
- [ ] Test parseIncoming with missing sessionId
- [ ] Test parseIncoming with empty content
- [ ] Test sendMessage success
- [ ] Test rate limiting
- [ ] Test widget config generation

Create `tests/unit/adapters/web.session.test.ts`:

- [ ] Test getOrCreateSession
- [ ] Test session expiration
- [ ] Test linkConversation
- [ ] Test cleanExpiredSessions

## Notes for Implementer

1. **Sessions are simpler than you think** - Don't over-engineer
2. **Redis is optional** - Start with in-memory, abstract for easy swap
3. **CORS is critical** - Get it right or widget won't work
4. **No signature verification needed** - We control both ends
5. **Consider SSE for real-time** - Simpler than WebSocket for one-way updates
6. **Widget config comes from Tenant** - Not from ChannelConfig
7. **Session = anonymous user** - Link to User model when they provide email
