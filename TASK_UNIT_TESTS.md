# Unit Test Implementation Tasks

## Overview

Create comprehensive unit tests for all remaining modules. Follow the existing patterns in `tests/unit/tenant/`.

**Current Coverage:** tenant module (57 tests)
**Target Coverage:** All modules with service, controller, and utility functions

---

## Module 1: Conversation Service

**File:** `tests/unit/conversation/conversation.service.test.ts`
**Source:** `src/modules/conversation/conversation.service.ts`

### Functions to Test

#### 1. `createConversation`
```typescript
// Test cases:
- should create conversation with all params
- should create conversation with minimal params (no metadata)
- should set status to BOT_ACTIVE by default
- should handle different channel types (WEB, WHATSAPP, etc.)
```

#### 2. `getConversationHistory`
```typescript
// Test cases:
- should return messages in chronological order
- should respect limit parameter
- should use default limit from CONSTANTS when not specified
- should return empty array for conversation with no messages
```

### Mock Requirements
```typescript
vi.mock('../../../src/lib/prisma.js', () => ({
  prisma: {
    conversation: { create: vi.fn() },
    message: { findMany: vi.fn() },
  },
}));

vi.mock('../../../src/config/index.js', () => ({
  CONSTANTS: { MAX_CONVERSATION_HISTORY: 50 },
}));
```

---

## Module 2: Chat Service

**File:** `tests/unit/chat/chat.service.test.ts`
**Source:** `src/modules/chat/chat.service.ts`

### Functions to Test

#### 1. `processChat`
```typescript
// Test cases:
- should find existing user by sessionId
- should create new user if sessionId not found
- should create new user with random sessionId if none provided
- should find active conversation for user
- should create new conversation if none exists
- should return escalation response if conversation already escalated
- should process message through bot engine
- should save user message to database
- should save assistant message to database
- should update conversation lastActivityAt
- should trigger escalation if botResponse.shouldEscalate is true
```

#### 2. `sendMessageToConversation`
```typescript
// Test cases:
- should send message to existing conversation
- should throw 'Conversation not found' for invalid conversationId
- should throw 'Conversation is closed' for closed conversation
```

#### 3. `getConversation`
```typescript
// Test cases:
- should return conversation with messages and escalation
- should return null for non-existent conversation
- should only return conversation for matching tenantId
```

#### 4. `escalateConversation`
```typescript
// Test cases:
- should update conversation status to ESCALATED
- should create escalation record
- should set escalatedAt timestamp
- should throw 'Conversation not found' for invalid conversationId
- should handle optional reason parameter
```

#### 5. `closeConversation`
```typescript
// Test cases:
- should update conversation status to CLOSED
- should set closedAt timestamp
- should throw 'Conversation not found' for invalid conversationId
```

### Mock Requirements
```typescript
vi.mock('../../../src/lib/prisma.js');
vi.mock('../../../src/modules/bot/bot.engine.js', () => ({
  botEngine: { generateResponse: vi.fn() },
}));
vi.mock('../../../src/modules/conversation/conversation.service.js');
vi.mock('../../../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
```

---

## Module 3: Chat Controller

**File:** `tests/unit/chat/chat.controller.test.ts`
**Source:** `src/modules/chat/chat.controller.ts`

### Functions to Test

#### 1. `chat`
```typescript
// Test cases:
- should return success response with chat result
- should use default channel 'WEB' if not provided
- should pass metadata to service
```

#### 2. `getConversation`
```typescript
// Test cases:
- should return conversation data
- should return 404 for non-existent conversation
```

#### 3. `sendMessage`
```typescript
// Test cases:
- should send message and return result
- should handle service errors
```

#### 4. `escalateConversation`
```typescript
// Test cases:
- should escalate conversation
- should pass optional reason
```

#### 5. `closeConversation`
```typescript
// Test cases:
- should close conversation and return success
```

