import { z } from 'zod';

export const uploadSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

export const listSourcesSchema = z.object({
  status: z
    .enum(['PENDING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'INDEXED', 'FAILED'])
    .optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export const searchSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().min(1).max(20).default(5),
  threshold: z.coerce.number().min(0).max(1).default(0.3),
});

export const crawlUrlSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  options: z
    .object({
      crawlSitemap: z.boolean().default(false),
      maxDepth: z.number().int().min(0).max(3).default(0),
      maxPages: z.number().int().min(1).max(100).default(10),
      includePatterns: z.array(z.string()).optional(),
      excludePatterns: z.array(z.string()).optional(),
    })
    .optional(),
});

export const connectNotionSchema = z.object({
  name: z.string().min(1).max(255),
  apiKey: z.string().min(1),
  rootPageId: z.string().optional(),
});

export const syncSourceSchema = z.object({
  sourceId: z.string().uuid(),
});

export type UploadInput = z.infer<typeof uploadSchema>;
export type ListSourcesInput = z.infer<typeof listSourcesSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type CrawlUrlInput = z.infer<typeof crawlUrlSchema>;
export type ConnectNotionInput = z.infer<typeof connectNotionSchema>;
export type SyncSourceInput = z.infer<typeof syncSourceSchema>;