/**
 * Connector interface for external knowledge sources
 * Supports Zendesk, Notion, and other external integrations
 */

import type { KnowledgeSourceType } from '@prisma/client';

/**
 * Credentials for connecting to external services
 */
export interface ConnectorCredentials {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Configuration for a connector
 */
export interface ConnectorConfig {
  type: KnowledgeSourceType;
  credentials: ConnectorCredentials;
  settings?: Record<string, unknown>;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  added: number;
  updated: number;
  deleted: number;
  errors: string[];
  lastSyncedAt: Date;
}

/**
 * Article/page fetched from external source
 */
export interface FetchedArticle {
  externalId: string;
  title: string;
  content: string; // Plain text or HTML
  url?: string;
  section?: string;
  category?: string;
  labels?: string[];
  author?: string;
  createdAt: Date;
  updatedAt: Date;
  checksum: string; // For change detection
  metadata?: Record<string, unknown>;
}

/**
 * Base interface for all connectors
 */
export interface Connector {
  readonly type: KnowledgeSourceType;

  /**
   * Test connection with given credentials
   */
  testConnection(credentials: ConnectorCredentials): Promise<boolean>;

  /**
   * Fetch all articles/pages from the source
   */
  fetchAll(credentials: ConnectorCredentials): AsyncGenerator<FetchedArticle>;

  /**
   * Fetch articles/pages modified since a given date
   */
  fetchSince(credentials: ConnectorCredentials, since: Date): AsyncGenerator<FetchedArticle>;

  /**
   * Get approximate count of articles/pages
   * Used for progress tracking
   */
  getArticleCount(credentials: ConnectorCredentials): Promise<number>;
}
