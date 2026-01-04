import { z } from 'zod';

/**
 * Channel enum schema matching Prisma enum
 */
export const channelEnumSchema = z.enum(['WHATSAPP', 'TELEGRAM', 'WEB', 'SLACK', 'EMAIL', 'SMS']);

/**
 * Create channel config schema
 */
export const createChannelConfigSchema = z.object({
  channel: channelEnumSchema,
  enabled: z.boolean().default(true),
  credentials: z.record(z.string(), z.unknown()), // Validated per-channel in service
  webhookUrl: z.string().url().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Update channel config schema
 */
export const updateChannelConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    credentials: z.record(z.string(), z.unknown()).optional(),
    webhookUrl: z.string().url().nullable().optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/**
 * Channel parameter schema
 */
export const channelParamSchema = z.object({
  channel: channelEnumSchema,
});

/**
 * Channel-specific credential validation schemas
 * These are used in the service layer to validate credentials per channel type
 */

export const whatsappCredentialsSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  webhookVerifyToken: z.string().min(8),
  businessAccountId: z.string().optional(),
});

export const telegramCredentialsSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/, 'Invalid Telegram bot token format'),
  webhookSecret: z.string().min(16).optional(),
});

export const webCredentialsSchema = z.object({
  allowedOrigins: z.array(z.string().url()).min(1),
  rateLimit: z.number().int().min(1).max(1000).optional(),
  sessionTimeout: z.number().int().min(1).max(1440).optional(),
});

/**
 * Type exports
 */
export type CreateChannelConfigInput = z.infer<typeof createChannelConfigSchema>;
export type UpdateChannelConfigInput = z.infer<typeof updateChannelConfigSchema>;
export type WhatsAppCredentials = z.infer<typeof whatsappCredentialsSchema>;
export type TelegramCredentials = z.infer<typeof telegramCredentialsSchema>;
export type WebCredentials = z.infer<typeof webCredentialsSchema>;
