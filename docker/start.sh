#!/bin/bash
# Start Docker services for Omniscient

set -e

echo "🚀 Starting Omniscient Docker services..."

# Check if .env file exists
if [ ! -f .env ]; then
  echo "⚠️  Warning: .env file not found"
  echo "   Create .env file with required API keys (see .env.example)"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Start services
if [ "$1" == "dev" ]; then
  echo "📦 Starting development services (postgres + redis)..."
  docker compose -f docker-compose.dev.yml up -d
  echo "✅ Services started!"
  echo "   PostgreSQL: localhost:5432"
  echo "   Redis: localhost:6379"
  echo ""
  echo "Run 'pnpm dev' to start the app locally"
else
  echo "📦 Starting full production stack..."
  docker compose up -d
  
  echo "⏳ Waiting for services to be healthy..."
  sleep 5
  
  echo "📊 Service status:"
  docker compose ps
  
  echo ""
  echo "✅ Services started!"
  echo "   App: http://localhost:3000"
  echo "   Health: http://localhost:3000/health"
  echo ""
  echo "📝 Next steps:"
  echo "   1. Initialize database: docker compose exec app pnpm db:push"
  echo "   2. (Optional) Seed data: docker compose exec app pnpm db:seed"
  echo "   3. View logs: docker compose logs -f"
fi


