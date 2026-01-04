import type { Channel } from '@prisma/client';

/**
 * Channel configuration with masked credentials
 * Credentials are masked in API responses for security
 */
export interface ChannelConfigResponse {
  id: string;
  tenantId: string;
  channel: Channel;
  enabled: boolean;
  webhookUrl: string | null;
  credentials: Record<string, unknown>; // Masked credentials
  settings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input for creating a channel configuration
 */
export interface CreateChannelConfigInput {
  channel: Channel;
  enabled?: boolean;
  credentials: Record<string, unknown>;
  webhookUrl?: string;
  settings?: Record<string, unknown>;
}

/**
 * Input for updating a channel configuration
 */
export interface UpdateChannelConfigInput {
  enabled?: boolean;
  credentials?: Record<string, unknown>;
  webhookUrl?: string | null;
  settings?: Record<string, unknown>;
}