### Fixture Requirements
Create `tests/fixtures/chat.fixtures.ts`:
```typescript
export const mockChatRequest = (overrides = {}) => ({
  tenant: { id: 'tenant-1', botName: 'Bot', systemPrompt: null, fallbackMessage: null },
  body: { message: 'Hello', sessionId: 'session-1' },
  params: {},
  ...overrides,
});

export const mockChatResponse = {
  response: 'Hi there!',
  conversationId: 'conv-1',
  messageId: 'msg-1',
  confidence: 0.85,
  sources: [],
  shouldEscalate: false,
};
```

---

## Module 4: Knowledge Service

**File:** `tests/unit/knowledge/knowledge.service.test.ts`
**Source:** `src/modules/knowledge/knowledge.service.ts`

### Functions to Test

#### 1. `uploadDocument`
```typescript
// Test cases:
- should upload PDF document successfully
- should upload DOCX document successfully
- should upload TXT document successfully
- should throw for unsupported file type
- should throw for file type without processor
- should create knowledgeSource record with status PENDING
- should queue processing job
- should generate unique storage path
```

#### 2. `listSources`
```typescript
// Test cases:
- should return paginated list of sources
- should filter by status
- should return total count
- should respect limit and offset
```

#### 3. `getSource`
```typescript
// Test cases:
- should return source with chunk count
- should return null for non-existent source
- should only return source for matching tenantId
```

#### 4. `deleteSource`
```typescript
// Test cases:
- should delete source from database
- should delete vectors from Pinecone
- should delete file from storage
- should throw 'Source not found' for invalid sourceId
- should handle storage deletion failure gracefully (warning only)
```

#### 5. `reindexSource`
```typescript
// Test cases:
- should delete existing vectors from Pinecone
- should reset source status to PENDING
- should delete existing chunks
- should queue reprocessing job
- should throw 'Source not found' for invalid sourceId
```

#### 6. `searchKnowledge`
```typescript
// Test cases:
- should generate embedding for query
- should query Pinecone with correct namespace
- should return formatted results with score, text, source info
- should respect limit and threshold parameters
```

### Mock Requirements
```typescript
vi.mock('../../../src/lib/prisma.js');
vi.mock('../../../src/lib/storage/index.js', () => ({
  storage: { upload: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../src/lib/llm/index.js', () => ({
  generateEmbedding: vi.fn(() => [0.1, 0.2, 0.3]),
}));
vi.mock('../../../src/lib/pinecone.js', () => ({
  queryVectors: vi.fn(),
  getPineconeIndex: vi.fn(() => ({
    namespace: vi.fn(() => ({ deleteMany: vi.fn() })),
  })),
}));
vi.mock('../../../src/jobs/queue.js', () => ({
  documentQueue: { add: vi.fn() },
}));
vi.mock('../../../src/modules/knowledge/processors/index.js', () => ({
  getProcessor: vi.fn(() => ({})),
}));
vi.mock('../../../src/lib/logger.js');
```

---

## Module 5: Knowledge Controller

**File:** `tests/unit/knowledge/knowledge.controller.test.ts`
**Source:** `src/modules/knowledge/knowledge.controller.ts`

### Functions to Test

#### 1. `uploadDocument`
```typescript
// Test cases:
- should return 201 on successful upload
- should return 400 when no file uploaded
- should extract name from multipart fields
```

#### 2. `listSources`
```typescript
// Test cases:
- should return paginated sources list
```

#### 3. `getSource`
```typescript
// Test cases:
- should return source data
- should return 404 for non-existent source
```

#### 4. `deleteSource`
```typescript
// Test cases:
- should delete source and return success
- should handle service errors
```

#### 5. `reindexSource`
```typescript
// Test cases:
- should trigger reindex and return result
```

#### 6. `searchKnowledge`
```typescript
// Test cases:
- should return search results
```

