import { z } from 'zod';

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(4000),
  sessionId: z.string().optional(),
  channel: z.enum(['WEB', 'WHATSAPP', 'TELEGRAM', 'SLACK', 'EMAIL', 'SMS']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const conversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Schema for escalating a conversation
 */
export const escalateSchema = z.object({
  reason: z.string().max(500, 'Reason must be 500 characters or less').optional(),
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type EscalateInput = z.infer<typeof escalateSchema>;
