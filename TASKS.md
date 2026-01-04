# Omniscient - Task Board

**Last Updated:** 2026-01-03
**Current Phase:** Phase 2 (Channels) - Finishing Up

---

## TASK-001: Fix Lint Errors
**Priority:** P0 | **Estimate:** Quick | **Status:** Open

### Description
Auto-fix 752 prettier formatting errors across the codebase.

### Instructions
```bash
pnpm lint:fix
```

### Acceptance Criteria
- [ ] `pnpm lint` passes with 0 errors
- [ ] No functional code changes (formatting only)
- [ ] Verify `pnpm typecheck` still passes after fix

### Notes
- Remaining ~50 warnings are acceptable
- If any non-auto-fixable errors remain, fix manually (likely unused imports in test files)

---

## TASK-002: Add Escalation Service Unit Tests
**Priority:** P0 | **Estimate:** Medium | **Status:** Open

### Description
Create comprehensive unit tests for `escalation.service.ts`.

### Files to Create
- `tests/unit/escalation/escalation.service.test.ts`

### Reference Implementation
Follow the pattern in `tests/unit/conversation/conversation.service.test.ts`

### Functions to Test
| Function | Test Cases |
|----------|------------|
| `detectEscalation()` | media triggers escalation, user request patterns, sensitive topics, low confidence, repeated questions, no escalation when conditions not met |
| `createEscalation()` | success case, conversation not found, escalation already exists, transaction rollback on failure |
| `autoEscalate()` | triggers escalation when conditions met, returns existing escalation if already exists, returns false when no trigger |
| `getEscalation()` | returns escalation with relations, throws when not found, respects tenant isolation |
| `listEscalations()` | pagination works, filters by reason/status/system, respects tenant isolation |
| `updateEscalation()` | updates fields, throws when not found |
| `resolveEscalation()` | sets resolvedAt, updates conversation status, handles returnedToBot flag, throws when already resolved |
| `createEscalationTicket()` | creates external ticket, updates escalation with ticket ID |

### Mocking Requirements
- Mock `prisma` client (use pattern from existing tests)
- Mock `../bot/bot.escalation.js` functions
- Mock `./ticketing/index.js` for external ticket creation

### Acceptance Criteria
- [ ] All functions have test coverage
- [ ] Tests cover happy path and error cases
- [ ] Tenant isolation verified in relevant tests
- [ ] Tests pass with `vitest run tests/unit/escalation/`

---

## TASK-003: Add Escalation Controller Unit Tests
**Priority:** P0 | **Estimate:** Medium | **Status:** Open

### Description
Create unit tests for `escalation.controller.ts` request handlers.

### Files to Create
- `tests/unit/escalation/escalation.controller.test.ts`

### Reference Implementation
Follow the pattern in `tests/unit/conversation/conversation.controller.test.ts` or `tests/unit/chat/chat.controller.test.ts`

### Endpoints to Test
| Endpoint | Test Cases |
|----------|------------|
| `POST /` (createEscalation) | 201 on success, 404 conversation not found, 409 escalation exists, validates input schema |
| `GET /` (listEscalations) | returns paginated list, applies query filters |
| `GET /:id` (getEscalation) | returns escalation, 404 when not found |
| `PATCH /:id` (updateEscalation) | updates and returns, 404 when not found |
| `POST /:id/resolve` (resolveEscalation) | resolves escalation, 404 not found, 400 already resolved |
| `POST /:id/ticket` (createTicket) | creates ticket, 404 not found, 400 unsupported system |

### Mocking Requirements
- Mock `escalation.service.js` functions
- Mock Fastify request/reply objects
- Mock `request.tenant` with test tenant ID

### Acceptance Criteria
- [ ] All controller functions tested
- [ ] HTTP status codes verified
- [ ] Error responses match expected format
- [ ] Zod schema validation tested
- [ ] Tests pass with `vitest run tests/unit/escalation/`

---

## TASK-004: Add Conversation Integration Tests
**Priority:** P1 | **Estimate:** Medium | **Status:** Open

### Description
Create integration tests for conversation API endpoints.

### Files to Create
- `tests/integration/conversation/conversation-api.test.ts`

