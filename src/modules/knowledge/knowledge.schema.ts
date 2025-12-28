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

export type UploadInput = z.infer<typeof uploadSchema>;
export type ListSourcesInput = z.infer<typeof listSourcesSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