### Fixture Requirements
Create `tests/fixtures/knowledge.fixtures.ts`:
```typescript
export const mockMultipartFile = {
  filename: 'test.pdf',
  mimetype: 'application/pdf',
  toBuffer: vi.fn(() => Buffer.from('test content')),
  fields: {},
};

export const mockKnowledgeSource = {
  id: 'source-1',
  tenantId: 'tenant-1',
  name: 'Test Document',
  type: 'PDF',
  status: 'INDEXED',
  chunkCount: 10,
  tokenCount: 500,
};
```

---

## Module 6: Bot Escalation

**File:** `tests/unit/bot/bot.escalation.test.ts`
**Source:** `src/modules/bot/bot.escalation.ts`

### Functions to Test

#### 1. `checkUserRequestEscalation`
```typescript
// Test cases:
- should detect "speak to human" request
- should detect "talk to agent" request
- should detect "escalate" keyword
- should detect "real person" request
- should detect "customer service" request
- should detect "representative" request
- should detect "manager" request
- should return shouldEscalate: false for normal messages
- should be case insensitive
```

#### 2. `checkSensitiveTopic`
```typescript
// Test cases:
- should detect "refund" topic
- should detect "fraud" topic
- should detect "legal" topic
- should detect "complaint" topic
- should detect "harassment" topic
- should detect "discrimination" topic
- should return shouldEscalate: false for non-sensitive topics
- should be case insensitive
```

#### 3. `checkLowConfidence`
```typescript
// Test cases:
- should return shouldEscalate: true when below threshold (0.5)
- should return shouldEscalate: false when above threshold
- should return shouldEscalate: false when equal to threshold
```

#### 4. `checkConversationLength`
```typescript
// Test cases:
- should return shouldEscalate: true when above threshold
- should return shouldEscalate: false when below threshold
- should return shouldEscalate: false when equal to threshold
```

#### 5. `evaluateEscalation`
```typescript
// Test cases:
- should prioritize USER_REQUEST over other reasons
- should check SENSITIVE_TOPIC if no user request
- should check LOW_CONFIDENCE if no sensitive topic
- should check LONG_CONVERSATION last
- should return shouldEscalate: false if no conditions met
```

### Mock Requirements
```typescript
vi.mock('../../../src/config/index.js', () => ({
  CONSTANTS: {
    LOW_CONFIDENCE_THRESHOLD: 0.5,
    LONG_CONVERSATION_THRESHOLD: 20,
  },
}));
```

---

## Module 7: Bot Prompts

**File:** `tests/unit/bot/bot.prompts.test.ts`
**Source:** `src/modules/bot/bot.prompts.ts`

### Functions to Test

#### 1. `buildSystemPrompt`
```typescript
// Test cases:
- should include bot name in prompt
- should include base instructions
- should append custom instructions when provided
- should append knowledge context when provided
- should handle null customInstructions
- should handle undefined knowledgeContext
- should format knowledge context with separators
```

#### 2. `buildFallbackResponse`
```typescript
// Test cases:
- should return custom fallback message when provided
- should return default fallback when message is null
- should return default fallback when message is undefined
```

---

## Module 8: Bot Engine

**File:** `tests/unit/bot/bot.engine.test.ts`
**Source:** `src/modules/bot/bot.engine.ts`

### Methods to Test

#### 1. `generateResponse`
```typescript
// Test cases:
- should return immediate escalation response for USER_REQUEST trigger
- should return fallback response when no contexts retrieved
- should return fallback response when confidence < 0.3
- should generate response with knowledge context
- should include sources in response
- should calculate confidence from context scores
- should trigger escalation for low confidence
- should handle LLM response correctly
```

#### Private method coverage (via public method):
```typescript
// buildSearchQuery
- should include history context for short queries (< 50 chars)
- should include history context for follow-up queries
- should use message only for long standalone queries

// isFollowUpQuery
- should detect "what about that" patterns
- should detect "and/but/also" starters
- should detect pronoun references (this, that, it)

// calculateConfidence
- should return 0 for empty contexts
- should average top 3 scores
- should round to 2 decimal places

// buildKnowledgeContext
- should format contexts with numbering
- should include source names
- should truncate long contexts
```