### Reference Implementation
Follow patterns in `tests/integration/pipeline/e2e-pipeline.test.ts`

### Prerequisites
- Database running (`docker compose up -d`)
- Test tenant and API key available

### Endpoints to Test
| Method | Endpoint | Test Cases |
|--------|----------|------------|
| POST | `/v1/conversations` | creates conversation, validates userId exists |
| GET | `/v1/conversations` | lists with pagination, filters by status/channel |
| GET | `/v1/conversations/:id` | returns with messages and escalation |
| PATCH | `/v1/conversations/:id` | updates metadata, transitions status |
| POST | `/v1/conversations/:id/transition` | valid transitions work, invalid transitions rejected |
| GET | `/v1/conversations/:id/history` | returns messages in order |
| DELETE | `/v1/conversations/:id` | closes conversation |

### Test Flow
1. Create test tenant and user in beforeAll
2. Test CRUD operations
3. Test state machine transitions (BOT_ACTIVE -> ESCALATED -> RESOLVED -> CLOSED)
4. Verify tenant isolation (can't access other tenant's conversations)
5. Cleanup in afterAll

### Acceptance Criteria
- [ ] All endpoints tested
- [ ] State machine transitions verified
- [ ] Tenant isolation verified
- [ ] Auth required on all endpoints
- [ ] Tests pass with `vitest run tests/integration/conversation/`

---

## TASK-005: Add Escalation Integration Tests
**Priority:** P1 | **Estimate:** Medium | **Status:** Open

### Description
Create integration tests for escalation API endpoints.

### Files to Create
- `tests/integration/escalation/escalation-api.test.ts`

### Endpoints to Test
| Method | Endpoint | Test Cases |
|--------|----------|------------|
| POST | `/v1/escalations` | creates escalation, updates conversation status |
| GET | `/v1/escalations` | lists with filters, pagination |
| GET | `/v1/escalations/:id` | returns with conversation |
| PATCH | `/v1/escalations/:id` | updates agent info |
| POST | `/v1/escalations/:id/resolve` | resolves, updates conversation status |
| POST | `/v1/escalations/:id/ticket` | creates external ticket (mock external API) |

### Test Flow
1. Create test tenant, user, conversation in beforeAll
2. Create escalation -> verify conversation status = ESCALATED
3. Update escalation with agent info
4. Resolve escalation -> verify conversation status changes
5. Test returnedToBot = true vs false behavior
6. Cleanup in afterAll

### Acceptance Criteria
- [ ] All endpoints tested
- [ ] Conversation status sync verified
- [ ] Tenant isolation verified
- [ ] Tests pass with `vitest run tests/integration/escalation/`

---

## TASK-006: Run Quality Gates
**Priority:** P0 | **Estimate:** Quick | **Status:** Blocked by TASK-001,002,003

### Description
Run all quality checks and ensure they pass.

### Instructions
```bash
# Start database first
docker compose up -d

# Run all checks
pnpm typecheck && pnpm lint && pnpm test:run
```

### Acceptance Criteria
- [ ] `pnpm typecheck` - 0 errors
- [ ] `pnpm lint` - 0 errors (warnings OK)
- [ ] `pnpm test:run` - all tests pass

---

## TASK-007: Commit Phase 2 Work
**Priority:** P0 | **Estimate:** Quick | **Status:** Blocked by TASK-006

### Description
Commit all Phase 2 (Channels) work including conversation and escalation modules.

### Files to Stage
```
src/modules/conversation/conversation.controller.ts
src/modules/conversation/conversation.routes.ts
src/modules/conversation/conversation.schema.ts
src/modules/conversation/conversation.state-machine.ts
src/modules/conversation/conversation.service.ts (modified)
src/modules/chat/chat.service.ts (modified)
src/modules/escalation/ (entire directory)
src/server.ts (modified)
tests/unit/escalation/
tests/integration/conversation/
tests/integration/escalation/
CLAUDE.md (modified)
```

### Commit Message Template
```
feat: complete conversation management and escalation modules

- Add conversation CRUD with state machine transitions
- Add escalation detection, creation, and resolution
- Integrate Zendesk/Freshdesk ticketing
- Add unit and integration tests
```

