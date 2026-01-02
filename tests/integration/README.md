# Integration Tests

This directory contains integration tests for the Omniscient knowledge processing pipeline.

## Prerequisites

Before running the tests, you need:

1. **Docker & Docker Compose** - For PostgreSQL and Redis services
2. **Environment Variables** - API keys for external services

## Quick Start

### 1. Start Required Services

Start PostgreSQL and Redis using Docker Compose:

```bash
# From the project root
docker-compose up -d postgres redis
```

This will start:
- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`

### 2. Set Up Environment Variables

Create a `.env` file in the project root (or ensure your existing `.env` has these variables):

```bash
# Required
DATABASE_URL=postgresql://omniscient:omniscient@localhost:5432/omniscient
REDIS_URL=redis://localhost:6379
PINECONE_API_KEY=your_pinecone_api_key
OPENAI_API_KEY=your_openai_api_key
GROQ_API_KEY=your_groq_api_key

# Optional (for testing)
NODE_ENV=test
PINECONE_INDEX=omniscient-knowledge
STORAGE_PROVIDER=local
STORAGE_LOCAL_PATH=./uploads

# Optional (for credential encryption tests)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

**Note:** The `ENCRYPTION_KEY` must be exactly 64 hexadecimal characters (32 bytes). If not set, a default key will be used in non-production environments (with a warning).

### 3. Run Database Migrations

Ensure your database schema is up to date:

```bash
pnpm db:push
# or
pnpm db:migrate
```

### 4. Run the Tests

```bash
# Run all integration tests
pnpm test

# Run only integration tests (filter by path)
pnpm test tests/integration

# Run a specific test file
pnpm test tests/integration/pipeline/e2e-pipeline.test.ts

# Run tests in watch mode
pnpm test --watch

# Run tests once (CI mode)
pnpm test:run tests/integration
```

## Test Structure

```
tests/integration/
├── README.md                    # This file
├── global-setup.ts             # Vitest global setup/teardown
├── setup.ts                    # Test utilities and configuration
├── helpers.ts                  # Helper functions for tests
├── mocks/
│   └── external-services.ts    # External service mocks
├── pipeline/
│   ├── e2e-pipeline.test.ts    # End-to-end pipeline tests
│   ├── error-handling.test.ts  # Error handling & retry tests
│   ├── rate-limiting.test.ts   # Rate limiting tests
│   ├── data-integrity.test.ts  # Data integrity tests
│   └── concurrent-operations.test.ts  # Concurrent operations tests
└── health/
    └── health-endpoints.test.ts # Health check tests
```

## What Gets Tested

- ✅ **E2E Pipeline**: Full document processing flow (PDF, DOCX, CSV, TXT)
- ✅ **Error Handling**: Invalid files, retries, dead letter queue
- ✅ **Rate Limiting**: Per-tenant limits, isolation, fail-open behavior
- ✅ **Data Integrity**: Chunk consistency, referential integrity, cleanup
- ✅ **Health Monitoring**: Queue health, worker status
- ✅ **Concurrent Operations**: Parallel uploads, multi-tenant isolation

## Test Environment

The tests use a dedicated test tenant (`test-tenant-integration`) and Pinecone namespace (`tenant_test-tenant-integration`). All test data is automatically cleaned up after tests complete.

## Troubleshooting

### Tests are failing with connection errors

1. **Database connection**: Ensure PostgreSQL is running and accessible:
   ```bash
   docker-compose ps postgres
   psql postgresql://omniscient:omniscient@localhost:5432/omniscient -c "SELECT 1;"
   ```

2. **Redis connection**: Ensure Redis is running:
   ```bash
   docker-compose ps redis
   redis-cli -u redis://localhost:6379 ping
   ```

3. **Pinecone**: Verify your API key is correct and you have access to the index:
   ```bash
   # Check env variable
   echo $PINECONE_API_KEY
   ```

### Tests timeout

Integration tests have longer timeouts (up to 2 minutes) because they:
- Process real documents
- Generate embeddings
- Interact with external services

If tests consistently timeout, check:
- Network connectivity to Pinecone and OpenAI APIs
- API rate limits
- Resource constraints (CPU, memory)

### Tests leave data behind

The global teardown should clean up all test data. If you notice leftover data:

1. Manual cleanup:
   ```sql
   -- Delete test tenant (in PostgreSQL)
   DELETE FROM "KnowledgeChunk" WHERE "sourceId" IN (
     SELECT id FROM "KnowledgeSource" WHERE "tenantId" = 'test-tenant-integration'
   );
   DELETE FROM "KnowledgeSource" WHERE "tenantId" = 'test-tenant-integration';
   DELETE FROM "Tenant" WHERE id = 'test-tenant-integration';
   ```

2. Redis cleanup:
   ```bash
   redis-cli -u redis://localhost:6379 FLUSHDB
   ```

3. Pinecone namespace cleanup:
   - Use the Pinecone console or API to delete the `tenant_test-tenant-integration` namespace

### "ENCRYPTION_KEY must be 64 hex characters" error

Generate a valid encryption key:

```bash
# Generate a 64-character hex key (32 bytes)
openssl rand -hex 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add it to your `.env` file:
```
ENCRYPTION_KEY=<generated_key>
```

## Running Tests in CI/CD

For CI/CD environments, you'll need:

1. Start services (PostgreSQL, Redis) - use Docker Compose or managed services
2. Set all required environment variables as secrets
3. Run migrations: `pnpm db:push`
4. Run tests: `pnpm test:run tests/integration`

Example GitHub Actions workflow snippet:

```yaml
- name: Start services
  run: docker-compose up -d postgres redis

- name: Wait for services
  run: |
    until docker-compose exec -T postgres pg_isready -U omniscient; do sleep 1; done
    until docker-compose exec -T redis redis-cli ping; do sleep 1; done

- name: Run migrations
  run: pnpm db:push
  env:
    DATABASE_URL: postgresql://omniscient:omniscient@localhost:5432/omniscient

- name: Run integration tests
  run: pnpm test:run tests/integration
  env:
    DATABASE_URL: postgresql://omniscient:omniscient@localhost:5432/omniscient
    REDIS_URL: redis://localhost:6379
    PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```
