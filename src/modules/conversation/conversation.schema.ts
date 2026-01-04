import { z } from 'zod';

/**
 * Conversation status enum schema matching Prisma enum
 */
export const conversationStatusEnumSchema = z.enum([
  'BOT_ACTIVE',
  'ESCALATED',
  'HUMAN_ACTIVE',
  'RESOLVED',
  'CLOSED',
]);

/**
 * Channel enum schema matching Prisma enum
 */
export const channelEnumSchema = z.enum(['WHATSAPP', 'TELEGRAM', 'WEB', 'SLACK', 'EMAIL', 'SMS']);

/**
 * Create conversation schema
 */
export const createConversationSchema = z.object({
  userId: z.string().uuid(),
  channel: channelEnumSchema,
  channelConversationId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Update conversation schema
 */
export const updateConversationSchema = z
  .object({
    status: conversationStatusEnumSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/**
 * Conversation ID parameter schema
 */
export const conversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * List conversations query schema
 */
export const listConversationsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  channel: channelEnumSchema.optional(),
  status: conversationStatusEnumSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Transition conversation status schema
 */
export const transitionConversationStatusSchema = z.object({
  status: conversationStatusEnumSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Type exports
 */
export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type ConversationIdParam = z.infer<typeof conversationIdParamSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type TransitionConversationStatusInput = z.infer<typeof transitionConversationStatusSchema>;
