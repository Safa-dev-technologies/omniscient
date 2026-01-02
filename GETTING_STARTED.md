# Getting Started Guide

This guide will help you get the Omniscient API running and obtain an API key for the test UI.

## Prerequisites

- Node.js 20+
- pnpm (install with `npm install -g pnpm`)
- PostgreSQL and Redis (or use Docker - see [DOCKER.md](./DOCKER.md))

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:
- `PINECONE_API_KEY` - Get from [Pinecone Console](https://app.pinecone.io/)
- `GROQ_API_KEY` - Get from [Groq Console](https://console.groq.com/)
- `OPENAI_API_KEY` - Get from [OpenAI Platform](https://platform.openai.com/)

### 3. Start Database Services

**Option A: Using Docker (Recommended)**

```bash
docker compose -f docker-compose.dev.yml up -d
```

**Option B: Using Local Services**

Make sure PostgreSQL and Redis are running on your system.

### 4. Set Up Database

```bash
# Generate Prisma client
pnpm db:generate

# Push schema to database
pnpm db:push

# Seed database (creates test tenant and API key)
pnpm db:seed
```

### 5. Get Your API Key

After running `pnpm db:seed`, you'll see output like this:

```
========================================
API KEY (save this - shown only once):
========================================
omni_test_abc123def456ghi789jkl012mno345pqr678stu901vwx234yzab567cde890fgh123
========================================
```

**⚠️ IMPORTANT: Copy this API key immediately - it's only shown once!**

If you missed it or need to create a new key, you can:

**Option A: Delete and re-seed**
```bash
# Delete existing API keys from database, then:
pnpm db:seed
```

**Option B: Create via API (requires master key)**
```bash
# Set MASTER_API_KEY in .env, then:
curl -X POST http://localhost:3000/v1/tenants \
  -H "Authorization: Bearer master_your_master_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Company",
    "slug": "my-company",
    "botName": "MyBot"
  }'
```

The response will include the API key in the `apiKey.key` field.

### 6. Start the Server

```bash
# Development mode (with hot reload)
pnpm dev

# Or production mode
pnpm build
pnpm start
```

The API will be available at `http://localhost:3000`

### 7. Use the Test UI

1. Open `http://localhost:3000` in your browser
2. Paste your API key in the "API Key" field at the top
3. You should see a green checkmark (✓) when the key is valid
4. Start chatting or uploading knowledge documents!

## API Key Storage

The test UI automatically saves your API key in browser localStorage, so you won't need to enter it again on refresh.

## Creating Additional API Keys

Once you have an API key with admin permissions, you can create more keys via the API:

```bash
curl -X POST http://localhost:3000/v1/tenants/{tenantId}/api-keys \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Key",
    "environment": "live",
    "permissions": {
      "chat": true,
      "knowledge": true,
      "admin": false
    }
  }'
```

## Troubleshooting

### "API key already exists"

The seed script creates a default tenant. If you run it multiple times, it won't create duplicate API keys. To get a new key:

1. Delete the existing API key from the database, OR
2. Create a new tenant via the API

### "Invalid API key" in the UI

- Make sure you copied the entire key (it's long!)
- Check for extra spaces before/after
- Verify the key starts with `omni_test_` or `omni_live_`
- Ensure the server is running

### Database connection errors

- Verify PostgreSQL is running: `docker compose ps` or `psql -U omniscient -d omniscient`
- Check `DATABASE_URL` in `.env` is correct
- For Docker: use `postgresql://omniscient:omniscient@localhost:5432/omniscient`
- For local PostgreSQL: use your connection string

## Next Steps

- Upload knowledge documents (PDF, TXT, DOCX)
- Configure your bot's system prompt
- Test conversations
- Check out the API documentation at `/v1` endpoint