### Acceptance Criteria
- [ ] All quality gates pass first
- [ ] Commit includes all new/modified files
- [ ] No secrets or .env files committed

---

## TASK-008: Implement URL Crawler Processor
**Priority:** P2 | **Estimate:** Large | **Status:** Open (Phase 3)

### Description
Add ability to crawl web pages and ingest content into knowledge base.

### Files to Create
- `src/modules/knowledge/processors/url.processor.ts`

### Reference
- Follow `DocumentProcessor` interface in `processors/processor.interface.ts`
- Look at existing processors (pdf, docx) for patterns

### Requirements
1. Accept URL input
2. Fetch page content (handle redirects, timeouts)
3. Extract text content (strip HTML, keep structure)
4. Handle common formats (article pages, documentation sites)
5. Respect robots.txt
6. Extract metadata (title, description, author)

### Dependencies to Add
- `cheerio` or `jsdom` for HTML parsing
- `robots-parser` for robots.txt

### Edge Cases
- Invalid URLs
- Timeout handling
- Rate limiting
- JavaScript-rendered pages (note: may need Puppeteer for SPA)
- Maximum page size limits

### Acceptance Criteria
- [ ] Implements `DocumentProcessor` interface
- [ ] Extracts clean text from HTML
- [ ] Handles errors gracefully
- [ ] Unit tests created
- [ ] Respects robots.txt

---

## TASK-009: Implement Notion Connector
**Priority:** P2 | **Estimate:** Large | **Status:** Open (Phase 3)

### Description
Add ability to sync knowledge from Notion workspaces.

### Files to Create
- `src/modules/knowledge/connectors/notion.connector.ts`
- `src/modules/knowledge/connectors/connector.interface.ts`

### Requirements
1. OAuth integration with Notion API
2. List accessible pages/databases
3. Extract page content as text
4. Handle Notion block types (paragraphs, lists, tables, etc.)
5. Track sync state for incremental updates
6. Store connection credentials securely (encrypted)

### Database Changes
May need to add `NotionConnection` model or use existing `KnowledgeSource` with type=NOTION

### API Endpoints
- `POST /v1/knowledge/connect/notion` - Start OAuth flow
- `GET /v1/knowledge/connect/notion/callback` - OAuth callback
- `POST /v1/knowledge/sources/:id/sync` - Trigger manual sync

### Acceptance Criteria
- [ ] OAuth flow works
- [ ] Pages extracted as text
- [ ] Incremental sync supported
- [ ] Integration tests with mocked Notion API

---

## TASK-010: Implement Sync Scheduling
**Priority:** P2 | **Estimate:** Medium | **Status:** Open (Phase 3)

### Description
Add cron-based scheduling for external source synchronization.

### Files to Create/Modify
- `src/jobs/workers/sync.worker.ts` (exists but may need enhancement)
- `src/jobs/scheduler.ts` (new)

### Requirements
1. Configure sync frequency per source (hourly, daily, weekly)
2. Add sync schedule to `KnowledgeSource` model
3. Create scheduler that queues sync jobs
4. Handle overlapping syncs (skip if already running)
5. Track last sync time and status

### Database Changes
Add to KnowledgeSource:
```prisma
syncSchedule    String?    // cron expression
lastSyncStatus  String?    // success, failed, in_progress
nextSyncAt      DateTime?
```

### Acceptance Criteria
- [ ] Scheduler runs on configurable interval
- [ ] Sync jobs queued per schedule
- [ ] No duplicate syncs for same source
- [ ] Sync status tracked and queryable

---

## Task Dependencies

```
TASK-001 (lint fix)
    ↓
TASK-002 (escalation service tests) ──┐
TASK-003 (escalation controller tests)├→ TASK-006 (quality gates) → TASK-007 (commit)
TASK-004 (conversation integration)   │
TASK-005 (escalation integration) ────┘

TASK-008 (URL crawler) ─────┐
TASK-009 (Notion connector) ├→ Phase 3 Complete
TASK-010 (Sync scheduling) ─┘
```

---

## Assignment Template

When assigning a task, include:
```
Task: TASK-XXX
Assignee: [agent/developer]
Due: [date if applicable]
Notes: [any additional context]
```
