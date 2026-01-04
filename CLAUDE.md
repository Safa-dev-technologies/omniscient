# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Omniscient is a multi-tenant AI chatbot platform that enables companies to upload knowledge documents, connect to messaging channels (WhatsApp, Telegram, Web), and provide AI-powered customer support using RAG (Retrieval Augmented Generation).

## Commands

```bash
# Development
pnpm dev              # Run API server with hot reload
pnpm workers          # Run background workers (document/embedding processing)

# Database
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Run migrations (dev)
pnpm db:push          # Push schema to database
pnpm db:seed          # Seed database

# Testing
pnpm test             # Run tests in watch mode
pnpm test:run         # Run tests once
vitest run tests/unit/knowledge/processors.test.ts  # Run single test file

# Quality
pnpm lint             # Run ESLint
pnpm lint:fix         # Fix lint issues
pnpm typecheck        # TypeScript check without emit
pnpm format           # Prettier formatting
```

## Architecture

### Entry Points
- `src/index.ts` - API server entry point (Fastify)
- `src/workers.ts` - Background job workers entry point
- `src/server.ts` - Fastify server configuration and route registration

### Module Structure
Each feature module in `src/modules/` follows the pattern:
- `*.routes.ts` - Route definitions with middleware hooks
- `*.controller.ts` - Request handlers
- `*.service.ts` - Business logic
- `*.schema.ts` - Zod validation schemas

### Key Modules
- `tenant/` - Multi-tenant management with API key auth
- `knowledge/` - Document upload, processing, and vector search
- `chat/` - Conversation orchestration and bot responses
- `bot/` - Core AI response generation with LLM
- `channel/` - Channel configuration management

### Channel Adapters (`src/adapters/`)
Implement `ChannelAdapter` interface for messaging platforms (WhatsApp, Telegram, Web).

### Background Jobs (`src/jobs/`)
BullMQ-based job processing:
- `documentQueue` - Document extraction and chunking
- `embeddingQueue` - Vector generation and Pinecone indexing
- Workers in `workers/` directory

### Knowledge Pipeline
Upload -> Extract (PDF/DOCX/TXT) -> Chunk -> Embed (OpenAI) -> Index (Pinecone)

Processors in `src/modules/knowledge/processors/` implement `DocumentProcessor` interface.

## Infrastructure Dependencies
- PostgreSQL - Primary database (Prisma ORM)
- Redis - Job queues (BullMQ) and caching
- Pinecone - Vector storage with tenant namespace isolation (`tenant_{tenantId}`)
- Groq/OpenAI - LLM providers
- AWS S3 (optional) - File storage

## Multi-Tenancy
- All API requests require `Authorization: Bearer omni_*` header
- Tenant resolved via API key hash lookup
- All database queries MUST include `tenantId` filter
- Pinecone uses namespace per tenant for data isolation

## Path Aliases
TypeScript uses `@/*` alias for `src/*` (configured in tsconfig.json and vitest.config.ts).

## Environment Variables
Required variables defined in `src/config/env.ts` with Zod validation:
- `DATABASE_URL`, `REDIS_URL` - Infrastructure
- `PINECONE_API_KEY`, `PINECONE_INDEX` - Vector DB
- `GROQ_API_KEY`, `OPENAI_API_KEY` - LLM providers
- `STORAGE_PROVIDER` - `local` or `s3`

## Docker Development
```bash
docker compose up -d     # Start PostgreSQL and Redis
docker compose down      # Stop services
```

## Lead Engineer Role

You are acting as a lead software engineer managing a team of capable but inexperienced agents. Your role is to **delegate, guide, and review**—not write code unless told to do so directly but make sure the code is wriiten as you would have written it yourself. Do not be afraid to correct and instruct.

### Task Delegation
- Break down features into specific, actionable tasks with clear acceptance criteria
- Reference the TECHNICAL_SPECIFICATION.md for requirements and design decisions
- Specify which files to create/modify and which patterns to follow
- Point agents to existing implementations as examples (e.g., "follow the pattern in `tenant.service.ts`")
- Define interfaces and function signatures upfront when the task involves integration points

### Code Review Checklist
When reviewing implementations, verify:
- **Tenant isolation**: Every database query includes `tenantId` filter
- **Error handling**: Proper error types, no swallowed errors, meaningful messages
- **Input validation**: Zod schemas for all external inputs
- **Edge cases**: Empty arrays, null values, missing optional fields, concurrent access
- **Resource cleanup**: Database connections, file handles, Redis subscriptions
- **Job idempotency**: Background jobs can safely retry without side effects
- **API rate limits**: External API calls (OpenAI, Groq, Pinecone) have retry logic with backoff
- **Type safety**: No `any` types without justification, proper null checks

### Quality Gates
Before approving any implementation:
1. Run `pnpm typecheck` - must pass with no errors
2. Run `pnpm lint` - must pass with no errors
3. Run `pnpm test:run` - all tests must pass
4. Review for performance bottlenecks (N+1 queries, unbounded loops, memory leaks)
5. Check for security issues (SQL injection via raw queries, unvalidated redirects, exposed secrets)

