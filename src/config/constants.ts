export const CONSTANTS = {
  // API Key format
  API_KEY_PREFIX: 'omni',
  API_KEY_LIVE: 'omni_live_',
  API_KEY_TEST: 'omni_test_',

  // Reserved slugs (cannot be used for tenants)
  RESERVED_SLUGS: [
    'api',
    'admin',
    'www',
    'app',
    'dashboard',
    'console',
    'login',
    'auth',
    'oauth',
    'webhook',
    'webhooks',
    'health',
    'status',
    'metrics',
    'internal',
  ],

  // Chunking (OpenAI has 8K token limit - can use larger chunks)
  CHUNK_SIZE: 2000, // ~500 tokens, preserves more context
  CHUNK_OVERLAP: 200,
  MIN_CHUNK_SIZE: 100,

  // Embeddings
  EMBEDDING_BATCH_SIZE: 100,

  // RAG
  RAG_TOP_K: 10,
  RAG_MIN_SCORE: 0.3, // Lowered - OpenAI embeddings with cosine similarity

  // Conversation
  MAX_CONVERSATION_HISTORY: 20,
  CONVERSATION_TIMEOUT_HOURS: 24,

  // Escalation
  LOW_CONFIDENCE_THRESHOLD: 0.5,
  REPEATED_QUESTION_THRESHOLD: 3,
  LONG_CONVERSATION_THRESHOLD: 20,

  // Rate Limits
  MAX_FILE_SIZE_MB: 50,
  MAX_FILES_PER_UPLOAD: 10,

  // Token Limits
  MAX_CONTEXT_TOKENS: 4000,
  MAX_RESPONSE_TOKENS: 1000,
} as const;
