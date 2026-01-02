# Phase 3: Knowledge Expansion - Implementation Tasks

## Overview

Phase 3 expands the knowledge ingestion capabilities beyond simple file uploads. This enables tenants to import knowledge from various document types and external sources like Zendesk and Notion.

## Current Implementation Status

| Feature | Status | Coverage |
|---------|--------|----------|
| PDF Processing | Complete | 100% |
| DOCX Processing | Complete | 100% |
| TXT Processing | Complete | 100% |
| CSV Processing | Stub | 10% |
| URL Crawler | Not Started | 0% |
| Zendesk Connector | Not Started | 0% |
| Notion Connector | Not Started | 0% |
| Sync Scheduling | Not Started | 0% |

## Task Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  01-csv-faq-processor ─────────────────────────────────────┐    │
│         │                                                  │    │
│         ▼                                                  │    │
│  02-url-crawler                                            │    │
│         │                                                  │    │
│         ├──────────────────────────────┐                   │    │
│         ▼                              ▼                   │    │
│  03-zendesk-connector        04-notion-connector           │    │
│         │                              │                   │    │
│         └──────────────┬───────────────┘                   │    │
│                        ▼                                   │    │
│               05-sync-scheduling ◄─────────────────────────┘    │
│                        │                                        │
│                        ▼                                        │
│               06-phase3-tests                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Task Order

| Order | Task | Depends On | Priority | Complexity |
|-------|------|------------|----------|------------|
| 1 | [01-csv-faq-processor](./01-csv-faq-processor.md) | None | P0 | Low |
| 2 | [02-url-crawler](./02-url-crawler.md) | None | P1 | Medium |
| 3 | [03-zendesk-connector](./03-zendesk-connector.md) | Task 02 | P2 | Medium |
| 4 | [04-notion-connector](./04-notion-connector.md) | Task 02 | P2 | Medium |
| 5 | [05-sync-scheduling](./05-sync-scheduling.md) | Tasks 03-04 | P1 | Medium |
| 6 | [06-phase3-tests](./06-phase3-tests.md) | Tasks 01-05 | P0 | Medium |

## Parallel Execution

Tasks 01 and 02 can be implemented in parallel.
Tasks 03 and 04 can be implemented in parallel after Task 02 is complete.

```
Sequential:  01 ───────────────────────────┐
             02 → 03 ─┐                    │
                  04 ─┼→ 05 → 06 ◄─────────┘
```

## Definition of Done

Each task is complete when:

1. All files listed in task are created
2. Code compiles without errors (`pnpm build`)
3. Linting passes (`pnpm lint`)
4. Unit tests pass (`pnpm test`)
5. Acceptance criteria in task are met
6. Security considerations are addressed
7. Edge cases are handled

## New Dependencies Required

| Package | Purpose | Task |
|---------|---------|------|
| `csv-parser` or `papaparse` | CSV parsing | Task 01 |
| `cheerio` | HTML parsing | Task 02 |
| `robots-parser` | Robots.txt handling | Task 02 |
| `zendesk-node-api` or custom | Zendesk API | Task 03 |
| `@notionhq/client` | Notion API | Task 04 |

## Database Schema

The schema already supports Phase 3 - no migrations needed:

```prisma
enum KnowledgeSourceType {
  PDF        // ✅ Implemented
  DOCX       // ✅ Implemented
  TXT        // ✅ Implemented
  CSV        // 🔄 Needs enhancement
  URL        // ❌ Not implemented
  ZENDESK    // ❌ Not implemented
  FRESHDESK  // ❌ Future
  NOTION     // ❌ Not implemented
  CONFLUENCE // ❌ Future
}

model KnowledgeSource {
  // ... existing fields
  sourceUrl      String?    // For URL/connector sources
  lastSyncedAt   DateTime?  // For sync tracking
  version        Int        // For change detection
  checksum       String?    // For change detection
}
```

## Environment Variables Required

Add to `.env.example`:

```bash
# Zendesk (Task 03)
ZENDESK_SUBDOMAIN=your-subdomain
ZENDESK_EMAIL=admin@company.com
ZENDESK_API_TOKEN=your_api_token

# Notion (Task 04)
NOTION_API_KEY=secret_xxx

# Sync Scheduling (Task 05)
SYNC_DEFAULT_INTERVAL_HOURS=24
SYNC_MIN_INTERVAL_HOURS=1
```

## Testing Strategy

1. **Unit Tests** (Task 06)
   - Test all processors in isolation
   - Mock external APIs (Zendesk, Notion)
   - Test chunking strategies
   - Test sync scheduling logic

2. **Integration Tests** (Future)
   - Test full pipeline: fetch → process → embed → index
   - Test sync with real external sources (sandbox accounts)

3. **Manual Testing**
   - CSV: Upload various CSV formats (with/without headers)
   - URL: Crawl test websites
   - Zendesk: Use Zendesk sandbox
   - Notion: Use test workspace

## Security Considerations

- [ ] Store connector credentials encrypted (use existing crypto utils)
- [ ] Validate URLs before crawling (no internal IPs, localhost)
- [ ] Rate limit external API calls
- [ ] Handle API token refresh for OAuth connectors
- [ ] Sanitize HTML content from crawled pages
- [ ] Respect robots.txt for URL crawling

## Success Metrics

Phase 3 is successful when:

- [ ] CSV files with Q&A format are properly chunked
- [ ] URLs can be crawled and content extracted
- [ ] Zendesk articles sync automatically
- [ ] Notion pages sync automatically
- [ ] Syncs run on configurable schedules
- [ ] Changes are detected and incrementally updated
