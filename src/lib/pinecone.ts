import { Pinecone, Index } from '@pinecone-database/pinecone';
import { env } from '../config/index.js';
import { logger } from './logger.js';
import { withKeyRotation, createKeyPair } from '../utils/key-rotation.js';

// Key pair for zero-downtime rotation
const pineconeKeys = createKeyPair(env.PINECONE_API_KEY, env.PINECONE_API_KEY_SECONDARY);

// Cache clients by API key to avoid recreating
const clientCache = new Map<string, Pinecone>();

function getClientForKey(apiKey: string): Pinecone {
  let client = clientCache.get(apiKey);
  if (!client) {
    client = new Pinecone({ apiKey });
    clientCache.set(apiKey, client);
    logger.info('Pinecone client initialized');
  }
  return client;
}

export function getPinecone(): Pinecone {
  // Return primary client for backwards compatibility
  return getClientForKey(pineconeKeys.primary);
}

export function getPineconeIndex(): Index {
  return getPinecone().index(env.PINECONE_INDEX);
}

export async function upsertVectors(
  namespace: string,
  vectors: Array<{
    id: string;
    values: number[];
    metadata?: Record<string, string | number | boolean>;
  }>
) {
  // Use key rotation for automatic fallback
  return withKeyRotation({ serviceName: 'pinecone', keys: pineconeKeys }, async (apiKey) => {
    const client = getClientForKey(apiKey);
    const index = client.index(env.PINECONE_INDEX);
    await index.namespace(namespace).upsert(vectors);
  });
}

export async function queryVectors(
  namespace: string,
  vector: number[],
  topK: number = 10,
  minScore: number = 0.7
) {
  // Use key rotation for automatic fallback
  return withKeyRotation({ serviceName: 'pinecone', keys: pineconeKeys }, async (apiKey) => {
    const client = getClientForKey(apiKey);
    const index = client.index(env.PINECONE_INDEX);
    const results = await index.namespace(namespace).query({
      vector,
      topK,
      includeMetadata: true,
    });

    return results.matches?.filter((m) => (m.score ?? 0) >= minScore) ?? [];
  });
}

export async function deleteNamespace(namespace: string) {
  // Use key rotation for automatic fallback
  return withKeyRotation({ serviceName: 'pinecone', keys: pineconeKeys }, async (apiKey) => {
    const client = getClientForKey(apiKey);
    const index = client.index(env.PINECONE_INDEX);
    await index.namespace(namespace).deleteAll();
  });
}
