# Phase 2: Channel Adapters - Implementation Tasks

## Overview

Phase 2 implements multi-channel messaging support for WhatsApp, Telegram, and Web widgets. This enables tenants to connect their bots to various messaging platforms.

## Task Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  01-adapter-interface ──────────────────────────────────────┐   │
│         │                                                   │   │
│         ▼                                                   │   │
│  02-channel-config-module                                   │   │
│         │                                                   │   │
│         ├──────────────┬──────────────┐                     │   │
│         ▼              ▼              ▼                     │   │
│  03-whatsapp    04-telegram    05-web-adapter               │   │
│         │              │              │                     │   │
│         └──────────────┴──────────────┘                     │   │
│                        │                                    │   │
│                        ▼                                    │   │
│               06-webhook-routes ◄───────────────────────────┘   │
│                        │                                        │
│                        ▼                                        │
│               07-adapter-tests                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Task Order

| Order | Task | Depends On | Priority | Complexity |
|-------|------|------------|----------|------------|
| 1 | [01-adapter-interface](./01-adapter-interface.md) | None | P0 | Low |
| 2 | [02-channel-config-module](./02-channel-config-module.md) | Task 01 | P0 | Medium |
| 3 | [03-whatsapp-adapter](./03-whatsapp-adapter.md) | Task 01 | P1 | High |
| 4 | [04-telegram-adapter](./04-telegram-adapter.md) | Task 01 | P1 | Medium |
| 5 | [05-web-adapter](./05-web-adapter.md) | Task 01 | P1 | Medium |
| 6 | [06-webhook-routes](./06-webhook-routes.md) | Tasks 02-05 | P0 | High |
| 7 | [07-adapter-tests](./07-adapter-tests.md) | Tasks 01-06 | P0 | Medium |

## Parallel Execution

Tasks 03, 04, and 05 can be implemented in parallel after Task 01 is complete.

```
Sequential:  01 → 02 → 06 → 07
Parallel:         03 ─┐
                  04 ─┼→ 06
                  05 ─┘
```

## Definition of Done

Each task is complete when:

1. ✅ All files listed in task are created
2. ✅ Code compiles without errors (`pnpm build`)
3. ✅ Linting passes (`pnpm lint`)
4. ✅ Unit tests pass (`pnpm test`)
5. ✅ Acceptance criteria in task are met
6. ✅ Security considerations are addressed
7. ✅ Edge cases are handled
8. ✅ Code reviewed and approved

## Security Review Checklist

Before completing Phase 2, verify:

- [ ] WhatsApp webhook signatures are verified using timing-safe comparison
- [ ] Telegram webhook secrets are verified using timing-safe comparison
- [ ] Web origins are validated server-side
- [ ] Credentials are encrypted at rest
- [ ] Credentials are masked in API responses
- [ ] Session IDs are cryptographically random
- [ ] Sessions are bound to tenants
- [ ] Rate limiting is implemented
- [ ] No credentials are logged
- [ ] Error messages don't leak internal details

## Environment Variables Required

Add to `.env.example`:

```bash
# WhatsApp
WHATSAPP_APP_SECRET=your_facebook_app_secret

# Encryption (for credential storage)
ENCRYPTION_KEY=32_byte_hex_string_for_aes_256

# Session (Redis recommended for production)
SESSION_STORE=memory  # or 'redis'
SESSION_TTL_MINUTES=30
```

## Database Migrations

No new migrations required - `ChannelConfig` model already exists in Prisma schema.

## Testing Strategy

1. **Unit Tests** (Task 07)
   - Test all adapters in isolation
   - Mock external APIs
   - Focus on security paths

2. **Integration Tests** (Future)
   - Test webhook → adapter → chat flow
   - Use test containers for Redis

3. **Manual Testing**
   - WhatsApp: Use Meta test phone number
   - Telegram: Create test bot via @BotFather
   - Web: Use included test page (`src/public/index.html`)

## Rollback Plan

If issues arise after deployment:

1. Disable affected channel via `ChannelConfig.enabled = false`
2. Webhook endpoints return 503 for disabled channels
3. Existing conversations continue via other channels
4. No data loss - messages queued for retry

## Success Metrics

Phase 2 is successful when:

- [ ] At least one tenant has configured WhatsApp
- [ ] At least one tenant has configured Telegram
- [ ] Web widget works on tenant's website
- [ ] 99.9% webhook uptime
- [ ] < 500ms average response time
- [ ] 0 security incidents

## Notes

- Start with Web adapter for easier testing (no external dependencies)
- WhatsApp requires Meta Business verification (can take days)
- Telegram is easiest to test (create bot instantly)
- Keep adapters stateless for easy scaling
