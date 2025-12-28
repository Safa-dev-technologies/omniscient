import { Pinecone } from '@pinecone-database/pinecone';
import { env } from '../config/index.js';
import { logger } from './logger.js';

let pineconeClient: Pinecone | null = null;

export function getPinecone(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: env.PINECONE_API_KEY,
    });
    logger.info('Pinecone client initialized');
  }
  return pineconeClient;
}

export function getPineconeIndex() {
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
  const index = getPineconeIndex();
  await index.namespace(namespace).upsert(vectors);
}

export async function queryVectors(
  namespace: string,
  vector: number[],
  topK: number = 10,
  minScore: number = 0.7
) {
  const index = getPineconeIndex();
  const results = await index.namespace(namespace).query({
    vector,
    topK,
    includeMetadata: true,
  });

  return results.matches?.filter((m) => (m.score ?? 0) >= minScore) ?? [];
}

export async function deleteNamespace(namespace: string) {
  const index = getPineconeIndex();
  await index.namespace(namespace).deleteAll();
}
