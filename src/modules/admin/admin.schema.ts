import { z } from 'zod';

/**
 * Admin login schema
 */
export const adminLoginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

/**
 * Tenant query schema for listing with filters
 */
export const tenantQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  sortBy: z.enum(['name', 'createdAt', 'lastActivity']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type TenantQueryInput = z.infer<typeof tenantQuerySchema>;

/**
 * Create tenant schema (enhanced with admin notes)
 */
export const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
  // Bot configuration
  botName: z.string().min(1).max(50).optional(),
  systemPrompt: z.string().max(4000).optional(),
  welcomeMessage: z.string().max(500).optional(),
  fallbackMessage: z.string().max(500).optional(),
  // Limits
  monthlyMessageLimit: z.number().int().min(100).max(10_000_000).optional(),
  settings: z
    .object({
      maxKnowledgeSources: z.number().int().positive().optional(),
      maxConversations: z.number().int().positive().optional(),
      allowedChannels: z.array(z.enum(['WEB', 'WHATSAPP', 'TELEGRAM'])).optional(),
    })
    .optional(),
  adminNotes: z.string().max(1000).optional(),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/**
 * Update tenant schema
 * Note: slug cannot be changed after creation
 */
export const updateTenantSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  // Bot configuration
  botName: z.string().min(1).max(50).optional(),
  systemPrompt: z.string().max(4000).nullish(),
  welcomeMessage: z.string().max(500).nullish(),
  fallbackMessage: z.string().max(500).nullish(),
  // Limits
  monthlyMessageLimit: z.number().int().min(100).max(10_000_000).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  settings: z
    .object({
      maxKnowledgeSources: z.number().int().positive().optional(),
      maxConversations: z.number().int().positive().optional(),
      allowedChannels: z.array(z.enum(['WEB', 'WHATSAPP', 'TELEGRAM'])).optional(),
    })
    .nullish(),
  adminNotes: z.string().max(1000).optional(),
});

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/**
 * Tenant ID parameter schema
 */
export const tenantIdParamSchema = z.object({
  id: z.string().uuid('Invalid tenant ID format'),
});

export type TenantIdParam = z.infer<typeof tenantIdParamSchema>;

/**
 * API key ID parameter schema
 */
export const apiKeyIdParamSchema = z.object({
  id: z.string().uuid('Invalid tenant ID format'),
  keyId: z.string().uuid('Invalid API key ID format'),
});

export type ApiKeyIdParam = z.infer<typeof apiKeyIdParamSchema>;

/**
 * Create API key schema
 */
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  environment: z.enum(['live', 'test']).optional(),
  expiresIn: z.number().int().positive().optional(), // Days until expiration
  permissions: z
    .object({
      chat: z.boolean().default(true),
      knowledge: z.boolean().default(true),
      admin: z.boolean().default(false),
    })
    .optional(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
