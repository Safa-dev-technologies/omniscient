import { z } from 'zod';

// Slug validation: lowercase, alphanumeric, hyphens, 3-50 chars
const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export const createTenantSchema = z.object({
  name: z.string().min(2).max(100).trim(),
  slug: z
    .string()
    .regex(
      slugRegex,
      'Slug must be 3-50 lowercase alphanumeric characters or hyphens, cannot start/end with hyphen'
    )
    .transform((s) => s.toLowerCase()),

  // Optional bot configuration
  botName: z.string().min(1).max(50).default('Assistant'),
  systemPrompt: z.string().max(4000).optional(),
  welcomeMessage: z.string().max(500).optional(),
  fallbackMessage: z.string().max(500).optional(),

  // Limits
  monthlyMessageLimit: z.number().int().min(100).max(10_000_000).default(10000),

  // Settings (validated JSON object)
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const updateTenantSchema = z
  .object({
    name: z.string().min(2).max(100).trim().optional(),
    botName: z.string().min(1).max(50).optional(),
    systemPrompt: z.string().max(4000).nullish(), // Allow explicit null to clear
    welcomeMessage: z.string().max(500).nullish(),
    fallbackMessage: z.string().max(500).nullish(),
    monthlyMessageLimit: z.number().int().min(100).max(10_000_000).optional(),
    settings: z.record(z.string(), z.unknown()).nullish(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), // Can't set to DELETED via update
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const listTenantsSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(100).optional(), // Search by name or slug
});

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100).trim(),
  environment: z.enum(['live', 'test']).default('live'),
  permissions: z
    .object({
      chat: z.boolean().default(true),
      knowledge: z.boolean().default(true),
      admin: z.boolean().default(false),
    })
    .default({ chat: true, knowledge: true, admin: false }),
  expiresAt: z.coerce
    .date()
    .optional()
    .refine((date) => !date || date > new Date(), 'Expiration date must be in the future'),
});

export const tenantIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const apiKeyIdParamSchema = z.object({
  id: z.string().uuid(),
  keyId: z.string().uuid(),
});

// Export inferred types
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
export type ListTenantsInput = z.infer<typeof listTenantsSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