### Mock Requirements
```typescript
vi.mock('../../../src/lib/llm/index.js', () => ({
  generateEmbedding: vi.fn(() => [0.1, 0.2, 0.3]),
  chatWithFallback: vi.fn(() => ({
    content: 'Bot response',
    tokensUsed: { total: 100 },
  })),
}));
vi.mock('../../../src/lib/pinecone.js', () => ({
  queryVectors: vi.fn(),
}));
vi.mock('../../../src/config/index.js', () => ({
  CONSTANTS: {
    RAG_TOP_K: 5,
    RAG_MIN_SCORE: 0.7,
    MAX_RESPONSE_TOKENS: 500,
    MAX_CONTEXT_TOKENS: 2000,
    MAX_CONVERSATION_HISTORY: 10,
    LOW_CONFIDENCE_THRESHOLD: 0.5,
  },
}));
vi.mock('../../../src/utils/token-counter.js', () => ({
  truncateToTokenLimit: vi.fn((text) => text),
}));
vi.mock('../../../src/lib/logger.js');
```

---

## Implementation Order (Priority)

1. **Bot Module** (pure functions, easiest to test)
   - `bot.prompts.test.ts` - 2 functions, no external deps
   - `bot.escalation.test.ts` - 5 functions, minimal deps
   - `bot.engine.test.ts` - complex but critical

2. **Conversation Module** (simple service)
   - `conversation.service.test.ts` - 2 functions

3. **Chat Module** (depends on conversation + bot)
   - `chat.service.test.ts` - 5 functions
   - `chat.controller.test.ts` - 5 handlers

4. **Knowledge Module** (most complex, external deps)
   - `knowledge.service.test.ts` - 6 functions
   - `knowledge.controller.test.ts` - 6 handlers

---

## Test Patterns to Follow

### Service Tests
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies at top
vi.mock('../../../src/lib/prisma.js', () => ({...}));

// Get mocked module
const { prisma } = await import('../../../src/lib/prisma.js');

describe('ServiceName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('functionName', () => {
    it('should do expected behavior', async () => {
      // Arrange
      vi.mocked(prisma.model.method).mockResolvedValue(expectedValue);

      // Act
      const result = await service.functionName(params);

      // Assert
      expect(result).toEqual(expected);
      expect(prisma.model.method).toHaveBeenCalledWith(expectedArgs);
    });
  });
});
```

### Controller Tests
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as controller from '../../../src/modules/x/x.controller.js';
import * as service from '../../../src/modules/x/x.service.js';
import { mockFastifyRequest, mockFastifyReply } from '../../fixtures/x.fixtures.js';

vi.mock('../../../src/modules/x/x.service.js');

describe('Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handler', () => {
    it('should return success response', async () => {
      const request = mockFastifyRequest({...}) as any;
      const reply = mockFastifyReply();

      vi.mocked(service.method).mockResolvedValue(result);

      await controller.handler(request, reply);

      expect(reply.body.success).toBe(true);
    });
  });
});
```

---

## Expected Test Counts

| Module | File | Est. Tests |
|--------|------|------------|
| Bot | bot.prompts.test.ts | 7 |
| Bot | bot.escalation.test.ts | 18 |
| Bot | bot.engine.test.ts | 15 |
| Conversation | conversation.service.test.ts | 6 |
| Chat | chat.service.test.ts | 15 |
| Chat | chat.controller.test.ts | 10 |
| Knowledge | knowledge.service.test.ts | 18 |
| Knowledge | knowledge.controller.test.ts | 10 |
| **Total** | | **~99 new tests** |

---

## Verification

After implementation, run:
```bash
pnpm test:run
pnpm lint
```

Target: **0 errors**, all tests passing.
