# Docker Setup Guide

This guide explains how to run the Omniscient project using Docker.

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- Environment variables configured (see `.env.example`)

## Quick Start

### 1. Development Mode (Database & Redis only)

For local development, you can run just the database and Redis services:

```bash
# Start services
docker compose -f docker-compose.dev.yml up -d

# Stop services
docker compose -f docker-compose.dev.yml down

# View logs
docker compose -f docker-compose.dev.yml logs -f
```

Then run the app locally:
```bash
pnpm install
pnpm db:push
pnpm dev
```

### 2. Full Production Setup

Run the entire stack (app + database + Redis + workers) in Docker:

```bash
# Create .env file with required variables
cp .env.example .env
# Edit .env and add your API keys

# Build and start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and remove volumes (clears data)
docker compose down -v
```

## Environment Variables

Required environment variables (set in `.env` or pass directly):

```bash
# Required
PINECONE_API_KEY=your-pinecone-api-key
GROQ_API_KEY=your-groq-api-key
OPENAI_API_KEY=your-openai-api-key

# Optional
PINECONE_INDEX=omniscient
STORAGE_PROVIDER=local  # or 's3'
MASTER_API_KEY=master_your-master-key  # Optional, for tenant management
```

## Services

### Application (`app`)
- **Port**: 3000
- **Health**: http://localhost:3000/health
- **API**: http://localhost:3000/v1

### Workers (`workers`)
- Background job processing (document processing, embeddings)
- Runs in separate container

### PostgreSQL (`postgres`)
- **Port**: 5432
- **Database**: omniscient
- **User**: omniscient
- **Password**: omniscient (change in production!)

### Redis (`redis`)
- **Port**: 6379
- Used for job queues and caching

## Database Setup

After starting the services, initialize the database:

```bash
# Run migrations
docker compose exec app pnpm db:push

# Seed initial data (optional)
docker compose exec app pnpm db:seed
```

## Useful Commands

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f app
docker compose logs -f workers

# Execute commands in container
docker compose exec app pnpm db:push
docker compose exec app sh

# Rebuild after code changes
docker compose build app
docker compose up -d app

# View running containers
docker compose ps

# Stop all services
docker compose down

# Clean everything (including volumes)
docker compose down -v
```

## Production Considerations

1. **Change default passwords**: Update PostgreSQL credentials in `docker-compose.yml`
2. **Use secrets**: Store API keys in Docker secrets or environment files
3. **Configure storage**: Set up S3 for production file storage
4. **Enable HTTPS**: Use a reverse proxy (nginx/traefik) in front
5. **Resource limits**: Add CPU/memory limits to services
6. **Backup strategy**: Set up regular PostgreSQL backups

## Troubleshooting

### Database connection issues
```bash
# Check if postgres is healthy
docker compose ps

# View postgres logs
docker compose logs postgres

# Test connection
docker compose exec postgres psql -U omniscient -d omniscient
```

### Application won't start
```bash
# Check app logs
docker compose logs app

# Verify environment variables
docker compose exec app env | grep -E 'DATABASE_URL|REDIS_URL|PINECONE'
```

### Port conflicts
If ports 3000, 5432, or 6379 are already in use, modify the port mappings in `docker-compose.yml`:
```yaml
ports:
  - '3001:3000'  # Use 3001 instead of 3000
```

## Development Workflow

1. Start database services: `docker compose -f docker-compose.dev.yml up -d`
2. Run app locally: `pnpm dev`
3. Make code changes (hot reload works)
4. Run tests: `pnpm test`
5. When done: `docker compose -f docker-compose.dev.yml down`