### Iteration Mindset
- Review the full context of changed files, not just the diff
- Look for inconsistencies with existing patterns in the codebase
- Identify missing error paths and unhappy flows
- Question assumptions—ask "what happens if X fails/is empty/is null?"
- Push back on over-engineering; prefer simple solutions that solve the current problem

---

## Progress Report

**Last Updated:** 2026-01-03

### Phase 1: Foundation (MVP) - COMPLETE ✅

| Task | Status | Notes |
|------|--------|-------|
| Project setup (Fastify + TypeScript + Prisma) | ✅ Done | |
| Database schema + migrations | ✅ Done | Prisma schema complete |
| Tenant management (CRUD) | ✅ Done | `src/modules/tenant/` |
| API key authentication | ✅ Done | `tenant.auth.ts` |
| PDF upload + extraction | ✅ Done | `processors/pdf.processor.ts` |
| Chunking + embedding pipeline | ✅ Done | `chunkers/`, `embedding.worker.ts` |
| Pinecone integration | ✅ Done | `src/lib/pinecone.ts` |
| Bot engine (basic) | ✅ Done | `bot.engine.ts`, `bot.prompts.ts`, `bot.escalation.ts` |
| Simple chat endpoint | ✅ Done | `src/modules/chat/` |
| Web adapter (REST) | ✅ Done | `src/adapters/web/` |

### Phase 2: Channels - IN PROGRESS 🔄

| Task | Status | Notes |
|------|--------|-------|
| Channel config management | ✅ Done | `src/modules/channel/` |
| WhatsApp adapter | ✅ Done | `src/adapters/whatsapp/` |
| Telegram adapter | ✅ Done | `src/adapters/telegram/` |
| Webhook handlers | ✅ Done | `src/webhooks/` |
| Conversation persistence | 🔄 Active | `src/modules/conversation/` - implementing controller, routes, state-machine |
| Message history | 🔄 Active | Part of conversation module |
| Escalation module | 🔄 Active | `src/modules/escalation/` - new module being built |

**Current Work (Git Status):**
- Modified: `chat.service.ts`, `conversation.service.ts`, `server.ts`
- New files: `conversation.controller.ts`, `conversation.routes.ts`, `conversation.schema.ts`, `conversation.state-machine.ts`
- New module: `src/modules/escalation/` (routes, controller, service, schema, ticketing integrations)

### Phase 3: Knowledge Expansion - PARTIAL ⬜

| Task | Status | Notes |
|------|--------|-------|
| DOCX processor | ✅ Done | `processors/docx.processor.ts` |
| CSV/FAQ processor | ✅ Done | `processors/csv.processor.ts` |
| TXT processor | ✅ Done | `processors/txt.processor.ts` |
| URL crawler | ⬜ Not started | |
| Zendesk connector | 🔄 Partial | `escalation/ticketing/zendesk.ts` (ticketing, not knowledge) |
| Notion connector | ⬜ Not started | |
| Sync scheduling | ⬜ Not started | |

### Phase 4: Admin Dashboard - NOT STARTED ⬜

### Phase 5: Enterprise Features - NOT STARTED ⬜

### Test Coverage

| Area | Status |
|------|--------|
| Unit: Tenant | ✅ |
| Unit: Bot | ✅ |
| Unit: Chat | ✅ |
| Unit: Channel | ✅ |
| Unit: Knowledge | ✅ |
| Unit: Adapters (Web, WhatsApp, Telegram) | ✅ |
| Unit: Webhooks | ✅ |
| Unit: Conversation | ✅ |
| Integration: Pipeline | ✅ |
| Integration: Health | ✅ |

### Next Steps

**See [TASKS.md](./TASKS.md) for detailed task specifications with acceptance criteria.**

#### Summary
| Task | Priority | Status | Blocked By |
|------|----------|--------|------------|
| TASK-001: Fix lint errors | P0 | Open | - |
| TASK-002: Escalation service tests | P0 | Open | - |
| TASK-003: Escalation controller tests | P0 | Open | - |
| TASK-004: Conversation integration tests | P1 | Open | - |
| TASK-005: Escalation integration tests | P1 | Open | - |
| TASK-006: Run quality gates | P0 | Open | 001-003 |
| TASK-007: Commit Phase 2 | P0 | Open | 006 |
| TASK-008: URL crawler (Phase 3) | P2 | Open | 007 |
| TASK-009: Notion connector (Phase 3) | P2 | Open | 007 |
| TASK-010: Sync scheduling (Phase 3) | P2 | Open | 007 |

### Known Issues

| Issue | Status | Notes |
|-------|--------|-------|
| Lint: 850 errors (752 auto-fixable) | 🔴 Open | Mostly prettier formatting |
| Integration tests require running DB | ⚠️ Expected | Run `docker compose up -d` first |
| Missing escalation unit tests | 🔴 Open | Need service + controller tests |
