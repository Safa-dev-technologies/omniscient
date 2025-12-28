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

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
