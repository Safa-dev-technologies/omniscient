import { z } from 'zod';

/**
 * Escalation reason enum schema matching Prisma enum
 */
export const escalationReasonEnumSchema = z.enum([
  'USER_REQUEST',
  'LOW_CONFIDENCE',
  'SENSITIVE_TOPIC',
  'REPEATED_QUESTION',
  'LONG_CONVERSATION',
  'MEDIA_RECEIVED',
  'AUTH_REQUIRED',
  'ERROR',
]);

/**
 * Create escalation schema
 */
export const createEscalationSchema = z.object({
  conversationId: z.string().uuid(),
  reason: escalationReasonEnumSchema,
  reasonDetails: z.string().optional(),
  externalTicketId: z.string().optional(),
  externalSystem: z.string().optional(),
  agentId: z.string().uuid().optional(),
  agentName: z.string().optional(),
});

/**
 * Update escalation schema
 */
export const updateEscalationSchema = z
  .object({
    reasonDetails: z.string().optional(),
    externalTicketId: z.string().optional(),
    externalSystem: z.string().optional(),
    agentId: z.string().uuid().optional(),
    agentName: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/**
 * Resolve escalation schema
 */
export const resolveEscalationSchema = z.object({
  resolutionNotes: z.string().optional(),
  returnedToBot: z.boolean().default(false),
  agentId: z.string().uuid().optional(),
  agentName: z.string().optional(),
});

/**
 * Escalation ID parameter schema
 */
export const escalationIdParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * List escalations query schema
 */
export const listEscalationsQuerySchema = z.object({
  conversationId: z.string().uuid().optional(),
  reason: escalationReasonEnumSchema.optional(),
  resolved: z.coerce.boolean().optional(),
  externalSystem: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Create external ticket schema
 */
export const createExternalTicketSchema = z.object({
  escalationId: z.string().uuid(),
  system: z.enum(['zendesk', 'freshdesk']),
  subject: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Type exports
 */
export type CreateEscalationInput = z.infer<typeof createEscalationSchema>;
export type UpdateEscalationInput = z.infer<typeof updateEscalationSchema>;
export type ResolveEscalationInput = z.infer<typeof resolveEscalationSchema>;
export type EscalationIdParam = z.infer<typeof escalationIdParamSchema>;
export type ListEscalationsQuery = z.infer<typeof listEscalationsQuerySchema>;
export type CreateExternalTicketInput = z.infer<typeof createExternalTicketSchema>;
