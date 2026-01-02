# Docker Configuration

This directory contains Docker configuration files for the Omniscient project.

## Files

- `Dockerfile` - Multi-stage build for the application
- `docker-compose.yml` - Full production stack (root directory)
- `docker-compose.dev.yml` - Development services only (root directory)

## Quick Start

See [DOCKER.md](../DOCKER.md) in the root directory for complete instructions.

### Development
```bash
docker compose -f docker-compose.dev.yml up -d
```

### Production
```bash
docker compose up -d
```


