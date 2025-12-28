# Omniscient - Technical Specification

## Multi-Tenant AI Chatbot Platform

**Version:** 1.0.0
**Status:** Planning
**Last Updated:** 2024-12-24

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Database Schema](#4-database-schema)
5. [API Specification](#5-api-specification)
6. [Knowledge Ingestion Pipeline](#6-knowledge-ingestion-pipeline)
7. [Channel Adapters](#7-channel-adapters)
8. [Bot Engine](#8-bot-engine)
9. [Authentication & Multi-Tenancy](#9-authentication--multi-tenancy)
10. [Background Jobs](#10-background-jobs)
11. [Configuration](#11-configuration)
12. [Deployment](#12-deployment)
13. [Implementation Phases](#13-implementation-phases)

---

## 1. Overview

### 1.1 What is Omniscient?

Omniscient is a multi-tenant AI chatbot platform that allows any company to:
- Upload knowledge documents (PDFs, FAQs, policies, compliance docs)
- Connect to multiple messaging channels (WhatsApp, Telegram, Web, etc.)
- Provide AI-powered customer support using their knowledge base
- Escalate to human agents when needed

### 1.2 Core Features

| Feature | Description |
|---------|-------------|
| Multi-Tenancy | Each company (tenant) has isolated data and configuration |
| Knowledge Ingestion | Upload PDFs, DOCX, CSV, or connect to Zendesk/Notion |
| Vector Search | RAG-based retrieval using embeddings and Pinecone |
| Multi-Channel | WhatsApp, Telegram, Web Widget, Slack, Email |
| Conversation Management | State machine, history, escalation workflows |
| Admin Dashboard | Tenant onboarding, knowledge management, analytics |

### 1.3 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      ADMIN DASHBOARD                            │
│              (Next.js / React - Future Phase)                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API GATEWAY                              │
│                    (Fastify + TypeScript)                       │
│         ┌──────────────────────────────────────────┐            │
│         │  Auth │ Rate Limit │ Tenant Resolution   │            │
│         └──────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   WhatsApp    │     │   Telegram    │     │  Web Widget   │
│   Adapter     │     │   Adapter     │     │   Adapter     │
└───────────────┘     └───────────────┘     └───────────────┘
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CORE SERVICES                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │ BotEngine   │ │ Knowledge   │ │Conversation │ │ Escalation│  │
│  │ Service     │ │ Service     │ │ Service     │ │ Service   │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│  PostgreSQL   │     │   Pinecone    │     │    Redis      │
│  (Primary DB) │     │  (Vectors)    │     │ (Cache/Queue) │
└───────────────┘     └───────────────┘     └───────────────┘
```

---

## 2. Tech Stack

### 2.1 Core Technologies

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| **Runtime** | Node.js | 20 LTS | Server runtime |
| **Language** | TypeScript | 5.x | Type safety |
| **Framework** | Fastify | 4.x | HTTP server |
| **ORM** | Prisma | 5.x | Database access |
| **Database** | PostgreSQL | 15+ | Primary data store |
| **Vector DB** | Pinecone | - | Embeddings storage |
| **Cache** | Redis | 7.x | Sessions, job queue |
| **Job Queue** | BullMQ | 5.x | Background processing |

### 2.2 AI/ML Services

| Service | Provider | Purpose |
|---------|----------|---------|
| **LLM** | Groq (llama-3.1-70b) | Chat completions |
| **LLM Fallback** | OpenAI (gpt-4o-mini) | Backup provider |
| **Embeddings** | OpenAI (text-embedding-3-small) | Vector generation |
| **PDF Parsing** | LlamaParse | Complex PDF extraction |
| **PDF Fallback** | pdf-parse | Simple PDF extraction |

### 2.3 External Integrations

| Integration | Purpose |
|-------------|---------|
| **WhatsApp Business API** | WhatsApp messaging |
| **Telegram Bot API** | Telegram messaging |
| **Twilio** | SMS (future) |
| **Zendesk API** | Knowledge import, ticketing |
| **AWS S3 / Cloudflare R2** | File storage |

### 2.4 Development Tools

| Tool | Purpose |
|------|---------|
| **pnpm** | Package manager |
| **Vitest** | Unit testing |
| **ESLint** | Linting |
| **Prettier** | Code formatting |
| **Docker** | Local development |
| **docker-compose** | Local services |

---

## 3. Project Structure

```
omniscient/
├── src/
│   ├── index.ts                    # Application entry point
│   ├── server.ts                   # Fastify server setup
│   ├── config/
│   │   ├── index.ts                # Configuration loader
│   │   ├── env.ts                  # Environment validation (zod)
│   │   └── constants.ts            # App constants
│   │
│   ├── modules/                    # Feature modules
│   │   ├── tenant/
│   │   │   ├── tenant.routes.ts
│   │   │   ├── tenant.controller.ts
│   │   │   ├── tenant.service.ts
│   │   │   ├── tenant.schema.ts    # Zod schemas
│   │   │   └── tenant.types.ts
│   │   │
│   │   ├── knowledge/
│   │   │   ├── knowledge.routes.ts
│   │   │   ├── knowledge.controller.ts
│   │   │   ├── knowledge.service.ts
│   │   │   ├── knowledge.schema.ts
│   │   │   ├── processors/
│   │   │   │   ├── pdf.processor.ts
│   │   │   │   ├── docx.processor.ts
│   │   │   │   ├── csv.processor.ts
│   │   │   │   └── url.processor.ts
│   │   │   ├── chunkers/
│   │   │   │   ├── recursive.chunker.ts
│   │   │   │   ├── faq.chunker.ts
│   │   │   │   └── semantic.chunker.ts
│   │   │   └── embeddings/
│   │   │       ├── openai.embedder.ts
│   │   │       └── embedder.interface.ts
│   │   │
│   │   ├── conversation/
│   │   │   ├── conversation.routes.ts
│   │   │   ├── conversation.controller.ts
│   │   │   ├── conversation.service.ts
│   │   │   ├── conversation.schema.ts
│   │   │   └── conversation.state-machine.ts
│   │   │
│   │   ├── chat/
│   │   │   ├── chat.routes.ts
│   │   │   ├── chat.controller.ts
│   │   │   ├── chat.service.ts       # Orchestrates bot responses
│   │   │   └── chat.schema.ts
│   │   │
│   │   ├── bot/
│   │   │   ├── bot.engine.ts         # Core AI response logic
│   │   │   ├── bot.prompts.ts        # System prompt templates
│   │   │   └── bot.types.ts
│   │   │
│   │   └── escalation/
│   │       ├── escalation.routes.ts
│   │       ├── escalation.controller.ts
│   │       ├── escalation.service.ts
│   │       └── escalation.schema.ts
│   │
│   ├── adapters/                   # Channel adapters
│   │   ├── adapter.interface.ts    # Common interface
│   │   ├── whatsapp/
│   │   │   ├── whatsapp.adapter.ts
│   │   │   ├── whatsapp.routes.ts  # Webhook endpoints
│   │   │   └── whatsapp.types.ts
│   │   ├── telegram/
│   │   │   ├── telegram.adapter.ts
│   │   │   ├── telegram.routes.ts
│   │   │   └── telegram.types.ts
│   │   └── web/
│   │       ├── web.adapter.ts
│   │       ├── web.routes.ts
│   │       └── web.types.ts
│   │
│   ├── jobs/                       # Background job processors
│   │   ├── queue.ts                # BullMQ setup
│   │   ├── workers/
│   │   │   ├── document.worker.ts  # PDF/doc processing
│   │   │   ├── embedding.worker.ts # Vector generation
│   │   │   └── sync.worker.ts      # External source sync
│   │   └── jobs.types.ts
│   │
│   ├── lib/                        # Shared libraries
│   │   ├── prisma.ts               # Prisma client singleton
│   │   ├── redis.ts                # Redis client
│   │   ├── pinecone.ts             # Pinecone client
│   │   ├── llm/
│   │   │   ├── llm.interface.ts
│   │   │   ├── groq.client.ts
│   │   │   └── openai.client.ts
│   │   ├── storage/
│   │   │   ├── storage.interface.ts
│   │   │   ├── s3.storage.ts
│   │   │   └── local.storage.ts
│   │   └── logger.ts               # Pino logger
│   │
│   ├── middleware/
│   │   ├── auth.middleware.ts      # API key validation
│   │   ├── tenant.middleware.ts    # Tenant resolution
│   │   ├── rate-limit.middleware.ts
│   │   └── error.middleware.ts
│   │
│   ├── utils/
│   │   ├── pii-redactor.ts
│   │   ├── token-counter.ts
│   │   └── hash.ts
│   │
│   └── types/
│       ├── fastify.d.ts            # Fastify type extensions
│       └── global.d.ts
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── scripts/
│   ├── seed.ts                     # Database seeding
│   └── migrate.ts
│
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml          # Local dev services
│
├── .env.example
├── .eslintrc.js
├── .prettierrc
├── tsconfig.json
├── vitest.config.ts
├── package.json
└── README.md
```

---

## 4. Database Schema

### 4.1 Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================
// TENANT MANAGEMENT
// ============================================

model Tenant {
  id                  String        @id @default(uuid())
  name                String
  slug                String        @unique

  // Authentication
  apiKey              String        @unique
  apiKeyHash          String        // Hashed version for lookup

  // Status
  status              TenantStatus  @default(ACTIVE)

  // Branding & Configuration
  botName             String        @default("Assistant")
  systemPrompt        String?       @db.Text
  welcomeMessage      String?
  fallbackMessage     String?       // When no knowledge found

  // Limits
  monthlyMessageLimit Int           @default(10000)
  monthlyMessagesUsed Int           @default(0)

  // Settings
  settings            Json?         // Flexible settings JSON

  // Relations
  users               User[]
  conversations       Conversation[]
  knowledgeSources    KnowledgeSource[]
  channelConfigs      ChannelConfig[]
  apiKeys             ApiKey[]

  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  @@index([slug])
  @@index([apiKeyHash])
}

enum TenantStatus {
  ACTIVE
  SUSPENDED
  DELETED
}

model ApiKey {
  id          String    @id @default(uuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  name        String    // "Production", "Development"
  keyHash     String    @unique
  keyPrefix   String    // First 8 chars for identification

  permissions Json      // { "chat": true, "knowledge": true, "admin": false }

  lastUsedAt  DateTime?
  expiresAt   DateTime?

  createdAt   DateTime  @default(now())

  @@index([tenantId])
  @@index([keyHash])
}

// ============================================
// CHANNEL CONFIGURATION
// ============================================

model ChannelConfig {
  id          String    @id @default(uuid())
  tenantId    String
  tenant      Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  channel     Channel
  enabled     Boolean   @default(true)

  // Encrypted credentials stored as JSON
  // WhatsApp: { phoneNumberId, accessToken, webhookVerifyToken }
  // Telegram: { botToken }
  // Web: { allowedOrigins: [] }
  credentials Json

  // Webhook configuration
  webhookUrl  String?
  webhookSecret String?

  // Channel-specific settings
  settings    Json?

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([tenantId, channel])
  @@index([tenantId])
}

enum Channel {
  WHATSAPP
  TELEGRAM
  WEB
  SLACK
  EMAIL
  SMS
}

// ============================================
// USERS (End customers of tenants)
// ============================================

model User {
  id              String    @id @default(uuid())
  tenantId        String
  tenant          Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // Channel identifiers (user can exist on multiple channels)
  whatsappNumber  String?
  telegramId      String?
  email           String?
  webSessionId    String?

  // Profile
  displayName     String?

  // Metadata
  metadata        Json?

  // Relations
  conversations   Conversation[]

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  lastSeenAt      DateTime?

  @@unique([tenantId, whatsappNumber])
  @@unique([tenantId, telegramId])
  @@unique([tenantId, email])
  @@index([tenantId])
}

// ============================================
// CONVERSATIONS
// ============================================

model Conversation {
  id              String              @id @default(uuid())
  tenantId        String
  tenant          Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  userId          String
  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Status
  status          ConversationStatus  @default(BOT_ACTIVE)

  // Channel info
  channel         Channel
  channelConversationId String?       // External ID from channel

  // Metadata
  metadata        Json?

  // Relations
  messages        Message[]
  escalation      Escalation?

  // Timestamps
  startedAt       DateTime            @default(now())
  lastActivityAt  DateTime            @default(now())
  escalatedAt     DateTime?
  resolvedAt      DateTime?
  closedAt        DateTime?

  @@index([tenantId, status])
  @@index([tenantId, userId])
  @@index([tenantId, channel])
  @@index([lastActivityAt])
}

enum ConversationStatus {
  BOT_ACTIVE
  ESCALATED
  HUMAN_ACTIVE
  RESOLVED
  CLOSED
}

model Message {
  id              String    @id @default(uuid())
  conversationId  String
  conversation    Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  // Content
  role            MessageRole
  content         String    @db.Text
  contentHash     String?   // For deduplication

  // AI metadata (for assistant messages)
  tokensUsed      Int?
  confidenceScore Float?
  knowledgeSources Json?    // [{ sourceId, chunkId, score }]

  // Channel metadata
  channelMessageId String?

  // Media (if any)
  hasMedia        Boolean   @default(false)
  mediaType       String?
  mediaUrl        String?

  createdAt       DateTime  @default(now())

  @@index([conversationId])
  @@index([contentHash])
}

enum MessageRole {
  USER
  ASSISTANT
  SYSTEM
}

// ============================================
// ESCALATIONS
// ============================================

model Escalation {
  id              String            @id @default(uuid())
  conversationId  String            @unique
  conversation    Conversation      @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  reason          EscalationReason
  reasonDetails   String?

  // External ticket reference
  externalTicketId String?
  externalSystem   String?          // "zendesk", "freshdesk", etc.

  // Agent handling
  agentId         String?
  agentName       String?

  // Resolution
  resolvedAt      DateTime?
  resolutionNotes String?
  returnedToBot   Boolean           @default(false)

  createdAt       DateTime          @default(now())

  @@index([externalTicketId])
}

enum EscalationReason {
  USER_REQUEST
  LOW_CONFIDENCE
  SENSITIVE_TOPIC
  REPEATED_QUESTION
  LONG_CONVERSATION
  MEDIA_RECEIVED
  AUTH_REQUIRED
  ERROR
}

// ============================================
// KNOWLEDGE MANAGEMENT
// ============================================

model KnowledgeSource {
  id              String              @id @default(uuid())
  tenantId        String
  tenant          Tenant              @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // Source info
  name            String
  type            KnowledgeSourceType

  // For file uploads
  originalFilename String?
  mimeType        String?
  fileSize        Int?
  storagePath     String?            // S3/R2 path

  // For URL/connector sources
  sourceUrl       String?

  // Processing status
  status          IndexStatus        @default(PENDING)
  statusMessage   String?

  // Stats
  chunkCount      Int                @default(0)
  tokenCount      Int                @default(0)

  // Versioning
  version         Int                @default(1)
  checksum        String?            // For change detection

  // Pinecone reference
  pineconeNamespace String?          // tenant_{tenantId}

  // Timestamps
  uploadedAt      DateTime           @default(now())
  processedAt     DateTime?
  indexedAt       DateTime?
  lastSyncedAt    DateTime?

  // Relations
  chunks          KnowledgeChunk[]

  @@index([tenantId, status])
  @@index([tenantId, type])
}

enum KnowledgeSourceType {
  PDF
  DOCX
  TXT
  CSV
  URL
  ZENDESK
  FRESHDESK
  NOTION
  CONFLUENCE
}

enum IndexStatus {
  PENDING
  EXTRACTING
  CHUNKING
  EMBEDDING
  INDEXING
  INDEXED
  FAILED
  STALE
}

model KnowledgeChunk {
  id              String          @id @default(uuid())
  sourceId        String
  source          KnowledgeSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  // Content
  text            String          @db.Text
  tokenCount      Int

  // Position
  chunkIndex      Int
  pageNumber      Int?
  sectionTitle    String?

  // Vector reference
  vectorId        String          @unique  // Pinecone vector ID

  // Metadata (JSON for flexibility)
  metadata        Json

  createdAt       DateTime        @default(now())

  @@index([sourceId])
}

// ============================================
// ANALYTICS
// ============================================

model AnalyticsEvent {
  id              String    @id @default(uuid())
  tenantId        String

  eventType       String    // conversation_started, message_sent, escalation, etc.
  channel         Channel?
  userId          String?
  conversationId  String?

  metadata        Json?

  createdAt       DateTime  @default(now())

  @@index([tenantId, eventType])
  @@index([tenantId, createdAt])
}
```

### 4.2 Database Indexes Summary

| Table | Index | Purpose |
|-------|-------|---------|
| Tenant | slug | Lookup by subdomain |
| Tenant | apiKeyHash | Fast API key validation |
| User | tenantId + whatsappNumber | Channel user lookup |
| Conversation | tenantId + status | Active conversation queries |
| Conversation | lastActivityAt | Stale conversation cleanup |
| Message | conversationId | Conversation history |
| KnowledgeSource | tenantId + status | Processing queue |
| AnalyticsEvent | tenantId + createdAt | Time-series analytics |

---

## 5. API Specification

### 5.1 Authentication

All API requests require authentication via API key:

```
Authorization: Bearer omni_live_xxxxxxxxxxxx
```

API key format: `omni_{environment}_{random_string}`
- `omni_live_*` - Production keys
- `omni_test_*` - Test/development keys

### 5.2 Base URL

```
Production: https://api.omniscient.ai/v1
Development: http://localhost:3000/v1
```

### 5.3 Endpoints

#### Tenant Management (Admin)

```
POST   /v1/tenants                    Create new tenant
GET    /v1/tenants/:id                Get tenant details
PATCH  /v1/tenants/:id                Update tenant settings
DELETE /v1/tenants/:id                Delete tenant

POST   /v1/tenants/:id/api-keys       Generate new API key
GET    /v1/tenants/:id/api-keys       List API keys
DELETE /v1/tenants/:id/api-keys/:keyId Revoke API key
```

#### Knowledge Management

```
POST   /v1/knowledge/upload           Upload document (multipart)
POST   /v1/knowledge/url              Crawl URL
POST   /v1/knowledge/connect          Connect external source

GET    /v1/knowledge/sources          List all sources
GET    /v1/knowledge/sources/:id      Get source details
DELETE /v1/knowledge/sources/:id      Delete source & vectors

POST   /v1/knowledge/sources/:id/reindex   Force reindex
GET    /v1/knowledge/sources/:id/chunks    List chunks

GET    /v1/knowledge/search           Test search
       ?q=query&limit=5&threshold=0.7
```

#### Chat / Messaging

```
POST   /v1/chat                       Simple stateless chat
       {
         "message": "How do I get a refund?",
         "sessionId": "optional-session-id"
       }

POST   /v1/conversations              Create conversation
GET    /v1/conversations/:id          Get conversation + messages
POST   /v1/conversations/:id/messages Send message
POST   /v1/conversations/:id/escalate Escalate to human
POST   /v1/conversations/:id/close    Close conversation
```

#### Channel Webhooks

```
POST   /v1/webhooks/whatsapp          WhatsApp webhook
GET    /v1/webhooks/whatsapp          WhatsApp verification

POST   /v1/webhooks/telegram          Telegram webhook

POST   /v1/webhooks/web/:tenantSlug   Web widget messages
```

#### Channel Configuration

```
GET    /v1/channels                   List channel configs
POST   /v1/channels/:channel          Configure channel
PATCH  /v1/channels/:channel          Update channel config
DELETE /v1/channels/:channel          Disconnect channel
```

### 5.4 Request/Response Examples

#### Upload Document

```http
POST /v1/knowledge/upload
Content-Type: multipart/form-data
Authorization: Bearer omni_live_xxx

--boundary
Content-Disposition: form-data; name="file"; filename="refund-policy.pdf"
Content-Type: application/pdf

[binary data]
--boundary
Content-Disposition: form-data; name="name"

Refund Policy 2024
--boundary--
```

Response:
```json
{
  "success": true,
  "data": {
    "sourceId": "ks_abc123",
    "name": "Refund Policy 2024",
    "type": "PDF",
    "status": "PENDING",
    "message": "Document queued for processing"
  }
}
```

#### Send Chat Message

```http
POST /v1/chat
Content-Type: application/json
Authorization: Bearer omni_live_xxx

{
  "message": "How do I request a refund?",
  "sessionId": "sess_xyz789",
  "channel": "WEB",
  "metadata": {
    "page": "/help"
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "response": "To request a refund, you can...",
    "conversationId": "conv_def456",
    "confidence": 0.87,
    "sources": [
      {
        "name": "Refund Policy 2024",
        "section": "Refund Process"
      }
    ]
  }
}
```

### 5.5 Error Responses

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [
      { "field": "message", "error": "Required" }
    ]
  }
}
```

Error Codes:
| Code | HTTP Status | Description |
|------|-------------|-------------|
| UNAUTHORIZED | 401 | Invalid or missing API key |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| VALIDATION_ERROR | 400 | Invalid request body |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |

---

## 6. Knowledge Ingestion Pipeline

### 6.1 Pipeline Overview

```
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ UPLOAD  │ → │ EXTRACT │ → │  CHUNK  │ → │  EMBED  │ → │  INDEX  │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
     │             │             │             │             │
  Validate     Parse to      Split into    Generate      Upsert to
  + Store      plain text    segments      vectors       Pinecone
```

### 6.2 Job Queue Structure

```typescript
// Job types for BullMQ
interface DocumentJob {
  type: 'PROCESS_DOCUMENT';
  sourceId: string;
  tenantId: string;
}

interface EmbeddingJob {
  type: 'GENERATE_EMBEDDINGS';
  sourceId: string;
  tenantId: string;
  chunks: ChunkData[];
}

interface SyncJob {
  type: 'SYNC_EXTERNAL';
  tenantId: string;
  sourceType: 'ZENDESK' | 'NOTION';
  connectionId: string;
}
```

### 6.3 Document Processors

Each file type has a dedicated processor:

```typescript
// src/modules/knowledge/processors/pdf.processor.ts

interface DocumentProcessor {
  canProcess(mimeType: string): boolean;
  extract(buffer: Buffer, options?: ProcessorOptions): Promise<ExtractedDocument>;
}

interface ExtractedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
  };
  pages?: PageContent[];
}
```

### 6.4 Chunking Strategy

```typescript
// Recursive chunker configuration
const CHUNKING_CONFIG = {
  chunkSize: 800,           // Target characters per chunk
  chunkOverlap: 200,        // Overlap between chunks
  minChunkSize: 100,        // Minimum viable chunk
  separators: [
    '\n\n',                 // Paragraphs
    '\n',                   // Lines
    '. ',                   // Sentences
    ' ',                    // Words (fallback)
  ],
};
```

### 6.5 Vector Storage

Pinecone namespace strategy:
```
Index: "omniscient-knowledge"
├── Namespace: "tenant_acme_corp"
│   ├── Vector: chunk_src123_001
│   ├── Vector: chunk_src123_002
│   └── ...
├── Namespace: "tenant_globex"
│   └── ...
```

Vector metadata:
```typescript
interface VectorMetadata {
  text: string;              // Chunk text (for retrieval display)
  sourceId: string;
  sourceName: string;
  chunkIndex: number;
  pageNumber?: number;
  sectionTitle?: string;
  contentType: string;       // 'faq', 'policy', 'general'
}
```

---

## 7. Channel Adapters

### 7.1 Adapter Interface

All channel adapters implement this interface:

```typescript
// src/adapters/adapter.interface.ts

interface ChannelAdapter {
  readonly channel: Channel;

  // Initialize adapter with tenant config
  initialize(config: ChannelConfig): Promise<void>;

  // Handle incoming message from channel
  handleIncoming(payload: unknown): Promise<NormalizedMessage>;

  // Send message to channel
  sendMessage(params: SendMessageParams): Promise<SendResult>;

  // Verify webhook (for setup)
  verifyWebhook?(params: VerifyParams): Promise<VerifyResult>;
}

interface NormalizedMessage {
  externalId: string;        // Channel's message ID
  externalUserId: string;    // Channel's user ID
  channel: Channel;
  content: string;
  hasMedia: boolean;
  mediaType?: string;
  mediaUrl?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface SendMessageParams {
  externalUserId: string;
  content: string;
  buttons?: Button[];
  quickReplies?: string[];
}
```

### 7.2 WhatsApp Adapter

```typescript
// WhatsApp Cloud API integration
// Webhook: POST /v1/webhooks/whatsapp
// Verification: GET /v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=xxx

// Required credentials in ChannelConfig:
interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;       // Encrypted
  webhookVerifyToken: string;
  businessAccountId?: string;
}
```

### 7.3 Telegram Adapter

```typescript
// Telegram Bot API integration
// Webhook: POST /v1/webhooks/telegram

// Required credentials:
interface TelegramCredentials {
  botToken: string;          // Encrypted
}
```

### 7.4 Web Widget Adapter

```typescript
// REST API + WebSocket for web chat
// REST: POST /v1/webhooks/web/:tenantSlug
// WebSocket: wss://api.omniscient.ai/ws/:tenantSlug

// Required credentials:
interface WebCredentials {
  allowedOrigins: string[];  // CORS origins
  widgetConfig: {
    primaryColor: string;
    position: 'left' | 'right';
    greeting: string;
  };
}
```

---

## 8. Bot Engine

### 8.1 Response Generation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     BOT ENGINE FLOW                             │
└─────────────────────────────────────────────────────────────────┘

1. Receive normalized message
           │
           ▼
2. Load tenant configuration (system prompt, settings)
           │
           ▼
3. Load conversation history (last 20 messages)
           │
           ▼
4. Query Pinecone for relevant knowledge
   └── Namespace: tenant_{tenantId}
   └── Top K: 10, Min Score: 0.7
           │
           ▼
5. Build prompt
   ├── System prompt (tenant-specific)
   ├── Knowledge context (retrieved chunks)
   └── Conversation history + new message
           │
           ▼
6. Check token limits (truncate if needed)
           │
           ▼
7. Call LLM (Groq → OpenAI fallback)
           │
           ▼
8. Calculate confidence score
           │
           ▼
9. Check escalation triggers
   ├── Low confidence? → Escalate
   ├── Sensitive topic? → Escalate
   └── User requested? → Escalate
           │
           ▼
10. Store message + Return response
```

### 8.2 System Prompt Template

```typescript
const SYSTEM_PROMPT_TEMPLATE = `
You are {{botName}}, a helpful customer support assistant for {{companyName}}.

Your role:
- Answer questions using ONLY the provided knowledge base
- Be friendly, professional, and concise
- If you don't know the answer, say so honestly
- Never make up information

{{#if customInstructions}}
Additional instructions:
{{customInstructions}}
{{/if}}

When responding:
- Keep answers concise (2-3 sentences when possible)
- Use bullet points for lists
- Offer to escalate to a human if the user seems frustrated

{{#if knowledgeContext}}
Relevant information from the knowledge base:
---
{{knowledgeContext}}
---
{{/if}}
`;
```

### 8.3 Escalation Triggers

```typescript
const ESCALATION_TRIGGERS = {
  // Explicit requests
  userRequestPatterns: [
    /speak.*(human|agent|person|someone)/i,
    /talk.*(human|agent|person|someone)/i,
    /escalate/i,
    /real person/i,
  ],

  // Sensitive topics
  sensitiveTopics: [
    'refund', 'fraud', 'dispute', 'legal',
    'complaint', 'lawyer', 'sue', 'police',
  ],

  // Thresholds
  lowConfidenceThreshold: 0.5,
  repeatedQuestionThreshold: 3,
  longConversationThreshold: 20,  // messages
};
```

---

## 9. Authentication & Multi-Tenancy

### 9.1 API Key Authentication

```typescript
// Middleware flow:
// 1. Extract API key from Authorization header
// 2. Hash the key
// 3. Lookup tenant by keyHash
// 4. Attach tenant to request context

// Key generation:
function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(24).toString('base64url');
  const key = `omni_live_${random}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = key.substring(0, 16);
  return { key, hash, prefix };
}
```

### 9.2 Tenant Resolution

```typescript
// Every request has tenant context
interface RequestContext {
  tenant: {
    id: string;
    slug: string;
    settings: TenantSettings;
  };
  apiKey: {
    id: string;
    permissions: Permissions;
  };
}

// Fastify decorator
declare module 'fastify' {
  interface FastifyRequest {
    tenant: RequestContext['tenant'];
    apiKey: RequestContext['apiKey'];
  }
}
```

### 9.3 Data Isolation

All database queries MUST include tenantId:

```typescript
// CORRECT
const sources = await prisma.knowledgeSource.findMany({
  where: { tenantId: req.tenant.id, status: 'INDEXED' },
});

// WRONG - Never do this!
const sources = await prisma.knowledgeSource.findMany({
  where: { status: 'INDEXED' },
});
```

---

## 10. Background Jobs

### 10.1 Queue Configuration

```typescript
// src/jobs/queue.ts
import { Queue, Worker } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };

export const documentQueue = new Queue('document-processing', { connection });
export const embeddingQueue = new Queue('embedding-generation', { connection });
export const syncQueue = new Queue('external-sync', { connection });
```

### 10.2 Job Definitions

| Queue | Job Type | Description |
|-------|----------|-------------|
| document-processing | EXTRACT | Extract text from uploaded file |
| document-processing | CHUNK | Split text into chunks |
| embedding-generation | EMBED | Generate vectors for chunks |
| embedding-generation | INDEX | Upsert vectors to Pinecone |
| external-sync | SYNC_ZENDESK | Sync Zendesk articles |
| external-sync | SYNC_NOTION | Sync Notion pages |

### 10.3 Worker Implementation

```typescript
// src/jobs/workers/document.worker.ts
const worker = new Worker('document-processing', async (job) => {
  const { sourceId, tenantId } = job.data;

  switch (job.name) {
    case 'EXTRACT':
      await extractDocument(sourceId);
      // Queue next step
      await documentQueue.add('CHUNK', { sourceId, tenantId });
      break;

    case 'CHUNK':
      const chunks = await chunkDocument(sourceId);
      await embeddingQueue.add('EMBED', { sourceId, tenantId, chunks });
      break;
  }
}, { connection });
```

---

## 11. Configuration

### 11.1 Environment Variables

```bash
# .env.example

# Server
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/omniscient

# Redis
REDIS_URL=redis://localhost:6379

# Pinecone
PINECONE_API_KEY=xxx
PINECONE_INDEX=omniscient-knowledge

# LLM Providers
GROQ_API_KEY=xxx
OPENAI_API_KEY=xxx

# Embeddings
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Storage (S3/R2)
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_BUCKET=omniscient-files
AWS_REGION=us-east-1

# PDF Processing
LLAMAPARSE_API_KEY=xxx

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
```

### 11.2 Configuration Validation

```typescript
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PINECONE_API_KEY: z.string().min(1),
  // ... etc
});

export const env = envSchema.parse(process.env);
```

---

## 12. Deployment

### 12.1 Docker Compose (Local Development)

```yaml
# docker/docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: omniscient
      POSTGRES_PASSWORD: omniscient
      POSTGRES_DB: omniscient
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### 12.2 Production Deployment Options

| Option | Pros | Cons |
|--------|------|------|
| **Railway** | Easy, auto-scaling, good free tier | Less control |
| **Render** | Simple, good DX | Cold starts |
| **Fly.io** | Global edge, good pricing | More complex |
| **AWS ECS** | Full control, scalable | Complex setup |
| **Digital Ocean App Platform** | Simple, predictable pricing | Limited regions |

### 12.3 Recommended Production Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRODUCTION STACK                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Compute:     Railway / Render / Fly.io                         │
│  Database:    Neon (serverless Postgres) / Railway Postgres     │
│  Redis:       Upstash (serverless) / Railway Redis              │
│  Vectors:     Pinecone (managed)                                │
│  Storage:     Cloudflare R2 (cheap) / AWS S3                    │
│  CDN:         Cloudflare                                        │
│  Monitoring:  Sentry + Axiom                                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 13. Implementation Phases

### Phase 1: Foundation (MVP)

**Goal:** Basic working chatbot with knowledge upload

| Task | Priority | Complexity |
|------|----------|------------|
| Project setup (Fastify + TypeScript + Prisma) | P0 | Low |
| Database schema + migrations | P0 | Medium |
| Tenant management (CRUD) | P0 | Low |
| API key authentication | P0 | Low |
| PDF upload + extraction | P0 | Medium |
| Chunking + embedding pipeline | P0 | Medium |
| Pinecone integration | P0 | Medium |
| Bot engine (basic) | P0 | Medium |
| Simple chat endpoint | P0 | Low |
| Web adapter (REST) | P0 | Low |

**Deliverable:** API that accepts PDF uploads and answers questions

---

### Phase 2: Channels

**Goal:** WhatsApp and Telegram integration

| Task | Priority | Complexity |
|------|----------|------------|
| Channel config management | P1 | Low |
| WhatsApp adapter | P1 | Medium |
| Telegram adapter | P1 | Medium |
| Conversation persistence | P1 | Medium |
| Message history | P1 | Low |
| Basic escalation | P1 | Medium |

**Deliverable:** Working bots on WhatsApp and Telegram

---

### Phase 3: Knowledge Expansion

**Goal:** More document types and sources

| Task | Priority | Complexity |
|------|----------|------------|
| DOCX processor | P2 | Low |
| CSV/FAQ processor | P2 | Low |
| URL crawler | P2 | Medium |
| Zendesk connector | P2 | Medium |
| Notion connector | P2 | Medium |
| Sync scheduling | P2 | Medium |

**Deliverable:** Import knowledge from multiple sources

---

### Phase 4: Admin Dashboard

**Goal:** Self-service tenant management

| Task | Priority | Complexity |
|------|----------|------------|
| Dashboard UI (Next.js) | P3 | High |
| Tenant onboarding flow | P3 | Medium |
| Knowledge management UI | P3 | Medium |
| Channel connection UI | P3 | Medium |
| Conversation viewer | P3 | Medium |
| Basic analytics | P3 | Medium |

**Deliverable:** Admin dashboard for tenant self-service

---

### Phase 5: Enterprise Features

**Goal:** Production-ready platform

| Task | Priority | Complexity |
|------|----------|------------|
| SSO integration | P4 | High |
| Advanced analytics | P4 | High |
| Webhook callbacks | P4 | Medium |
| Multi-language support | P4 | High |
| Audit logging | P4 | Medium |
| SLA monitoring | P4 | Medium |

---

## Appendix A: Tech Decision Rationale

### Why Fastify over Express?
- 2-3x faster request handling
- Built-in TypeScript support
- Schema validation (JSON Schema)
- Better plugin architecture

### Why Prisma over raw SQL/Knex?
- Type-safe database queries
- Auto-generated types from schema
- Easy migrations
- Good DX for team

### Why BullMQ over alternatives?
- Battle-tested, used by major companies
- Redis-based (already using Redis)
- Good job retry/failure handling
- Dashboard available (Bull Board)

### Why Pinecone over self-hosted?
- Fully managed, no DevOps needed
- Good free tier for MVP
- Fast queries at scale
- Namespace isolation for multi-tenancy

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Tenant** | A company using the platform |
| **Channel** | Communication platform (WhatsApp, Telegram, etc.) |
| **Knowledge Source** | Uploaded document or connected external source |
| **Chunk** | Segment of text from a document |
| **Embedding** | Vector representation of text |
| **RAG** | Retrieval Augmented Generation |
| **Escalation** | Transfer from bot to human agent |

---

*End of Technical Specification*
