#!/bin/bash
# Stop Docker services for Omniscient

set -e

if [ "$1" == "dev" ]; then
  echo "🛑 Stopping development services..."
  docker compose -f docker-compose.dev.yml down
else
  echo "🛑 Stopping all services..."
  docker compose down
  
  if [ "$1" == "--clean" ]; then
    echo "🧹 Removing volumes (this will delete all data)..."
    docker compose down -v
    echo "✅ Volumes removed"
  fi
fi

echo "✅ Services stopped"


