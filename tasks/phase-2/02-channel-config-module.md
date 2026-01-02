# Task 02: Channel Config Module

## Overview
Create the channel configuration management module that allows tenants to configure their messaging channels (WhatsApp, Telegram, Web). This includes CRUD operations for channel configs with proper credential encryption.

## Files to Create

```
src/modules/channel/
├── channel.routes.ts
├── channel.controller.ts
├── channel.service.ts
├── channel.schema.ts
└── channel.types.ts
```

## Requirements

### 1. channel.schema.ts (Zod Validation)

```typescript
// Create channel config
const createChannelConfigSchema = z.object({
  channel: z.enum(['WHATSAPP', 'TELEGRAM', 'WEB', 'SLACK', 'EMAIL', 'SMS']),
  enabled: z.boolean().default(true),
  credentials: z.record(z.unknown()),  // Validated per-channel in service
  webhookUrl: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
});

// Update channel config
const updateChannelConfigSchema = z.object({
  enabled: z.boolean().optional(),
  credentials: z.record(z.unknown()).optional(),
  webhookUrl: z.string().url().optional().nullable(),
  settings: z.record(z.unknown()).optional(),
});

// Channel-specific credential schemas (for validation in service)
const whatsappCredentialsSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  webhookVerifyToken: z.string().min(8),
  businessAccountId: z.string().optional(),
});

const telegramCredentialsSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/, 'Invalid Telegram bot token format'),
  webhookSecret: z.string().min(16).optional(),
});

const webCredentialsSchema = z.object({
  allowedOrigins: z.array(z.string().url()).min(1),
  rateLimit: z.number().int().min(1).max(1000).optional(),
  sessionTimeout: z.number().int().min(1).max(1440).optional(),
});
```

### 2. channel.service.ts

Methods to implement:

```typescript
interface ChannelService {
  // Create a new channel configuration
  createConfig(tenantId: string, data: CreateChannelConfigInput): Promise<ChannelConfig>;

  // Get all channel configs for a tenant
  listConfigs(tenantId: string): Promise<ChannelConfig[]>;

  // Get specific channel config
  getConfig(tenantId: string, channel: Channel): Promise<ChannelConfig | null>;

  // Update channel config
  updateConfig(tenantId: string, channel: Channel, data: UpdateChannelConfigInput): Promise<ChannelConfig>;

  // Delete/disconnect channel
  deleteConfig(tenantId: string, channel: Channel): Promise<void>;

  // Test channel connection (ping the external service)
  testConnection(tenantId: string, channel: Channel): Promise<{ success: boolean; message: string }>;

  // Generate webhook URL for a channel
  generateWebhookUrl(tenantId: string, channel: Channel): string;

  // Rotate webhook secret
  rotateWebhookSecret(tenantId: string, channel: Channel): Promise<string>;
}
```

### 3. channel.controller.ts

Endpoints:
- `POST /v1/channels` - Create channel config
- `GET /v1/channels` - List all channel configs
- `GET /v1/channels/:channel` - Get specific channel config
- `PATCH /v1/channels/:channel` - Update channel config
- `DELETE /v1/channels/:channel` - Delete channel config
- `POST /v1/channels/:channel/test` - Test connection
- `POST /v1/channels/:channel/rotate-secret` - Rotate webhook secret

### 4. channel.routes.ts

Register all routes with proper authentication middleware.

## Security Considerations

### CRITICAL: Credential Encryption

1. **Never store credentials in plaintext**
   - Encrypt `credentials` JSON before saving to database
   - Use AES-256-GCM with a per-tenant or global encryption key
   - Store encryption key in environment variable, NOT in code

2. **Credential masking in responses**
   - Never return full access tokens in API responses
   - Mask credentials: show only last 4 characters
   - Example: `accessToken: "****...xYz9"`

3. **Webhook secret generation**
   - Use `crypto.randomBytes(32).toString('hex')` for webhook secrets
   - Never use predictable values

### Input Validation

1. **Validate credentials per channel type**
   - WhatsApp: Validate phoneNumberId format, token not empty
   - Telegram: Validate bot token format (`123456:ABC-DEF...`)
   - Web: Validate origins are valid URLs, no wildcards in production

2. **Sanitize webhook URLs**
   - Must be HTTPS in production
   - No localhost/private IPs in production
   - Validate URL is reachable (optional)

### Access Control

1. Only tenant owners can manage channel configs
2. Log all credential operations (create, update, delete, rotate)
3. Rate limit credential rotation (max 5 per hour)

## Edge Cases to Handle

1. **Duplicate channel config**
   - Tenant can only have ONE config per channel type
   - Return 409 Conflict if already exists

2. **Invalid credentials**
   - Validate credential format before saving
   - `testConnection` should catch auth errors gracefully

3. **Webhook URL conflicts**
   - Different tenants might want same webhook pattern
   - Include tenant ID or slug in webhook URL path

4. **Channel not supported**
   - Return 400 for channels not yet implemented (SLACK, EMAIL, SMS)

5. **Partial updates**
   - PATCH should merge credentials, not replace entirely
   - Be careful not to lose required fields

6. **Deletion with active conversations**
   - Warn if there are active conversations on the channel
   - Consider soft-delete or require force flag

## API Response Format

### Success Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "channel": "WHATSAPP",
    "enabled": true,
    "webhookUrl": "https://api.omniscient.ai/v1/webhooks/whatsapp/tenant-slug",
    "credentials": {
      "phoneNumberId": "1234567890",
      "accessToken": "****...xYz9",
      "webhookVerifyToken": "****...abc1"
    },
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "CHANNEL_ALREADY_CONFIGURED",
    "message": "WhatsApp channel is already configured for this tenant"
  }
}
```

## Acceptance Criteria

- [ ] All CRUD operations work correctly
- [ ] Credentials are encrypted before storage
- [ ] Credentials are masked in API responses
- [ ] Proper validation for each channel type
- [ ] Webhook secrets are cryptographically random
- [ ] Duplicate channel configs are rejected
- [ ] All operations are logged with tenant context
- [ ] Unit tests cover happy path and error cases

## Testing Requirements

Create `tests/unit/channel/channel.service.test.ts`:
- [ ] Test credential validation for each channel type
- [ ] Test credential masking
- [ ] Test duplicate channel rejection
- [ ] Test CRUD operations with mocked Prisma
- [ ] Test webhook URL generation

Create `tests/unit/channel/channel.controller.test.ts`:
- [ ] Test all endpoints return correct status codes
- [ ] Test validation errors return 400
- [ ] Test not found returns 404
- [ ] Test conflict returns 409

## Dependencies

- Existing: `@/middleware/masterKey.middleware` for auth
- New: Create encryption utility in `@/utils/crypto.ts`

## Notes for Implementer

1. Follow existing patterns in `src/modules/tenant/` for structure
2. Use existing tenant context from `req.tenant`
3. Credential encryption is NON-NEGOTIABLE - do not skip
4. Keep credential validation schemas separate for reuse in adapters
5. The webhook URL format should be: `/v1/webhooks/{channel}/{tenantSlug}`
